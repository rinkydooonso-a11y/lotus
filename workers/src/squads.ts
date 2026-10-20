import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  sendAndConfirmTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createNoopSigner, publicKey, transactionBuilder, type Umi } from '@metaplex-foundation/umi';
import { toWeb3JsInstruction } from '@metaplex-foundation/umi-web3js-adapters';
import { mplTokenMetadata, transferV1 as tmTransferV1, TokenStandard } from '@metaplex-foundation/mpl-token-metadata';
import { mplCore, transferV1 as coreTransferV1 } from '@metaplex-foundation/mpl-core';
import { MAINNET_CONFIRMATION_PHRASE, MAINNET_GENESIS_HASH } from './config.js';
import type { ChainProposalState, SquadsGateway, VaultCard } from './topUp.js';
import type { AssetInfo, Logger } from './types.js';

const { Permission } = multisig.types;

export interface SquadsConfig {
  rpcUrl: string;
  multisigAddress: string;
  /** Initiate-only member key. Never a signer that can vote or execute. */
  proposer: Keypair;
  hotWallet: string;
  /** If set, must equal the multisig's vault 0. Guards against a mistyped multisig address. */
  expectedVault?: string;
  allowMainnet: string | undefined;
  getAsset: (mint: string) => Promise<AssetInfo | null>;
  log: Logger;
}

/**
 * Talks to a Squads v4 multisig as an Initiate-only member. Refuses to start if the proposer can
 * vote or execute, because then a leaked worker key could move funds without the signers.
 */
export async function createSquadsGateway(cfg: SquadsConfig): Promise<SquadsGateway & { vault: string }> {
  const connection = new Connection(cfg.rpcUrl, 'confirmed');
  const genesis = await connection.getGenesisHash();
  if (genesis === MAINNET_GENESIS_HASH && cfg.allowMainnet !== MAINNET_CONFIRMATION_PHRASE) {
    throw new Error(`Refusing to propose top-ups on mainnet without LOTUS_ALLOW_MAINNET=${MAINNET_CONFIRMATION_PHRASE}.`);
  }
  const multisigPda = new PublicKey(cfg.multisigAddress);
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });
  if (cfg.expectedVault && cfg.expectedVault !== vaultPda.toBase58()) {
    throw new Error(`SQUADS_VAULT_ADDRESS ${cfg.expectedVault} is not vault 0 of multisig ${cfg.multisigAddress}`);
  }
  const ms = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);
  const me = ms.members.find((m) => m.key.equals(cfg.proposer.publicKey));
  if (!me) throw new Error(`proposer ${cfg.proposer.publicKey.toBase58()} is not a member of the multisig`);
  const has = (p: multisig.types.Permission) => multisig.types.Permissions.has(me.permissions, p);
  if (!has(Permission.Initiate)) throw new Error('proposer lacks the Initiate permission');
  if (has(Permission.Vote) || has(Permission.Execute)) {
    throw new Error('proposer can vote or execute; give it Initiate only so it can never move funds alone');
  }

  const umi = createUmi(cfg.rpcUrl, { commitment: 'confirmed' }).use(mplTokenMetadata()).use(mplCore());
  return new SquadsTopUps(connection, umi, multisigPda, vaultPda, cfg);
}

class SquadsTopUps implements SquadsGateway {
  readonly vault: string;

  constructor(
    private readonly connection: Connection,
    private readonly umi: Umi,
    private readonly multisigPda: PublicKey,
    private readonly vaultPda: PublicKey,
    private readonly cfg: SquadsConfig,
  ) {
    this.vault = vaultPda.toBase58();
  }

  async nextTransactionIndex(): Promise<bigint> {
    const ms = await multisig.accounts.Multisig.fromAccountAddress(this.connection, this.multisigPda);
    return BigInt(ms.transactionIndex.toString()) + 1n;
  }

  async hotWalletLamports(): Promise<bigint> {
    return BigInt(await this.connection.getBalance(new PublicKey(this.cfg.hotWallet), 'confirmed'));
  }

  /** Vault-signed transfer of one card to the hot wallet, read from chain so the owner is current. */
  private async cardTransfer(card: VaultCard): Promise<TransactionInstruction[]> {
    const asset = await this.cfg.getAsset(card.nftMint);
    if (!asset) throw new Error(`card ${card.nftMint} not found on chain`);
    if (asset.owner !== this.vault) throw new Error(`card ${card.nftMint} is not in the vault (owner ${asset.owner})`);
    const vault = createNoopSigner(publicKey(this.vault));
    const to = publicKey(this.cfg.hotWallet);
    let builder = transactionBuilder();
    if (asset.standard === 'core') {
      builder = builder.add(
        coreTransferV1(this.umi, {
          asset: publicKey(asset.mint),
          collection: asset.collection ? publicKey(asset.collection) : undefined,
          newOwner: to,
          payer: vault,
          authority: vault,
        }),
      );
    } else if (asset.standard === 'pnft' || asset.standard === 'nft') {
      builder = builder.add(
        tmTransferV1(this.umi, {
          mint: publicKey(asset.mint),
          authority: vault,
          payer: vault,
          tokenOwner: vault.publicKey,
          destinationOwner: to,
          tokenStandard: asset.standard === 'pnft' ? TokenStandard.ProgrammableNonFungible : TokenStandard.NonFungible,
          authorizationRules: asset.ruleSet ? publicKey(asset.ruleSet) : undefined,
        }),
      );
    } else {
      throw new Error(`cannot move ${asset.standard} card ${card.nftMint}`);
    }
    return builder.getInstructions().map(toWeb3JsInstruction);
  }

  private async send(...ixs: TransactionInstruction[]): Promise<string> {
    return sendAndConfirmTransaction(this.connection, new Transaction().add(...ixs), [this.cfg.proposer], {
      commitment: 'confirmed',
    });
  }

  async createTopUpProposal(transactionIndex: bigint, cards: VaultCard[], solLamports: bigint): Promise<void> {
    // Build every inner message first, so a bad card fails before anything lands on chain.
    const inner: TransactionInstruction[][] = [];
    for (const c of cards) inner.push(await this.cardTransfer(c));
    if (solLamports > 0n) {
      inner.push([
        SystemProgram.transfer({ fromPubkey: this.vaultPda, toPubkey: new PublicKey(this.cfg.hotWallet), lamports: solLamports }),
      ]);
    }
    if (inner.length === 0) throw new Error('nothing to propose');

    const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
    const member = this.cfg.proposer.publicKey;
    const base = { multisigPda: this.multisigPda, programId: undefined };
    await this.send(
      multisig.instructions.batchCreate({
        ...base, creator: member, batchIndex: transactionIndex, vaultIndex: 0,
        memo: `CardQuest hot-wallet top-up: ${cards.length} card(s)${solLamports > 0n ? ' + SOL' : ''}`,
      }),
      multisig.instructions.proposalCreate({ ...base, creator: member, transactionIndex, isDraft: true }),
    );
    for (const [i, instructions] of inner.entries()) {
      await this.send(
        multisig.instructions.batchAddTransaction({
          ...base, member, vaultIndex: 0, batchIndex: transactionIndex, transactionIndex: i + 1, ephemeralSigners: 0,
          transactionMessage: new TransactionMessage({ payerKey: this.vaultPda, recentBlockhash: blockhash, instructions }),
        }),
      );
    }
    await this.send(multisig.instructions.proposalActivate({ ...base, member, transactionIndex }));
  }

  async proposalState(transactionIndex: bigint): Promise<ChainProposalState> {
    // Only trust a proposal whose batch our key created; someone else may have used the index.
    const [batchPda] = multisig.getTransactionPda({ multisigPda: this.multisigPda, index: transactionIndex });
    const batch = await multisig.accounts.Batch.fromAccountAddress(this.connection, batchPda).catch(() => null);
    if (!batch || !batch.creator.equals(this.cfg.proposer.publicKey)) return 'missing';

    const [proposalPda] = multisig.getProposalPda({ multisigPda: this.multisigPda, transactionIndex });
    const proposal = await multisig.accounts.Proposal.fromAccountAddress(this.connection, proposalPda).catch(() => null);
    if (!proposal) return 'missing';
    const kind = proposal.status.__kind;
    if (kind === 'Executed') return 'executed';
    if (kind === 'Rejected') return 'rejected';
    if (kind === 'Cancelled') return 'cancelled';
    if (kind === 'Executing') return 'executing';
    const ms = await multisig.accounts.Multisig.fromAccountAddress(this.connection, this.multisigPda);
    if (transactionIndex <= BigInt(ms.staleTransactionIndex.toString())) return 'stale';
    return kind === 'Draft' ? 'draft' : kind === 'Approved' ? 'approved' : 'active';
  }
}
