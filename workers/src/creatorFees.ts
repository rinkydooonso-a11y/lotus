import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type TransactionInstruction,
} from '@solana/web3.js';
import { createRequire } from 'node:module';
import {
  AccountLayout,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  getMint,
  NATIVE_MINT,
} from '@solana/spl-token';
import type * as PumpSdk from '@pump-fun/pump-sdk';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { MAINNET_CONFIRMATION_PHRASE, MAINNET_GENESIS_HASH } from './config.js';
import { checkSwapInstructions } from './buyerGateway.js';
import type { CreatorFeeGateway } from './feeClaimer.js';

const pump = createRequire(import.meta.url)('@pump-fun/pump-sdk') as typeof PumpSdk;

/** A swap Jupiter built for us. Untrusted until the gateway has inspected and simulated it. */
export interface SwapInQuote {
  tx: Uint8Array;
  /** The least SOL, in lamports, the quote promises after slippage. */
  minOutLamports: bigint;
  /** Price impact as a fraction (0.01 = 1%). */
  priceImpact: number;
}

export interface CreatorFeesConfig {
  rpcUrl: string;
  /** The coin whose creator fees this wallet claims. Its creator must be `wallet`. */
  coinMint: string;
  /** The one wallet: creator of the coin, fee payer, and owner of the claimed tokens. */
  wallet: Keypair;
  allowMainnet: string | undefined;
  priorityFeeMicroLamports: number;
  /** Builds a swap of exactly `amount` of `inputMint` into SOL for `user`. */
  buildSwapIn(inputMint: string, amount: bigint, user: string, outputMint?: 'SOL' | 'USDC'): Promise<SwapInQuote>;
  /** A swap quoted with more price impact than this fraction is refused. */
  maxPriceImpact: number;
}

export async function createCreatorFeeGateway(cfg: CreatorFeesConfig): Promise<CreatorFeeGateway> {
  const connection = new Connection(cfg.rpcUrl, 'confirmed');
  if ((await connection.getGenesisHash()) === MAINNET_GENESIS_HASH && cfg.allowMainnet !== MAINNET_CONFIRMATION_PHRASE) {
    throw new Error(`Refusing to claim fees on mainnet without LOTUS_ALLOW_MAINNET=${MAINNET_CONFIRMATION_PHRASE}.`);
  }
  const wallet = cfg.wallet.publicKey;
  const sdk = new pump.OnlinePumpSdk(connection);
  const mint = new PublicKey(cfg.coinMint);
  const curve = await sdk.fetchBondingCurve(mint);
  // Fees are claimed by the creator's own signature, so refuse to run for a coin we aren't the creator of.
  if (!curve.creator.equals(wallet)) {
    throw new Error(`the coin's creator is ${curve.creator.toBase58()}, not this wallet (${wallet.toBase58()}); launch it from this wallet or use the vault mode`);
  }
  const quoteMint: PublicKey = curve.quoteMint;
  const native = quoteMint.equals(NATIVE_MINT);
  const quoteInfo = native ? null : await connection.getAccountInfo(quoteMint);
  if (!native && !quoteInfo) throw new Error(`quote mint ${quoteMint.toBase58()} not found`);
  const quoteTokenProgram = quoteInfo?.owner ?? undefined;
  const decimals = native ? 9 : (await getMint(connection, quoteMint, 'confirmed', quoteTokenProgram)).decimals;
  const quoteAta = native ? null : getAssociatedTokenAddressSync(quoteMint, wallet, false, quoteTokenProgram);

  /** Broadcasts a signed transaction and polls until it confirms, fails, or 80 s pass. */
  const send = async (tx: VersionedTransaction, what: string): Promise<string> => {
    const signature = base58.deserialize(tx.signatures[0]!)[0];
    await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 5 });
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const s = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
      if (s?.err) throw new Error(`${what} ${signature} failed on chain: ${JSON.stringify(s.err)}`);
      if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') return signature;
    }
    throw new Error(`${what} ${signature} not confirmed within 80s`);
  };

  /** What the wallet gained of `native` SOL (net of the fee it paid) or of the quote token, read from the landed transaction. */
  const gained = async (signature: string, asset: 'sol' | 'quote'): Promise<bigint | null> => {
    for (let i = 0; i < 5; i++) {
      const t = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      if (t?.meta) {
        if (asset === 'sol') return BigInt(t.meta.postBalances[0]! - t.meta.preBalances[0]!) + BigInt(t.meta.fee);
        const keys = t.transaction.message.getAccountKeys({ accountKeysFromLookups: t.meta.loadedAddresses }).staticAccountKeys
          .concat(t.meta.loadedAddresses?.writable ?? [], t.meta.loadedAddresses?.readonly ?? []);
        const idx = keys.findIndex((k) => k.equals(quoteAta!));
        if (idx < 0) return 0n;
        const amt = (list: typeof t.meta.preTokenBalances) => BigInt(list?.find((b) => b.accountIndex === idx)?.uiTokenAmount.amount ?? '0');
        return amt(t.meta.postTokenBalances) - amt(t.meta.preTokenBalances);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return null;
  };

  const tokenBalance = async (): Promise<bigint> => {
    const info = await connection.getAccountInfo(quoteAta!, 'confirmed');
    return info && info.data.length >= AccountLayout.span ? AccountLayout.decode(info.data).amount : 0n;
  };

  return {
    async quote() {
      return { asset: native ? 'SOL' : quoteMint.toBase58(), decimals, native };
    },

    async gasLamports() {
      return BigInt(await connection.getBalance(wallet, 'confirmed'));
    },

    async claimable() {
      const rows = await sdk.getCreatorVaultQuoteBalances(wallet, [quoteMint]);
      const row = rows.find((r) => r.mint.equals(quoteMint));
      return row ? BigInt(row.total.toString()) : 0n;
    },

    async claim() {
      const ixs: TransactionInstruction[] = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: cfg.priorityFeeMicroLamports }),
      ];
      // Neither pump program creates the creator's token account, so make sure it exists first.
      if (quoteAta) ixs.push(createAssociatedTokenAccountIdempotentInstruction(wallet, quoteAta, wallet, quoteMint, quoteTokenProgram));
      ixs.push(...(await sdk.collectCoinCreatorFeeV2Instructions(wallet, quoteMint, quoteTokenProgram ?? new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), wallet)));
      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      const tx = new VersionedTransaction(new TransactionMessage({ payerKey: wallet, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
      const sim = await connection.simulateTransaction(tx, { sigVerify: false, commitment: 'confirmed' });
      if (sim.value.err) throw new Error(`claim simulation failed: ${JSON.stringify(sim.value.err)}`);
      tx.sign([cfg.wallet]);
      const signature = await send(tx, 'claim');
      return { signature, received: await gained(signature, native ? 'sol' : 'quote') };
    },

    async quoteTokenBalance() {
      return native ? 0n : tokenBalance();
    },

    async swapToSol(amount) {
      if (native || !quoteAta) throw new Error('nothing to swap: the coin is paired with SOL');
      if (amount <= 0n) throw new Error('swap amount must be positive');
      const q = await cfg.buildSwapIn(quoteMint.toBase58(), amount, wallet.toBase58());
      if (!(q.priceImpact <= cfg.maxPriceImpact)) {
        throw new Error(`swap price impact ${(q.priceImpact * 100).toFixed(2)}% is above the ${(cfg.maxPriceImpact * 100).toFixed(2)}% limit; not swapping`);
      }
      const tx = VersionedTransaction.deserialize(q.tx);
      const msg = tx.message;
      if (!msg.staticAccountKeys[0]?.equals(wallet)) throw new Error('swap transaction is not paid by this wallet');
      const luts: AddressLookupTableAccount[] = [];
      for (const l of msg.addressTableLookups) {
        const res = await connection.getAddressLookupTable(l.accountKey);
        if (!res.value) throw new Error(`lookup table ${l.accountKey.toBase58()} not found`);
        luts.push(res.value);
      }
      checkSwapInstructions(TransactionMessage.decompile(msg, { addressLookupTableAccounts: luts }).instructions, wallet.toBase58());
      for (let i = 1; i < msg.header.numRequiredSignatures; i++) {
        if (tx.signatures[i]?.every((b) => b === 0)) throw new Error('swap transaction needs a signature we do not have');
      }

      // The simulation bounds the money: it may spend no more than `amount` of the token and must pay at least the quoted minimum.
      const solBefore = BigInt(await connection.getBalance(wallet, 'confirmed'));
      const tokenBefore = await tokenBalance();
      const sim = await connection.simulateTransaction(tx, {
        sigVerify: false,
        replaceRecentBlockhash: false,
        commitment: 'confirmed',
        accounts: { encoding: 'base64', addresses: [wallet.toBase58(), quoteAta.toBase58()] },
      });
      if (sim.value.err) throw new Error(`swap simulation failed: ${JSON.stringify(sim.value.err)}`);
      const [w, t] = sim.value.accounts ?? [];
      if (!w || !t) throw new Error('swap simulation returned no account state');
      const tokenAfter = AccountLayout.decode(Buffer.from(t.data[0] ?? '', 'base64')).amount;
      if (tokenBefore - tokenAfter > amount) throw new Error('swap would spend more of the token than asked');
      const solGain = BigInt(w.lamports) - solBefore;
      // Fees and token-account rent come out of the wallet too, so allow a little under the quoted minimum.
      if (solGain + 10_000_000n < q.minOutLamports) throw new Error(`swap would deliver ${solGain} lamports, less than the quoted minimum ${q.minOutLamports}`);

      tx.sign([cfg.wallet]);
      const signature = await send(tx, 'swap');
      return { signature, lamports: await gained(signature, 'sol') };
    },
  };
}
