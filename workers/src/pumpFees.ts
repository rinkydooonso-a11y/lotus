import { createRequire } from 'node:module';
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import { AccountLayout, getAssociatedTokenAddressSync, getMint, NATIVE_MINT } from '@solana/spl-token';
import type * as PumpSdk from '@pump-fun/pump-sdk';
import { MAINNET_CONFIRMATION_PHRASE, MAINNET_GENESIS_HASH } from './config.js';
import type { FeeGateway, Shareholder } from './feeClaimer.js';

// The SDK's ESM build doesn't load under Node (anchor is CommonJS), so take its CommonJS build.
const pump = createRequire(import.meta.url)('@pump-fun/pump-sdk') as typeof PumpSdk;

export interface PumpFeesConfig {
  rpcUrl: string;
  /** The coin whose creator fees we claim. */
  coinMint: string;
  /** Squads vault address: where our share lands. */
  vault: string;
  /** Pays gas and any ATA rent. Holds no fees. */
  payer: Keypair;
  allowMainnet: string | undefined;
  priorityFeeMicroLamports: number;
}

export async function createPumpFeeGateway(cfg: PumpFeesConfig): Promise<FeeGateway> {
  const connection = new Connection(cfg.rpcUrl, 'confirmed');
  if ((await connection.getGenesisHash()) === MAINNET_GENESIS_HASH && cfg.allowMainnet !== MAINNET_CONFIRMATION_PHRASE) {
    throw new Error(`Refusing to claim fees on mainnet without LOTUS_ALLOW_MAINNET=${MAINNET_CONFIRMATION_PHRASE}.`);
  }
  const sdk = new pump.OnlinePumpSdk(connection);
  const mint = new PublicKey(cfg.coinMint);
  const curve = await sdk.fetchBondingCurve(mint);
  const quoteMint: PublicKey = curve.quoteMint;
  const native = quoteMint.equals(NATIVE_MINT);
  const quoteInfo = native ? null : await connection.getAccountInfo(quoteMint);
  if (!native && !quoteInfo) throw new Error(`quote mint ${quoteMint.toBase58()} not found`);
  const quoteTokenProgram = quoteInfo?.owner;
  const decimals = native ? 9 : (await getMint(connection, quoteMint, 'confirmed', quoteTokenProgram)).decimals;
  const vault = new PublicKey(cfg.vault);
  // A Squads vault is a PDA, hence allowOwnerOffCurve.
  const vaultAta = native ? null : getAssociatedTokenAddressSync(quoteMint, vault, true, quoteTokenProgram);
  const watched = vaultAta ?? vault;

  const balanceOf = (data: Buffer | null, lamports: number): bigint =>
    native ? BigInt(lamports) : data && data.length >= AccountLayout.span ? AccountLayout.decode(data).amount : 0n;

  const buildTx = async (): Promise<VersionedTransaction> => {
    const { instructions } = await sdk.buildDistributeCreatorFeesInstructions(mint, {
      quoteMint,
      quoteTokenProgram,
      payer: cfg.payer.publicKey,
    });
    const ixs: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: cfg.priorityFeeMicroLamports }),
      ...instructions,
    ];
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const tx = new VersionedTransaction(
      new TransactionMessage({ payerKey: cfg.payer.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(),
    );
    tx.sign([cfg.payer]);
    return tx;
  };

  const vaultBalance = async (): Promise<bigint> => {
    const info = await connection.getAccountInfo(watched, 'confirmed');
    return info ? balanceOf(info.data, info.lamports) : 0n;
  };

  return {
    async quote() {
      return { asset: native ? 'SOL' : quoteMint.toBase58(), decimals };
    },
    async shareholders(): Promise<Shareholder[]> {
      const info = await connection.getAccountInfo(pump.feeSharingConfigPda(mint), 'confirmed');
      if (!info) throw new Error(`no fee-sharing config for ${cfg.coinMint}; fees can't be distributed permissionlessly`);
      return pump.PUMP_SDK.decodeSharingConfig(info).shareholders.map((s) => ({
        address: s.address.toBase58(),
        shareBps: s.shareBps,
      }));
    },
    async gasLamports() {
      return BigInt(await connection.getBalance(cfg.payer.publicKey, 'confirmed'));
    },
    vaultBalance,
    async simulateVaultGain() {
      const before = await vaultBalance();
      const sim = await connection.simulateTransaction(await buildTx(), {
        commitment: 'confirmed',
        accounts: { encoding: 'base64', addresses: [watched.toBase58()] },
      });
      if (sim.value.err) throw new Error(`distribution simulation failed: ${JSON.stringify(sim.value.err)}`);
      const acct = sim.value.accounts?.[0];
      const after = acct ? balanceOf(Buffer.from(acct.data[0] ?? '', 'base64'), acct.lamports) : before;
      return after > before ? after - before : 0n;
    },
    async sendDistribution() {
      const tx = await buildTx();
      const signature = await connection.sendTransaction(tx, { maxRetries: 3 });
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      const res = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
      if (res.value.err) throw new Error(`distribution ${signature} failed: ${JSON.stringify(res.value.err)}`);
      return signature;
    },
  };
}
