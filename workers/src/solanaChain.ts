import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  keypairIdentity,
  publicKey,
  transactionBuilder,
  unwrapOptionRecursively,
  type Umi,
} from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import {
  mplTokenMetadata,
  fetchDigitalAssetWithTokenByMint,
  transferV1 as tmTransferV1,
  TokenStandard,
} from '@metaplex-foundation/mpl-token-metadata';
import { mplCore, fetchAssetV1, transferV1 as coreTransferV1 } from '@metaplex-foundation/mpl-core';
import { setComputeUnitLimit, setComputeUnitPrice } from '@metaplex-foundation/mpl-toolbox';
import { MAINNET_CONFIRMATION_PHRASE, MAINNET_GENESIS_HASH, parseSecretKey, type Config } from './config.js';
import { dasGetAsset } from './das.js';
import type { AssetInfo, Chain, SignatureState, SignedTransfer } from './types.js';

const MPL_CORE_PROGRAM = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d';
const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

export async function createSolanaChain(config: Config): Promise<Chain> {
  const umi = createUmi(config.SOLANA_RPC_URL, { commitment: 'confirmed' }).use(mplTokenMetadata()).use(mplCore());
  const keypair = umi.eddsa.createKeypairFromSecretKey(parseSecretKey(config.HOT_WALLET_SECRET_KEY));
  umi.use(keypairIdentity(keypair));

  const genesis = await umi.rpc.getGenesisHash();
  if (genesis === MAINNET_GENESIS_HASH && config.LOTUS_ALLOW_MAINNET !== MAINNET_CONFIRMATION_PHRASE) {
    throw new Error(
      `Refusing to run against mainnet. Set LOTUS_ALLOW_MAINNET=${MAINNET_CONFIRMATION_PHRASE} only after a human has signed off.`,
    );
  }
  const dasUrl = config.HELIUS_DAS_URL ?? config.SOLANA_RPC_URL;
  return new SolanaChain(umi, dasUrl, config.PRIORITY_FEE_MICROLAMPORTS);
}

class SolanaChain implements Chain {
  readonly hotWallet: string;

  constructor(
    private readonly umi: Umi,
    private readonly dasUrl: string,
    private readonly priorityFee: number,
  ) {
    this.hotWallet = umi.identity.publicKey.toString();
  }

  /** Reads the asset straight from chain state so ownership is never stale indexer data. */
  async getAsset(mint: string): Promise<AssetInfo | null> {
    const key = publicKey(mint);
    const account = await this.umi.rpc.getAccount(key);

    if (!account.exists) {
      // Compressed assets have no account; only the DAS indexer knows them.
      const das = await dasGetAsset(this.dasUrl, mint);
      if (!das) return null;
      return {
        mint,
        standard: das.compression?.compressed ? 'compressed' : 'unsupported',
        owner: das.ownership.owner,
        collection: das.grouping?.find((g) => g.group_key === 'collection')?.group_value ?? null,
        ruleSet: null,
        name: das.content?.metadata?.name ?? null,
      };
    }

    const program = account.owner.toString();
    if (program === MPL_CORE_PROGRAM) {
      const asset = await fetchAssetV1(this.umi, key);
      const ua = asset.updateAuthority;
      return {
        mint,
        standard: 'core',
        owner: asset.owner.toString(),
        collection: ua.type === 'Collection' && ua.address ? ua.address.toString() : null,
        ruleSet: null,
        name: asset.name,
      };
    }

    if (program === SPL_TOKEN_PROGRAM) {
      const da = await fetchDigitalAssetWithTokenByMint(this.umi, key);
      const standard = unwrapOptionRecursively(da.metadata.tokenStandard);
      const config = unwrapOptionRecursively(da.metadata.programmableConfig);
      const collection = unwrapOptionRecursively(da.metadata.collection);
      const isPnft = standard === TokenStandard.ProgrammableNonFungible;
      const isNft = standard === TokenStandard.NonFungible;
      return {
        mint,
        standard: isPnft ? 'pnft' : isNft ? 'nft' : 'unsupported',
        owner: da.token.owner.toString(),
        collection: collection?.verified ? collection.key.toString() : null,
        ruleSet: config?.ruleSet ? config.ruleSet.toString() : null,
        name: da.metadata.name,
      };
    }

    // Token-2022 and anything else: not a format Collector Crypt prizes use today.
    return { mint, standard: 'unsupported', owner: '', collection: null, ruleSet: null, name: null };
  }

  async buildSignedTransfer(asset: AssetInfo, recipient: string): Promise<SignedTransfer> {
    const umi = this.umi;
    const to = publicKey(recipient);
    let builder = transactionBuilder()
      .add(setComputeUnitLimit(umi, { units: asset.standard === 'core' ? 60_000 : 250_000 }))
      .add(setComputeUnitPrice(umi, { microLamports: this.priorityFee }));

    if (asset.standard === 'core') {
      builder = builder.add(
        coreTransferV1(umi, {
          asset: publicKey(asset.mint),
          collection: asset.collection ? publicKey(asset.collection) : undefined,
          newOwner: to,
        }),
      );
    } else if (asset.standard === 'pnft' || asset.standard === 'nft') {
      builder = builder.add(
        tmTransferV1(umi, {
          mint: publicKey(asset.mint),
          tokenOwner: umi.identity.publicKey,
          destinationOwner: to,
          tokenStandard: asset.standard === 'pnft' ? TokenStandard.ProgrammableNonFungible : TokenStandard.NonFungible,
          authorizationRules: asset.ruleSet ? publicKey(asset.ruleSet) : undefined,
        }),
      );
    } else {
      throw new Error(`cannot build transfer for ${asset.standard} asset`);
    }

    const blockhash = await umi.rpc.getLatestBlockhash({ commitment: 'confirmed' });
    const tx = await builder.setBlockhash(blockhash).buildAndSign(umi);
    const sig = tx.signatures[0];
    if (!sig) throw new Error('transaction has no fee-payer signature');
    return {
      signature: base58.deserialize(sig)[0],
      lastValidBlockHeight: blockhash.lastValidBlockHeight,
      txBase64: Buffer.from(umi.transactions.serialize(tx)).toString('base64'),
    };
  }

  async sendRaw(txBase64: string): Promise<void> {
    const tx = this.umi.transactions.deserialize(new Uint8Array(Buffer.from(txBase64, 'base64')));
    await this.umi.rpc.sendTransaction(tx, { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0 });
  }

  async getSignatureState(signature: string): Promise<SignatureState> {
    const [status] = await this.umi.rpc.getSignatureStatuses([base58.serialize(signature)], {
      searchTransactionHistory: true,
    });
    if (!status) return { kind: 'not_found' };
    if (status.error) return { kind: 'failed', error: JSON.stringify(status.error) };
    if (status.commitment === 'confirmed' || status.commitment === 'finalized') return { kind: 'landed' };
    return { kind: 'processing' };
  }

  async getBlockHeight(): Promise<number> {
    return this.umi.rpc.call<number>('getBlockHeight', [{ commitment: 'confirmed' }]);
  }
}
