/**
 * Makes a fresh Solana wallet for the game and saves its key to a file, so the key never has to be
 * printed, pasted or sent anywhere. Only the public address is shown.
 *
 *   cd workers && npx tsx scripts/new-wallet.ts ~/lotus-prize-wallet.json
 *
 * The file is a JSON array of 64 numbers (HOT_WALLET_SECRET_KEY accepts it, and so does Phantom's
 * import). It is written with owner-only permissions and an existing file is never overwritten.
 */
import { Keypair } from '@solana/web3.js';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const target = process.argv[2];
if (!target) throw new Error('usage: new-wallet.ts <path for the key file>');
const path = resolve(target.replace(/^~(?=\/)/, process.env.HOME ?? '~'));
const kp = Keypair.generate();
writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600, flag: 'wx' });
console.log(`new wallet: ${kp.publicKey.toBase58()}`);
console.log(`key saved to ${path} (owner-only). Back it up before relying on it.`);
