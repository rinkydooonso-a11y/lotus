import { createHash } from 'node:crypto';
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  sendAndConfirmTransaction,
  type AddressLookupTableAccount,
  type TransactionInstruction,
} from '@solana/web3.js';
import { AccountLayout, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import * as multisig from '@sqds/multisig';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { MAINNET_CONFIRMATION_PHRASE, MAINNET_GENESIS_HASH } from './config.js';
import type { BuyerGateway, Listing, PurchaseState } from './cardBuyer.js';

const MPL_CORE = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d';
const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const ME_M2 = 'M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K';
const ME_MMM = 'mmm3XBJg5gk8XJxEKBvdgptZz6SgK4tXvn36sodowMc';

const anchorIx = (name: string) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8).toString('hex');

/**
 * Marketplace instructions a buy may contain. Anything else (listing, delisting, withdrawing,
 * bidding) is refused, so an API response can never get the hot wallet to sign away a card it holds.
 * A refused buy logs the program and discriminator, so a new legitimate variant can be added after review.
 */
export const BUY_INSTRUCTIONS: Record<string, Set<string>> = {
  [ME_M2]: new Set(
    ['deposit', 'buy', 'buy_v2', 'execute_sale', 'execute_sale_v2', 'mip1_execute_sale_v2', 'ocp_execute_sale_v2', 'core_execute_sale_v2'].map(anchorIx),
  ),
  [ME_MMM]: new Set(
    ['sol_fulfill_sell', 'sol_mip1_fulfill_sell', 'sol_ocp_fulfill_sell', 'sol_ext_fulfill_sell', 'sol_mpl_core_fulfill_sell'].map(anchorIx),
  ),
};

/**
 * Pure: refuses any instruction outside a buy. Allowed at top level: compute budget, memo, a
 * plain SOL transfer, creating an associated token account, and the marketplace buy instructions
 * above. No top-level token, metadata or account-assign instruction can ever pass.
 */
export function checkBuyInstructions(ixs: TransactionInstruction[], allowed = BUY_INSTRUCTIONS): void {
  for (const ix of ixs) {
    const program = ix.programId.toBase58();
    if (program === ComputeBudgetProgram.programId.toBase58() || program === MEMO) continue;
    if (program === SystemProgram.programId.toBase58()) {
      if (ix.data.length >= 4 && ix.data.readUInt32LE(0) === 2) continue; // Transfer, capped by the balance check
      throw new Error('buy transaction has a system instruction other than a transfer');
    }
    if (program === ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()) {
      if (ix.data.length === 0 || ix.data[0] === 0 || ix.data[0] === 1) continue; // Create / CreateIdempotent
      throw new Error('buy transaction has an unexpected associated-token instruction');
    }
    const ok = allowed[program];
    const disc = ix.data.subarray(0, 8).toString('hex');
    if (!ok) throw new Error(`buy transaction calls a program we don't allow: ${program}`);
    if (!ok.has(disc)) throw new Error(`buy transaction has an instruction we don't allow: ${program} ${disc}`);
  }
}

export interface BuyerGatewayConfig {
  rpcUrl: string;
  hot: Keypair;
  multisigAddress: string;
  spendingLimitAddress: string;
  allowMainnet: string | undefined;
  /** Returns the marketplace's serialized buy transaction for `buyer`. */
  buildBuyTx(listing: Listing, buyer: string): Promise<Uint8Array>;
  /** SOL price source; refused if outside [min, max]. */
  solUsd(): Promise<number>;
  solUsdBounds: [number, number];
  getOwner(mint: string): Promise<string | null>;
}

const PERIOD_SECONDS: Record<number, number> = { 1: 86_400, 2: 604_800, 3: 2_592_000 };

export async function createBuyerGateway(cfg: BuyerGatewayConfig): Promise<BuyerGateway> {
  const connection = new Connection(cfg.rpcUrl, 'confirmed');
  if ((await connection.getGenesisHash()) === MAINNET_GENESIS_HASH && cfg.allowMainnet !== MAINNET_CONFIRMATION_PHRASE) {
    throw new Error(`Refusing to buy cards on mainnet without LOTUS_ALLOW_MAINNET=${MAINNET_CONFIRMATION_PHRASE}.`);
  }
  const hot = cfg.hot.publicKey;
  const multisigPda = new PublicKey(cfg.multisigAddress);
  const spendingLimit = new PublicKey(cfg.spendingLimitAddress);

  const readLimit = async () => {
    const sl = await multisig.accounts.SpendingLimit.fromAccountAddress(connection, spendingLimit, 'confirmed');
    if (!sl.multisig.equals(multisigPda)) throw new Error('spending limit belongs to a different multisig');
    if (!sl.mint.equals(PublicKey.default)) throw new Error('spending limit is not for SOL');
    if (sl.vaultIndex !== 0) throw new Error('spending limit is not for vault 0');
    if (!sl.members.some((m) => m.equals(hot))) throw new Error('hot wallet is not a member of the spending limit');
    if (sl.destinations.length > 0 && !sl.destinations.some((d) => d.equals(hot))) {
      throw new Error('spending limit does not allow the hot wallet as a destination');
    }
    return sl;
  };
  await readLimit();

  const state = async (signature: string) =>
    (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];

  return {
    hotWallet: hot.toBase58(),

    async solUsd() {
      const p = await cfg.solUsd();
      const [min, max] = cfg.solUsdBounds;
      if (!(p >= min && p <= max)) throw new Error(`SOL price ${p} is outside the sanity range ${min}-${max}`);
      return p;
    },

    async budget() {
      const sl = await readLimit();
      const period = PERIOD_SECONDS[sl.period as number];
      const now = Math.floor(Date.now() / 1000);
      const reset = period !== undefined && now - Number(sl.lastReset) > period;
      const remaining = BigInt((reset ? sl.amount : sl.remainingAmount).toString());
      return { walletLamports: BigInt(await connection.getBalance(hot, 'confirmed')), limitRemainingLamports: remaining };
    },

    async pullFromVault(lamports) {
      const ix = multisig.instructions.spendingLimitUse({
        multisigPda, member: hot, spendingLimit, vaultIndex: 0, amount: Number(lamports), decimals: 9, destination: hot,
        memo: 'card buyer budget',
      });
      return sendAndConfirmTransaction(connection, new Transaction().add(ix), [cfg.hot], { commitment: 'confirmed' });
    },

    async prepareBuy(listing, maxSpend) {
      const tx = VersionedTransaction.deserialize(await cfg.buildBuyTx(listing, hot.toBase58()));
      const msg = tx.message;
      if (!msg.staticAccountKeys[0]?.equals(hot)) throw new Error('buy transaction is not paid by the hot wallet');
      const luts: AddressLookupTableAccount[] = [];
      for (const l of msg.addressTableLookups) {
        const res = await connection.getAddressLookupTable(l.accountKey);
        if (!res.value) throw new Error(`lookup table ${l.accountKey.toBase58()} not found`);
        luts.push(res.value);
      }
      checkBuyInstructions(TransactionMessage.decompile(msg, { addressLookupTableAccounts: luts }).instructions);
      // Every other required signature must already be present (e.g. the marketplace's notary).
      for (let i = 1; i < msg.header.numRequiredSignatures; i++) {
        if (tx.signatures[i]?.every((b) => b === 0)) throw new Error('buy transaction needs a signature we do not have');
      }

      // Where the card will sit once it is ours: the Core asset itself, or our token account.
      const mint = new PublicKey(listing.mint);
      const mintInfo = await connection.getAccountInfo(mint, 'confirmed');
      if (!mintInfo) throw new Error('card mint not found');
      const core = mintInfo.owner.toBase58() === MPL_CORE;
      const cardAccount = core ? mint : getAssociatedTokenAddressSync(mint, hot, false, mintInfo.owner);

      const before = BigInt(await connection.getBalance(hot, 'confirmed'));
      const sim = await connection.simulateTransaction(tx, {
        sigVerify: false,
        replaceRecentBlockhash: false,
        commitment: 'confirmed',
        accounts: { encoding: 'base64', addresses: [hot.toBase58(), cardAccount.toBase58()] },
      });
      if (sim.value.err) throw new Error(`buy simulation failed: ${JSON.stringify(sim.value.err)}`);
      const [payer, card] = sim.value.accounts ?? [];
      if (!payer || !card) throw new Error('simulation returned no account state');
      const spend = before - BigInt(payer.lamports);
      if (spend > maxSpend) throw new Error(`buy would spend ${spend} lamports, more than the allowed ${maxSpend}`);
      const data = Buffer.from(card.data[0] ?? '', 'base64');
      const ownsAfter = core
        ? data.length >= 33 && new PublicKey(data.subarray(1, 33)).equals(hot)
        : data.length >= AccountLayout.span && (() => {
          const a = AccountLayout.decode(data);
          return a.mint.equals(mint) && a.owner.equals(hot) && a.amount === 1n;
        })();
      if (!ownsAfter) throw new Error('simulation does not leave the card in the hot wallet');

      tx.sign([cfg.hot]);
      const signature = base58.deserialize(tx.signatures[0]!)[0];
      return {
        signature,
        async send() {
          await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 5 });
          for (let i = 0; i < 40; i++) {
            await new Promise((r) => setTimeout(r, 2000));
            const s = await state(signature);
            if (s?.err) throw new Error(`buy failed on chain: ${JSON.stringify(s.err)}`);
            if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') return;
          }
          throw new Error('buy not confirmed within 80s');
        },
      };
    },

    async purchaseState(signature, createdAt): Promise<PurchaseState> {
      const s = await state(signature);
      if (s?.err) return 'failed';
      if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') return 'landed';
      // A marketplace blockhash lives about a minute; five is well past any chance of landing.
      if (!s && Date.now() - createdAt.getTime() > 5 * 60_000) return 'expired';
      return 'pending';
    },

    async ownsCard(mint) {
      return (await cfg.getOwner(mint)) === hot.toBase58();
    },
  };
}
