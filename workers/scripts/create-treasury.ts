/**
 * Creates the treasury's Squads v4 multisig. Dry run by default: it prints what it would create
 * and what it costs, and sends nothing until you add --send.
 *
 *   cd workers && SOLANA_RPC_URL=... TREASURY_SIGNERS=addr1,addr2,addr3 TREASURY_THRESHOLD=2 \
 *     PROPOSER_ADDRESS=... PAYER_KEYPAIR=~/.config/lotus/proposer.json npx tsx scripts/create-treasury.ts [--send]
 *
 * The multisig gets the given signers with full permissions, the proposer bot with Initiate only,
 * no config authority (membership and threshold can only change by a signer vote), and no time
 * lock. PAYER_KEYPAIR is a path to a solana-keygen JSON file and only pays rent and the Squads fee;
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

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is required`);
  return v;
}

async function main() {
  const send = process.argv.includes('--send');
  const connection = new Connection(need('SOLANA_RPC_URL'), 'confirmed');
  const mainnet = (await connection.getGenesisHash()) === MAINNET_GENESIS_HASH;
  if (send && mainnet && process.env.LOTUS_ALLOW_MAINNET !== MAINNET_CONFIRMATION_PHRASE) {
    throw new Error(`Refusing to send on mainnet without LOTUS_ALLOW_MAINNET=${MAINNET_CONFIRMATION_PHRASE}.`);
  }

  const signers = need('TREASURY_SIGNERS').split(',').map((s) => new PublicKey(s.trim()));
  const threshold = Number(need('TREASURY_THRESHOLD'));
  const proposer = new PublicKey(need('PROPOSER_ADDRESS'));
  const unique = new Set(signers.map((s) => s.toBase58()));
  if (unique.size !== signers.length) throw new Error('TREASURY_SIGNERS has a duplicate');
  if (unique.has(proposer.toBase58())) throw new Error('the proposer bot must not also be a signer');
  if (!Number.isInteger(threshold) || threshold < 2 || threshold > signers.length) {
    throw new Error(`TREASURY_THRESHOLD must be between 2 and ${signers.length}`);
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
    network: mainnet ? 'mainnet' : 'not mainnet',
    signers: signers.map((s) => s.toBase58()),
    threshold: `${threshold} of ${signers.length}`,
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
  assertSafeMultisig(ms, proposer, 2);
  console.log(JSON.stringify({ created: sig, SQUADS_MULTISIG_ADDRESS: multisigPda.toBase58(), SQUADS_VAULT_ADDRESS: vaultPda.toBase58() }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
