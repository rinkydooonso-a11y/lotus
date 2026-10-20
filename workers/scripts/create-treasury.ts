/**
 * Creates the treasury's Squads v4 multisig. Dry run by default: it prints what it would create
 * and what it costs, and sends nothing until you add --send.
 *
 *   cd workers && TREASURY_NETWORK=mainnet SOLANA_RPC_URL=... TREASURY_SIGNERS=addr1,addr2,addr3 TREASURY_THRESHOLD=2 \
 *     PROPOSER_ADDRESS=... PAYER_KEYPAIR=~/.config/lotus/proposer.json npx tsx scripts/create-treasury.ts [--send]
 *
 * The multisig gets the given signers with full permissions, the proposer bot with Initiate only,
 * no config authority (membership and threshold can only change by a signer vote), and no time
 * lock. The threshold must be at least 2 unless TREASURY_ALLOW_SINGLE_SIGNER=yes-one-wallet-controls-the-vault.
 * TREASURY_NETWORK (mainnet or devnet) must match the RPC's network. PAYER_KEYPAIR is a path to a solana-keygen JSON file and only pays rent and the Squads fee;
 * it gets no say in the multisig unless it is also a signer. On mainnet --send also needs
 * LOTUS_ALLOW_MAINNET=yes-send-real-prizes-on-mainnet.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import { MAINNET_CONFIRMATION_PHRASE, MAINNET_GENESIS_HASH, parseSecretKey } from '../src/config.js';
import { assertSafeMultisig } from '../src/squads.js';

const { Permission, Permissions } = multisig.types;
const SINGLE_SIGNER_PHRASE = 'yes-one-wallet-controls-the-vault';
const GENESIS: Record<string, string> = { mainnet: MAINNET_GENESIS_HASH, devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' };

/** Set once a create may have reached the chain, so any later error repeats where to look. */
let sentAddress: string | null = null;

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is required`);
  return v;
}

async function main() {
  const send = process.argv.includes('--send');
  const network = need('TREASURY_NETWORK');
  if (!GENESIS[network]) throw new Error('TREASURY_NETWORK must be mainnet or devnet');
  const rpcUrl = need('SOLANA_RPC_URL');
  const connection = new Connection(rpcUrl, 'confirmed');
  if ((await connection.getGenesisHash()) !== GENESIS[network]) {
    throw new Error(`SOLANA_RPC_URL (${new URL(rpcUrl).host}) is not ${network}; refusing`);
  }
  const mainnet = network === 'mainnet';
  if (send && mainnet && process.env.LOTUS_ALLOW_MAINNET !== MAINNET_CONFIRMATION_PHRASE) {
    throw new Error(`Refusing to send on mainnet without LOTUS_ALLOW_MAINNET=${MAINNET_CONFIRMATION_PHRASE}.`);
  }

  const signers = need('TREASURY_SIGNERS').split(',').map((s) => new PublicKey(s.trim()));
  const threshold = Number(need('TREASURY_THRESHOLD'));
  const proposer = new PublicKey(need('PROPOSER_ADDRESS'));
  const unique = new Set(signers.map((s) => s.toBase58()));
  if (unique.size !== signers.length) throw new Error('TREASURY_SIGNERS has a duplicate');
  // A PDA (e.g. someone's Squads vault) is a valid address but can never sign.
  const offCurve = signers.filter((s) => !PublicKey.isOnCurve(s.toBytes()));
  if (offCurve.length) throw new Error(`not wallet addresses (can never sign): ${offCurve.map((s) => s.toBase58()).join(', ')}`);
  if (unique.has(proposer.toBase58())) throw new Error('the proposer bot must not also be a signer');
  // One signer is allowed only when asked for explicitly: then that one wallet is the vault's security.
  const singleOk = process.env.TREASURY_ALLOW_SINGLE_SIGNER === SINGLE_SIGNER_PHRASE;
  const minThreshold = singleOk ? 1 : 2;
  if (!Number.isInteger(threshold) || threshold < minThreshold || threshold > signers.length) {
    throw new Error(`TREASURY_THRESHOLD must be between ${minThreshold} and ${signers.length}`
      + (singleOk ? '' : ` (a 1-signer safe also needs TREASURY_ALLOW_SINGLE_SIGNER=${SINGLE_SIGNER_PHRASE})`));
  }

  const payerPath = need('PAYER_KEYPAIR').replace(/^~(?=\/)/, homedir());
  const payer = Keypair.fromSecretKey(parseSecretKey(readFileSync(payerPath, 'utf8'), 'PAYER_KEYPAIR'));
  const createKey = Keypair.generate();
  const [multisigPda] = multisig.getMultisigPda({ createKey: createKey.publicKey });
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });
  const programConfig = await multisig.accounts.ProgramConfig.fromAccountAddress(connection, multisig.getProgramConfigPda({})[0]);
  const fee = BigInt(programConfig.multisigCreationFee.toString());
  const balance = await connection.getBalance(payer.publicKey, 'confirmed');

  console.log(JSON.stringify({
    network,
    rpcHost: new URL(rpcUrl).host,
    signers: signers.map((s) => s.toBase58()),
    threshold: `${threshold} of ${signers.length}`,
    warning: threshold === 1 ? 'ONE SIGNER: whoever holds that one wallet controls the whole vault' : undefined,
    recovery: threshold === signers.length
      ? 'NONE: losing any one signer key locks the safe forever'
      : `still opens if up to ${signers.length - threshold} signer key(s) are lost`,
    proposer: `${proposer.toBase58()} (Initiate only)`,
    payer: payer.publicKey.toBase58(),
    payerSol: balance / LAMPORTS_PER_SOL,
    squadsCreationFeeSol: Number(fee) / LAMPORTS_PER_SOL,
    rentSolApprox: 0.01,
    multisig: multisigPda.toBase58(),
    vault: vaultPda.toBase58(),
  }, null, 2));
  if (!send) {
    console.log('dry run; nothing sent. Add --send to create it (the addresses above change on each run).');
    return;
  }

  console.log(`creating ${multisigPda.toBase58()}. If this errors, check that address on an explorer before re-running: a re-run creates a second safe.`);
  sentAddress = multisigPda.toBase58();
  const sig = await multisig.rpc.multisigCreateV2({
    connection, treasury: programConfig.treasury, createKey, creator: payer, multisigPda,
    configAuthority: null, threshold, timeLock: 0, rentCollector: null,
    members: [
      ...signers.map((key) => ({ key, permissions: Permissions.all() })),
      { key: proposer, permissions: Permissions.fromPermissions([Permission.Initiate]) },
    ],
    sendOptions: { skipPreflight: false },
  });
  await connection.confirmTransaction(sig, 'confirmed');
  const ms = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda, 'confirmed');
  assertSafeMultisig(ms, proposer, threshold);
  // Belt and braces: the account is exactly what was asked for.
  const members = new Map(ms.members.map((m) => [m.key.toBase58(), m.permissions]));
  const full = [Permission.Initiate, Permission.Vote, Permission.Execute];
  const exact = ms.threshold === threshold && ms.timeLock === 0 && members.size === signers.length + 1
    && members.has(proposer.toBase58())
    && signers.every((s) => { const p = members.get(s.toBase58()); return p && full.every((f) => Permissions.has(p, f)); });
  if (!exact) throw new Error(`multisig ${multisigPda.toBase58()} does not match what was requested; do not use it`);
  console.log(JSON.stringify({ created: sig, SQUADS_MULTISIG_ADDRESS: multisigPda.toBase58(), SQUADS_VAULT_ADDRESS: vaultPda.toBase58() }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  if (sentAddress) console.error(`A safe may already exist at ${sentAddress}. Check it on an explorer before re-running.`);
  process.exit(1);
});
