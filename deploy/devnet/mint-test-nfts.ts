/**
 * Mints test NFTs on DEVNET into a hot wallet so the prize sender can be tried.
 * Mints one pNFT (Token Metadata programmable NFT) and one Metaplex Core asset by default.
 *
 *   cd deploy/devnet && npm install
 *   HELIUS_DEVNET_RPC="https://devnet.helius-rpc.com/?api-key=YOUR_KEY" npm run mint
 *   npm run mint -- 3        # 3 of each standard
 *
 * Hot wallet: uses HOT_WALLET_SECRET_KEY if set (base58 or JSON array); otherwise generates a fresh devnet
 * wallet and saves it to .devnet-hot-wallet.json (gitignored). Put that same key in the workers' HOT_WALLET_SECRET_KEY.
 * Refuses to run against anything that is not devnet. Never use a mainnet key here.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { generateSigner, keypairIdentity, percentAmount, publicKey, sol, type Keypair } from '@metaplex-foundation/umi';
import { createProgrammableNft, mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';
import { create as createCore, mplCore } from '@metaplex-foundation/mpl-core';

const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const RPC = process.env.HELIUS_DEVNET_RPC ?? process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const COUNT = Math.max(1, Math.min(10, Number(process.argv[2] ?? 1) || 1));
const WALLET_FILE = join(dirname(fileURLToPath(import.meta.url)), '.devnet-hot-wallet.json');
// Metadata is never fetched by the sender; any URL works for a plumbing test.
const METADATA_URI = 'https://example.com/lotus-devnet-test.json';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58decode(s: string): Uint8Array {
  const bytes: number[] = [0];
  for (const ch of s) {
    let carry = ALPHABET.indexOf(ch);
    if (carry < 0) throw new Error('secret key is not valid base58');
    for (let i = 0; i < bytes.length; i++) {
      carry += (bytes[i] ?? 0) * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const ch of s) { if (ch !== '1') break; bytes.push(0); }
  return Uint8Array.from(bytes.reverse());
}

function parseKey(raw: string): Uint8Array {
  const t = raw.trim();
  const bytes = t.startsWith('[') ? Uint8Array.from(JSON.parse(t) as number[]) : b58decode(t);
  if (bytes.length !== 64) throw new Error('secret key must be 64 bytes');
  return bytes;
}

const umi = createUmi(RPC).use(mplTokenMetadata()).use(mplCore());

// Safety: devnet only.
const genesis = await umi.rpc.getGenesisHash();
if (genesis !== DEVNET_GENESIS) {
  console.error('RPC is not devnet (genesis hash mismatch). Refusing to run.');
  process.exit(1);
}

let keypair: Keypair;
if (process.env.HOT_WALLET_SECRET_KEY) {
  keypair = umi.eddsa.createKeypairFromSecretKey(parseKey(process.env.HOT_WALLET_SECRET_KEY));
} else if (existsSync(WALLET_FILE)) {
  keypair = umi.eddsa.createKeypairFromSecretKey(parseKey(readFileSync(WALLET_FILE, 'utf8')));
  console.log(`Reusing wallet from ${WALLET_FILE}`);
} else {
  keypair = umi.eddsa.generateKeypair();
  writeFileSync(WALLET_FILE, JSON.stringify(Array.from(keypair.secretKey)), { mode: 0o600 });
  console.log(`Generated a new devnet hot wallet, saved to ${WALLET_FILE} (gitignored).`);
}
umi.use(keypairIdentity(keypair));
console.log('Hot wallet public address:', umi.identity.publicKey);

// Fund it if needed (devnet airdrops are rate limited; the fallback is https://faucet.solana.com).
const balance = await umi.rpc.getBalance(umi.identity.publicKey);
if (balance.basisPoints < sol(0.5).basisPoints) {
  try {
    await umi.rpc.airdrop(umi.identity.publicKey, sol(2));
    console.log('Airdropped 2 devnet SOL.');
  } catch (e) {
    console.error('Airdrop failed (rate limited?). Fund the address above at https://faucet.solana.com, then re-run.');
    process.exit(1);
  }
}

const minted: { standard: string; mint: string; name: string }[] = [];
for (let i = 1; i <= COUNT; i++) {
  const pnftMint = generateSigner(umi);
  const pnftName = `Lotus Test pNFT #${i}`;
  await createProgrammableNft(umi, {
    mint: pnftMint,
    name: pnftName,
    uri: METADATA_URI,
    sellerFeeBasisPoints: percentAmount(0),
    tokenOwner: umi.identity.publicKey,
  }).sendAndConfirm(umi);
  minted.push({ standard: 'pnft', mint: pnftMint.publicKey, name: pnftName });
  console.log('Minted pNFT :', pnftMint.publicKey);

  const coreAsset = generateSigner(umi);
  const coreName = `Lotus Test Core #${i}`;
  await createCore(umi, {
    asset: coreAsset,
    name: coreName,
    uri: METADATA_URI,
    owner: publicKey(umi.identity.publicKey),
  }).sendAndConfirm(umi);
  minted.push({ standard: 'core', mint: coreAsset.publicKey, name: coreName });
  console.log('Minted Core :', coreAsset.publicKey);
}

console.log('\n--- Next steps ---');
console.log('1. Put the wallet secret in the workers HOT_WALLET_SECRET_KEY (Railway variables).');
console.log('   If you used the generated wallet, the key is in .devnet-hot-wallet.json (JSON array form works as-is).');
console.log('2. Wait ~2 minutes: inventory sync should list these as "untracked" in /admin.');
console.log('3. Add them to the prize pool (admin page, or run this SQL in the Supabase SQL editor):\n');
console.log('INSERT INTO inventory_items (nft_mint, card_name, grade, value_usd, tier) VALUES');
console.log(
  minted
    .map((m) => `  ('${m.mint}', '${m.name}', 'TEST', 5.00, 'common')`)
    .join(',\n') + ';',
);
console.log('\n(Check the tier values in db/migrations/0001_init.sql, type card_tier, and adjust "common" if it differs.)');
