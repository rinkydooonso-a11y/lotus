import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type TransactionInstruction,
} from '@solana/web3.js';
import {
  ACCOUNT_SIZE,
  AccountLayout,
  createCloseAccountInstruction,
  createInitializeAccount3Instruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
  getMinimumBalanceForRentExemptAccount,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { MAINNET_CONFIRMATION_PHRASE, MAINNET_GENESIS_HASH } from './config.js';
import { checkSwapInstructions } from './buyerGateway.js';
import { USDC_MINT } from './collectorCrypt.js';
import type { CreatorFeeGateway } from './feeClaimer.js';
import type { SwapInQuote } from './creatorFees.js';

/**
 * Float fee sweeper (one wallet).
 *
 * Float launches the coin on Raydium LaunchLab and splits the trading fees on chain. The creator's share
 * is not claimed by us: Float's own payout bot calls its `ClaimDevFees` instruction, which moves the
 * creator share into the token account of the wallet chosen at launch ("Who gets the fees?" > Other
 * wallet). Observed on mainnet: the signer is the bot, the destination is the creator wallet's
 * associated token account for the paired token. So there is nothing for us to claim, and no key but
 * the game wallet's own is involved.
 *
 * What is left for us is to turn what lands there into SOL for the card fund:
 *  - paired with SOL, the fee arrives as wrapped SOL in the wallet's WSOL token account. We move it
 *    through a throwaway token account that we close straight away, so the wallet's own WSOL account
 *    stays open (Float needs it to exist to pay into it) and the SOL lands as lamports.
 *  - paired with anything else (USDC, a stock token), it is swapped to SOL through Jupiter, with the
 *    same checks and simulation as the pump.fun one-wallet mode.
 */

export interface FloatFeesConfig {
  rpcUrl: string;
  /** The token the coin is paired with (its fees are paid in it). Defaults to wrapped SOL. */
  pairMint: string;
  /** The one wallet: the fee recipient chosen at launch, fee payer, and owner of the tokens. */
  wallet: Keypair;
  allowMainnet: string | undefined;
  priorityFeeMicroLamports: number;
  /** Builds a swap of exactly `amount` of `inputMint` into SOL for `user`. */
  buildSwapIn(inputMint: string, amount: bigint, user: string, outputMint?: 'SOL' | 'USDC'): Promise<SwapInQuote>;
  /** A swap quoted with more price impact than this fraction is refused. */
  maxPriceImpact: number;
}

/** Wrapped SOL gets unwrapped, not swapped. */
export function isWrappedSol(mint: string): boolean {
  return mint === NATIVE_MINT.toBase58();
}

export async function createFloatFeeGateway(cfg: FloatFeesConfig): Promise<CreatorFeeGateway> {
  const connection = new Connection(cfg.rpcUrl, 'confirmed');
  if ((await connection.getGenesisHash()) === MAINNET_GENESIS_HASH && cfg.allowMainnet !== MAINNET_CONFIRMATION_PHRASE) {
    throw new Error(`Refusing to sweep fees on mainnet without LOTUS_ALLOW_MAINNET=${MAINNET_CONFIRMATION_PHRASE}.`);
  }
  const wallet = cfg.wallet.publicKey;
  const pair = new PublicKey(cfg.pairMint);
  const pairInfo = await connection.getAccountInfo(pair);
  if (!pairInfo) throw new Error(`paired token ${cfg.pairMint} not found`);
  const tokenProgram = pairInfo.owner;
  const decimals = (await getMint(connection, pair, 'confirmed', tokenProgram)).decimals;
  const wrapped = isWrappedSol(cfg.pairMint);
  if (wrapped && !tokenProgram.equals(TOKEN_PROGRAM_ID)) throw new Error('wrapped SOL must belong to the classic token program');
  // Float pays into this account. It is the standard associated token account of the wallet.
  const ata = getAssociatedTokenAddressSync(pair, wallet, false, tokenProgram);

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

  /** What the wallet gained in SOL (net of the fee it paid), read from the landed transaction. */
  const solGained = async (signature: string): Promise<bigint | null> => {
    for (let i = 0; i < 5; i++) {
      const t = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      if (t?.meta) return BigInt(t.meta.postBalances[0]! - t.meta.preBalances[0]!) + BigInt(t.meta.fee);
      await new Promise((r) => setTimeout(r, 1000));
    }
    return null;
  };

  const tokenBalance = async (): Promise<bigint> => {
    const info = await connection.getAccountInfo(ata, 'confirmed');
    return info && info.data.length >= AccountLayout.span ? AccountLayout.decode(info.data).amount : 0n;
  };

  // Float creates the account at launch; if it is missing, say so loudly now rather than at the first payout.
  if (!(await connection.getAccountInfo(ata, 'confirmed'))) {
    console.warn(`float fees: the wallet has no ${cfg.pairMint} token account yet (${ata.toBase58()}); Float creates it at launch`);
  }

  /** Simulates, bounds the money, signs and sends a transaction that turns `amount` of the pair into SOL. */
  const simulateAndSend = async (tx: VersionedTransaction, signers: Keypair[], amount: bigint, minLamports: bigint, what: string) => {
    const solBefore = BigInt(await connection.getBalance(wallet, 'confirmed'));
    const tokenBefore = await tokenBalance();
    const sim = await connection.simulateTransaction(tx, {
      sigVerify: false,
      replaceRecentBlockhash: false,
      commitment: 'confirmed',
      accounts: { encoding: 'base64', addresses: [wallet.toBase58(), ata.toBase58()] },
    });
    if (sim.value.err) throw new Error(`${what} simulation failed: ${JSON.stringify(sim.value.err)}`);
    const [w, t] = sim.value.accounts ?? [];
    if (!w || !t) throw new Error(`${what} simulation returned no account state`);
    const tokenAfter = AccountLayout.decode(Buffer.from(t.data[0] ?? '', 'base64')).amount;
    if (tokenBefore - tokenAfter > amount) throw new Error(`${what} would spend more of the token than asked`);
    const solGain = BigInt(w.lamports) - solBefore;
    if (solGain < minLamports) throw new Error(`${what} would deliver ${solGain} lamports, less than the expected minimum ${minLamports}`);
    tx.sign(signers);
    const signature = await send(tx, what);
    return { signature, lamports: await solGained(signature) };
  };

  const unwrap = async (amount: bigint) => {
    // A throwaway token account takes the wrapped SOL and is closed in the same transaction, so the
    // lamports (the tokens plus its own rent) go straight to the wallet and the real WSOL account is untouched.
    const temp = Keypair.generate();
    const rent = await getMinimumBalanceForRentExemptAccount(connection);
    const ixs: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: cfg.priorityFeeMicroLamports }),
      SystemProgram.createAccount({ fromPubkey: wallet, newAccountPubkey: temp.publicKey, lamports: rent, space: ACCOUNT_SIZE, programId: TOKEN_PROGRAM_ID }),
      createInitializeAccount3Instruction(temp.publicKey, NATIVE_MINT, wallet, TOKEN_PROGRAM_ID),
      createTransferCheckedInstruction(ata, NATIVE_MINT, temp.publicKey, wallet, amount, decimals, [], TOKEN_PROGRAM_ID),
      createCloseAccountInstruction(temp.publicKey, wallet, wallet, [], TOKEN_PROGRAM_ID),
    ];
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: wallet, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
    // Everything unwrapped comes back as lamports; only the network fee (two signatures plus priority) is lost.
    return simulateAndSend(tx, [cfg.wallet, temp], amount, amount - 1_000_000n, 'unwrap');
  };

  const swap = async (amount: bigint) => {
    const q = await cfg.buildSwapIn(cfg.pairMint, amount, wallet.toBase58());
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
    // Fees and token-account rent come out of the wallet too, so allow a little under the quoted minimum.
    const floor = q.minOutLamports > 10_000_000n ? q.minOutLamports - 10_000_000n : 0n;
    return simulateAndSend(tx, [cfg.wallet], amount, floor, 'swap');
  };

  const usdcAta = getAssociatedTokenAddressSync(USDC_MINT, wallet, false, TOKEN_PROGRAM_ID);
  const usdcBalance = async (): Promise<bigint> => {
    const info = await connection.getAccountInfo(usdcAta, 'confirmed');
    return info && info.data.length >= AccountLayout.span ? AccountLayout.decode(info.data).amount : 0n;
  };

  /** Swaps exactly `amount` of the pair into USDC, which stays in the wallet for the card buyer. */
  const swapUsdc = async (amount: bigint) => {
    if (wrapped) throw new Error('splitting wrapped SOL into USDC is not supported; pair the coin with a token');
    const q = await cfg.buildSwapIn(cfg.pairMint, amount, wallet.toBase58(), 'USDC');
    if (!(q.priceImpact <= cfg.maxPriceImpact)) {
      throw new Error(`USDC swap price impact ${(q.priceImpact * 100).toFixed(2)}% is above the ${(cfg.maxPriceImpact * 100).toFixed(2)}% limit; not swapping`);
    }
    const tx = VersionedTransaction.deserialize(q.tx);
    const msg = tx.message;
    if (!msg.staticAccountKeys[0]?.equals(wallet)) throw new Error('USDC swap transaction is not paid by this wallet');
    const luts: AddressLookupTableAccount[] = [];
    for (const l of msg.addressTableLookups) {
      const res = await connection.getAddressLookupTable(l.accountKey);
      if (!res.value) throw new Error(`lookup table ${l.accountKey.toBase58()} not found`);
      luts.push(res.value);
    }
    checkSwapInstructions(TransactionMessage.decompile(msg, { addressLookupTableAccounts: luts }).instructions, wallet.toBase58());
    for (let i = 1; i < msg.header.numRequiredSignatures; i++) {
      if (tx.signatures[i]?.every((b) => b === 0)) throw new Error('USDC swap transaction needs a signature we do not have');
    }
    const usdcBefore = await usdcBalance();
    const tokenBefore = await tokenBalance();
    const sim = await connection.simulateTransaction(tx, {
      sigVerify: false,
      replaceRecentBlockhash: false,
      commitment: 'confirmed',
      accounts: { encoding: 'base64', addresses: [ata.toBase58(), usdcAta.toBase58()] },
    });
    if (sim.value.err) throw new Error(`USDC swap simulation failed: ${JSON.stringify(sim.value.err)}`);
    const [t, u] = sim.value.accounts ?? [];
    if (!t || !u) throw new Error('USDC swap simulation returned no account state');
    const tokenAfter = AccountLayout.decode(Buffer.from(t.data[0] ?? '', 'base64')).amount;
    if (tokenBefore - tokenAfter > amount) throw new Error('USDC swap would spend more of the token than asked');
    const usdcAfter = AccountLayout.decode(Buffer.from(u.data[0] ?? '', 'base64')).amount;
    if (usdcAfter - usdcBefore < q.minOutLamports) throw new Error(`USDC swap would deliver ${usdcAfter - usdcBefore}, less than the quoted minimum ${q.minOutLamports}`);
    tx.sign([cfg.wallet]);
    const signature = await send(tx, 'USDC swap');
    const after = await usdcBalance();
    return { signature, usdc: after > usdcBefore ? after - usdcBefore : null };
  };

  return {
    // The creator share arrives on its own; there is no claim instruction for us to call.
    paidDirectly: true,

    async quote() {
      return { asset: wrapped ? 'WSOL' : cfg.pairMint, decimals, native: false };
    },

    async gasLamports() {
      return BigInt(await connection.getBalance(wallet, 'confirmed'));
    },

    async claimable() {
      return 0n;
    },

    async claim(): Promise<never> {
      throw new Error('Float pays the creator share into the wallet itself; there is nothing to claim');
    },

    async quoteTokenBalance() {
      return tokenBalance();
    },

    async swapToSol(amount) {
      if (amount <= 0n) throw new Error('swap amount must be positive');
      return wrapped ? unwrap(amount) : swap(amount);
    },

    async swapToUsdc(amount) {
      if (amount <= 0n) throw new Error('swap amount must be positive');
      return swapUsdc(amount);
    },
  };
}
