/**
 * Collector Crypt has minted cards under more than one Metaplex standard: older cards are
 * Token Metadata programmable NFTs (pNFTs), newer batches are Metaplex Core assets, and some
 * collectibles used Bubblegum (compressed). Each one needs a different transfer instruction,
 * so every asset is classified before we touch it.
 */
export type AssetStandard = 'pnft' | 'nft' | 'core' | 'compressed' | 'unsupported';

export interface AssetInfo {
  mint: string;
  standard: AssetStandard;
  /** Current owner as seen by the RPC node at `confirmed` commitment. */
  owner: string;
  /** Core: collection the asset belongs to (needed by the transfer). Token Metadata: verified collection. */
  collection: string | null;
  /** pNFT only: token-auth-rules rule set, if one is configured. */
  ruleSet: string | null;
  name: string | null;
}

export interface SignedTransfer {
  signature: string;
  lastValidBlockHeight: number;
  /** Serialized signed transaction. Not secret; stored so an in-flight send can be rebroadcast. */
  txBase64: string;
}

export type SignatureState =
  | { kind: 'landed' }
  /** Landed on chain but the instruction errored, so the NFT did not move. */
  | { kind: 'failed'; error: string }
  /** Seen by the node but not yet at `confirmed`. Treated as still in flight. */
  | { kind: 'processing' }
  | { kind: 'not_found' };

export interface Chain {
  hotWallet: string;
  getAsset(mint: string): Promise<AssetInfo | null>;
  buildSignedTransfer(asset: AssetInfo, recipient: string): Promise<SignedTransfer>;
  sendRaw(txBase64: string): Promise<void>;
  getSignatureState(signature: string): Promise<SignatureState>;
  getBlockHeight(): Promise<number>;
}

export type TxState = 'pending' | 'landed' | 'failed' | 'expired';

export interface PrizeTx {
  signature: string;
  lastValidBlockHeight: number;
  txBase64: string;
  state: TxState;
}

/** A claimed row of prize_sends, as returned by claimNextPrizeSend (see docs/contracts.md). */
export interface PrizeSendJob {
  id: string;
  openingId: string;
  inventoryItemId: string;
  nftMint: string;
  recipientAddress: string;
  attempts: number;
  status: string;
  txSignature: string | null;
}

/** The prize_sends queue API owned by @lotus/server (docs/contracts.md). Injected so tests can fake it. */
export interface PrizeQueue {
  claimNextPrizeSend(opts?: { lockMs?: number; maxAttempts?: number }): Promise<PrizeSendJob | null>;
  /** Called after signing and before broadcasting. */
  recordSubmittedSignature(jobId: string, signature: string): Promise<void>;
  markPrizeSent(jobId: string, signature: string): Promise<void>;
  /** Not permanent: retried later. Permanent: parked as 'failed' for an admin; the item stays reserved. */
  markPrizeFailed(jobId: string, error: string, opts?: { permanent?: boolean }): Promise<void>;
}

/**
 * Worker-owned log of every transaction built for a prize (table prize_send_txs). prize_sends
 * keeps only the latest signature; this keeps lastValidBlockHeight and the signed bytes, which
 * are what let us prove an earlier transaction is dead before building another.
 */
export interface TxLog {
  list(prizeSendId: string): Promise<PrizeTx[]>;
  insert(prizeSendId: string, tx: SignedTransfer): Promise<void>;
  setState(signature: string, state: TxState): Promise<void>;
}

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export const jsonLogger: Logger = {
  info: (msg, fields) => console.log(JSON.stringify({ level: 'info', msg, ...fields, t: new Date().toISOString() })),
  warn: (msg, fields) => console.warn(JSON.stringify({ level: 'warn', msg, ...fields, t: new Date().toISOString() })),
  error: (msg, fields) => console.error(JSON.stringify({ level: 'error', msg, ...fields, t: new Date().toISOString() })),
};
