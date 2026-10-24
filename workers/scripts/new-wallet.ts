/**
 * Makes a fresh Solana wallet for the game and saves its key to a file, so the key never has to be
 * printed, pasted or sent anywhere. Only the public address is shown.
 *
 *   cd workers && npx tsx scripts/new-wallet.ts ~/lotus-prize-wallet.json
 *
 * Two owner-only files are written next to each other, and an existing file is never overwritten:
 * <path> is a JSON array of 64 numbers (what HOT_WALLET_SECRET_KEY takes), and <path>.base58.txt is
 * the same key as a base58 string (what Phantom's "Import private key" takes).
 */
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const target = process.argv[2];
if (!target) throw new Error('usage: new-wallet.ts <path for the key file>');
const path = resolve(target.replace(/^~(?=\/)/, process.env.HOME ?? '~'));
const kp = Keypair.generate();
writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600, flag: 'wx' });
console.log(`new wallet: ${kp.publicKey.toBase58()}`);
writeFileSync(`${path}.base58.txt`, bs58.encode(kp.secretKey), { mode: 0o600, flag: 'wx' });
console.log(`key saved to ${path} and ${path}.base58.txt (owner-only). Back them up before relying on them.`);
