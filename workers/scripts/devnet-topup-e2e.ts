/**
 * DEVNET ONLY. End-to-end check of the top-up proposer against a real Squads v4 multisig.
 *
 *   cd workers && DEVNET_RPC="https://devnet.helius-rpc.com/?api-key=..." npx tsx scripts/devnet-topup-e2e.ts
 *
 * Everything is throwaway: it generates two signers, an Initiate-only proposer and a hot wallet,
 * creates a 2-of-2 multisig, mints one Core card and one pNFT straight into the vault, then:
 *   1. checks the gateway refuses a proposer that can vote,
 *   2. drafts a top-up (both cards + 0.01 SOL) as the proposer,
 *   3. checks the proposer cannot approve its own proposal,
 *   4. approves with both signers and executes every batch transaction,
 *   5. checks both cards and the SOL reached the hot wallet and the proposal reads 'executed'.
 * Funding: DEVNET_PAYER_SECRET_KEY (base58 or JSON array) if set, else an airdrop to a fresh key.
 * Keys are written to scripts/.devnet-topup-keys.json (gitignored) so a failed run can be inspected.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createSignerFromKeypair, generateSigner, percentAmount, publicKey, signerIdentity } from '@metaplex-foundation/umi';
import { fromWeb3JsKeypair } from '@metaplex-foundation/umi-web3js-adapters';
import { createProgrammableNft, mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';
import { create as createCore, mplCore } from '@metaplex-foundation/mpl-core';
import { parseSecretKey, type Config } from '../src/config.js';
import { createSolanaChain } from '../src/solanaChain.js';
import { createSquadsGateway } from '../src/squads.js';
import { jsonLogger as log } from '../src/types.js';

const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const RPC = process.env.DEVNET_RPC ?? 'https://api.devnet.solana.com';
const KEY_FILE = join(dirname(fileURLToPath(import.meta.url)), '.devnet-topup-keys.json');
const { Permission, Permissions } = multisig.types;

function check(ok: boolean, what: string) {
  if (!ok) throw new Error(`FAILED: ${what}`);
  console.log(`ok - ${what}`);
}

async function main() {
  const connection = new Connection(RPC, 'confirmed');
  if ((await connection.getGenesisHash()) !== DEVNET_GENESIS) throw new Error('not devnet; refusing');

  const payer = process.env.DEVNET_PAYER_SECRET_KEY
    ? Keypair.fromSecretKey(parseSecretKey(process.env.DEVNET_PAYER_SECRET_KEY, 'DEVNET_PAYER_SECRET_KEY'))
    : Keypair.generate();
  const [signerA, signerB, proposer, hot, createKey] = Array.from({ length: 5 }, () => Keypair.generate());
  writeFileSync(
    KEY_FILE,
    JSON.stringify(
      Object.fromEntries(Object.entries({ payer, signerA, signerB, proposer, hot, createKey }).map(([k, v]) => [k, Array.from(v!.secretKey)])),
    ),
  );
  if (!process.env.DEVNET_PAYER_SECRET_KEY) {
    const sig = await connection.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, 'confirmed');
  }
  const fund = async (to: PublicKey, sol: number) =>
    sendAndConfirmTransaction(connection, new Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: to, lamports: Math.round(sol * LAMPORTS_PER_SOL) })), [payer]);
  await fund(signerA!.publicKey, 0.05);
  await fund(proposer!.publicKey, 0.1);

  // Multisig: two full signers, threshold 2, plus the Initiate-only proposer.
  const [multisigPda] = multisig.getMultisigPda({ createKey: createKey!.publicKey });
  const programConfig = await multisig.accounts.ProgramConfig.fromAccountAddress(connection, multisig.getProgramConfigPda({})[0]);
  await multisig.rpc.multisigCreateV2({
    connection, treasury: programConfig.treasury, createKey: createKey!, creator: payer, multisigPda, configAuthority: null,
    threshold: 2, timeLock: 0, rentCollector: null,
    members: [
      { key: signerA!.publicKey, permissions: Permissions.all() },
      { key: signerB!.publicKey, permissions: Permissions.all() },
      { key: proposer!.publicKey, permissions: Permissions.fromPermissions([Permission.Initiate]) },
    ],
    sendOptions: { skipPreflight: false },
  });
  await new Promise((r) => setTimeout(r, 2000));
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });
  await fund(vaultPda, 0.2);
  console.log('multisig', multisigPda.toBase58(), 'vault', vaultPda.toBase58());

  // Cards minted straight into the vault.
  const umi = createUmi(RPC, { commitment: 'confirmed' }).use(mplTokenMetadata()).use(mplCore());
  umi.use(signerIdentity(createSignerFromKeypair(umi, fromWeb3JsKeypair(payer))));
  const core = generateSigner(umi);
  await createCore(umi, { asset: core, name: 'Topup Core', uri: 'https://example.com/t.json', owner: publicKey(vaultPda.toBase58()) }).sendAndConfirm(umi);
  const pnft = generateSigner(umi);
  await createProgrammableNft(umi, {
    mint: pnft, name: 'Topup pNFT', uri: 'https://example.com/t.json', sellerFeeBasisPoints: percentAmount(0),
    tokenOwner: publicKey(vaultPda.toBase58()),
  }).sendAndConfirm(umi);
  await new Promise((r) => setTimeout(r, 2000));

  const config = {
    SOLANA_RPC_URL: RPC, HOT_WALLET_SECRET_KEY: JSON.stringify(Array.from(hot!.secretKey)), PRIORITY_FEE_MICROLAMPORTS: 10_000,
  } as Config;
  const chain = await createSolanaChain(config);
  const gatewayCfg = {
    rpcUrl: RPC, multisigAddress: multisigPda.toBase58(), hotWallet: chain.hotWallet, expectedVault: vaultPda.toBase58(),
    allowMainnet: undefined, getAsset: (m: string) => chain.getAsset(m), log,
  };

  let refused = false;
  await createSquadsGateway({ ...gatewayCfg, proposer: signerA! }).catch(() => { refused = true; });
  check(refused, 'gateway refuses a proposer that can vote and execute');

  const gw = await createSquadsGateway({ ...gatewayCfg, proposer: proposer! });
  const idx = await gw.nextTransactionIndex();
  const cards = [
    { id: 'core', nftMint: core.publicKey.toString(), tier: 'common' as const, valueUsd: 1 },
    { id: 'pnft', nftMint: pnft.publicKey.toString(), tier: 'common' as const, valueUsd: 1 },
  ];
  const hotBefore = await gw.hotWalletLamports();
  await gw.createTopUpProposal(idx, cards, BigInt(0.01 * LAMPORTS_PER_SOL));
  check((await gw.proposalState(idx)) === 'active', `proposal #${idx} is active after drafting`);

  let selfApproved = true;
  await multisig.rpc.proposalApprove({ connection, feePayer: proposer!, member: proposer!, multisigPda, transactionIndex: idx })
    .then(async (s) => { await connection.confirmTransaction(s, 'confirmed'); })
    .catch(() => { selfApproved = false; });
  check(!selfApproved, 'proposer cannot approve its own proposal');

  for (const m of [signerA!, signerB!]) {
    const s = await multisig.rpc.proposalApprove({ connection, feePayer: payer, member: m, multisigPda, transactionIndex: idx });
    await connection.confirmTransaction(s, 'confirmed');
  }
  check((await gw.proposalState(idx)) === 'approved', 'proposal approved by both signers');

  for (let i = 1; i <= 3; i++) {
    const s = await multisig.rpc.batchExecuteTransaction({ connection, feePayer: payer, member: signerA!, multisigPda, batchIndex: idx, transactionIndex: i });
    const res = await connection.confirmTransaction(s, 'confirmed');
    check(!res.value.err, `batch transaction ${i} executed`);
  }
  await new Promise((r) => setTimeout(r, 2000));
  check((await gw.proposalState(idx)) === 'executed', 'proposal reads executed');
  for (const c of cards) check((await chain.getAsset(c.nftMint))?.owner === chain.hotWallet, `${c.id} card is in the hot wallet`);
  check((await gw.hotWalletLamports()) - hotBefore === BigInt(0.01 * LAMPORTS_PER_SOL), 'hot wallet received 0.01 SOL');
  console.log('all checks passed');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
