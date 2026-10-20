import type {
  AssetInfo, AssetStandard, Chain, Logger, PrizeQueue, PrizeSendJob, PrizeTx, SignatureState, SignedTransfer, TxLog, TxState,
} from '../src/types.js';

export const HOT = 'HotWa11et1111111111111111111111111111111111';
export const WINNER = 'Winner11111111111111111111111111111111111111';
export const OTHER = 'Other111111111111111111111111111111111111111';
export const MINT = 'Mint1111111111111111111111111111111111111111';

export const silentLog: Logger = { info() {}, warn() {}, error() {} };

interface ChainTx { signature: string; mint: string; to: string; lvbh: number; status: 'unseen' | 'processing' | 'landed' | 'failed' }

/**
 * In-memory Solana: an NFT has exactly one owner; a transfer only succeeds if the hot wallet owns
 * it at execution time; a tx can execute at most once and never after its lastValidBlockHeight.
 */
export class FakeChain implements Chain {
  hotWallet = HOT;
  height = 1000;
  owners = new Map<string, string>([[MINT, HOT]]);
  standards = new Map<string, AssetStandard>();
  txs = new Map<string, ChainTx>();
  calls: string[] = [];
  private seq = 0;

  /** What happens to the next broadcasts: 'land' executes, 'drop' loses it, 'throw_but_land' executes then throws. */
  sendBehavior: Array<'land' | 'drop' | 'throw_but_land' | 'throw' | 'process'> = [];
  defaultSend: 'land' | 'drop' = 'land';
  failGetAsset = false;

  deliveries(mint = MINT): number {
    return [...this.txs.values()].filter((t) => t.mint === mint && t.status === 'landed').length;
  }

  async getAsset(mint: string): Promise<AssetInfo | null> {
    this.calls.push('getAsset');
    if (this.failGetAsset) throw new Error('rpc down');
    const owner = this.owners.get(mint);
    if (!owner) return null;
    return { mint, standard: this.standards.get(mint) ?? 'pnft', owner, collection: null, ruleSet: null, name: 'Card' };
  }

  async buildSignedTransfer(asset: AssetInfo, recipient: string): Promise<SignedTransfer> {
    this.calls.push('build');
    const signature = `sig${++this.seq}`;
    const lvbh = this.height + 150;
    this.txs.set(signature, { signature, mint: asset.mint, to: recipient, lvbh, status: 'unseen' });
    return { signature, lastValidBlockHeight: lvbh, txBase64: Buffer.from(signature).toString('base64') };
  }

  /** Runs a tx on chain, as a leader would. */
  execute(signature: string) {
    const tx = this.txs.get(signature);
    if (!tx || tx.status === 'landed' || tx.status === 'failed') return;
    if (this.height > tx.lvbh) return; // blockhash expired: can never land
    if (this.owners.get(tx.mint) === HOT) {
      this.owners.set(tx.mint, tx.to);
      tx.status = 'landed';
    } else {
      tx.status = 'failed';
    }
  }

  async sendRaw(txBase64: string): Promise<void> {
    this.calls.push('send');
    const signature = Buffer.from(txBase64, 'base64').toString();
    const behavior = this.sendBehavior.shift() ?? this.defaultSend;
    if (behavior === 'land' || behavior === 'throw_but_land') this.execute(signature);
    if (behavior === 'process') {
      const tx = this.txs.get(signature);
      if (tx && tx.status === 'unseen') tx.status = 'processing';
    }
    if (behavior === 'throw' || behavior === 'throw_but_land') throw new Error('broadcast timeout');
  }

  async getSignatureState(signature: string): Promise<SignatureState> {
    this.calls.push('status');
    const tx = this.txs.get(signature);
    if (!tx || tx.status === 'unseen') return { kind: 'not_found' };
    if (tx.status === 'processing') return { kind: 'processing' };
    if (tx.status === 'failed') return { kind: 'failed', error: 'owner mismatch' };
    return { kind: 'landed' };
  }

  async getBlockHeight(): Promise<number> {
    this.calls.push('height');
    return this.height;
  }
}

export class FakeQueue implements PrizeQueue {
  jobs = new Map<string, PrizeSendJob & { lastError?: string; permanent?: boolean }>();
  sent: Array<{ id: string; signature: string }> = [];
  failures: Array<{ id: string; error: string; permanent: boolean }> = [];

  add(job: Partial<PrizeSendJob> = {}): PrizeSendJob {
    const j: PrizeSendJob = {
      id: job.id ?? 'job1', openingId: 'open1', inventoryItemId: 'item1', nftMint: MINT,
      recipientAddress: WINNER, attempts: 0, status: 'queued', txSignature: null, ...job,
    };
    this.jobs.set(j.id, j);
    return j;
  }

  async claimNextPrizeSend(): Promise<PrizeSendJob | null> {
    for (const j of this.jobs.values()) {
      if (j.status === 'queued' || j.status === 'submitted') {
        j.status = 'processing';
        j.attempts++;
        return { ...j };
      }
    }
    return null;
  }

  async recordSubmittedSignature(jobId: string, signature: string) {
    const j = this.jobs.get(jobId)!;
    j.txSignature = signature;
    j.status = 'submitted';
  }

  async markPrizeSent(jobId: string, signature: string) {
    const j = this.jobs.get(jobId)!;
    j.status = 'sent';
    j.txSignature = signature;
    this.sent.push({ id: jobId, signature });
  }

  async markPrizeFailed(jobId: string, error: string, opts?: { permanent?: boolean }) {
    const j = this.jobs.get(jobId)!;
    j.status = opts?.permanent ? 'failed' : j.txSignature ? 'submitted' : 'queued';
    this.failures.push({ id: jobId, error, permanent: !!opts?.permanent });
  }
}

export class FakeTxLog implements TxLog {
  rows: Array<PrizeTx & { prizeSendId: string }> = [];

  async list(prizeSendId: string): Promise<PrizeTx[]> {
    return this.rows.filter((r) => r.prizeSendId === prizeSendId).map(({ prizeSendId: _, ...r }) => ({ ...r }));
  }

  async insert(prizeSendId: string, tx: SignedTransfer) {
    // Mirrors the partial unique index: one pending tx per prize.
    if (this.rows.some((r) => r.prizeSendId === prizeSendId && r.state === 'pending')) {
      throw new Error('duplicate key value violates unique constraint "prize_send_txs_one_pending"');
    }
    this.rows.push({ ...tx, state: 'pending', prizeSendId });
  }

  async setState(signature: string, state: TxState) {
    const r = this.rows.find((x) => x.signature === signature);
    if (r) r.state = state;
  }
}
