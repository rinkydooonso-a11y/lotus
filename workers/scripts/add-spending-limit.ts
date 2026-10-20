/**
 * Proposes the card buyer's weekly budget: a Squads spending limit that lets the hot wallet pull
 * up to BUDGET_SOL per week from vault 0, to itself only. Dry run by default; --send creates the
 * proposal, which the signers then approve and execute in the Squads app. Nothing moves until they do.
 *
 *   cd workers && TREASURY_NETWORK=mainnet SOLANA_RPC_URL=... SQUADS_MULTISIG_ADDRESS=... \
 *     HOT_WALLET_ADDRESS=... BUDGET_SOL=2 PROPOSER_KEYPAIR=~/.config/lotus/proposer.json \
 *     npx tsx scripts/add-spending-limit.ts [--send]
 *
 * PROPOSER_KEYPAIR is the Initiate-only proposer bot: it can create the proposal but not approve it.
 * Once executed, set BUYER_SPENDING_LIMIT to the printed address.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import { MAINNET_CONFIRMATION_PHRASE, MAINNET_GENESIS_HASH, parseSecretKey } from '../src/config.js';

const GENESIS: Record<string, string> = { mainnet: MAINNET_GENESIS_HASH, devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' };

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
  if ((await connection.getGenesisHash()) !== GENESIS[network]) throw new Error(`SOLANA_RPC_URL (${new URL(rpcUrl).host}) is not ${network}; refusing`);
  if (send && network === 'mainnet' && process.env.LOTUS_ALLOW_MAINNET !== MAINNET_CONFIRMATION_PHRASE) {
    throw new Error(`Refusing to send on mainnet without LOTUS_ALLOW_MAINNET=${MAINNET_CONFIRMATION_PHRASE}.`);
  }

  const multisigPda = new PublicKey(need('SQUADS_MULTISIG_ADDRESS'));
  const hot = new PublicKey(need('HOT_WALLET_ADDRESS'));
  const budgetSol = Number(need('BUDGET_SOL'));
  if (!(budgetSol > 0 && budgetSol <= 100)) throw new Error('BUDGET_SOL must be between 0 and 100');
  const amount = BigInt(Math.round(budgetSol * LAMPORTS_PER_SOL));
  const proposer = Keypair.fromSecretKey(
    parseSecretKey(readFileSync(need('PROPOSER_KEYPAIR').replace(/^~(?=\/)/, homedir()), 'utf8'), 'PROPOSER_KEYPAIR'),
  );

  const ms = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda, 'confirmed');
  if (ms.members.some((m) => m.key.equals(hot))) throw new Error('the hot wallet must not be a member of the multisig');
  const me = ms.members.find((m) => m.key.equals(proposer.publicKey));
  if (!me || !multisig.types.Permissions.has(me.permissions, multisig.types.Permission.Initiate)) {
    throw new Error('PROPOSER_KEYPAIR is not a member with the Initiate permission');
  }
  const transactionIndex = BigInt(ms.transactionIndex.toString()) + 1n;
  const createKey = Keypair.generate().publicKey;
  const [spendingLimit] = multisig.getSpendingLimitPda({ multisigPda, createKey });
  const [vault] = multisig.getVaultPda({ multisigPda, index: 0 });

  console.log(JSON.stringify({
    network,
    multisig: multisigPda.toBase58(),
    vault: vault.toBase58(),
    proposal: `#${transactionIndex}: add spending limit`,
    budget: `${budgetSol} SOL per week, from the vault to ${hot.toBase58()} only`,
    spender: hot.toBase58(),
    BUYER_SPENDING_LIMIT: spendingLimit.toBase58(),
  }, null, 2));
  if (!send) {
    console.log('dry run; nothing sent. Add --send to create the proposal (the address above changes on each run).');
    return;
  }

  const tx = new Transaction().add(
    multisig.instructions.configTransactionCreate({
      multisigPda, transactionIndex, creator: proposer.publicKey,
      actions: [{
        __kind: 'AddSpendingLimit', createKey, vaultIndex: 0, mint: PublicKey.default, amount: Number(amount),
        period: multisig.types.Period.Week, members: [hot], destinations: [hot],
      }],
    }),
    multisig.instructions.proposalCreate({ multisigPda, transactionIndex, creator: proposer.publicKey }),
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [proposer], { commitment: 'confirmed' });
  console.log(JSON.stringify({ created: sig, next: 'approve and execute it in the Squads app, then set BUYER_SPENDING_LIMIT', BUYER_SPENDING_LIMIT: spendingLimit.toBase58() }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
