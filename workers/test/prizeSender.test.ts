import { describe, expect, it } from 'vitest';
import { processJob, processJobSafely, runPrizeSenderTick, type SenderDeps } from '../src/prizeSender.js';
import { FakeChain, FakeQueue, FakeTxLog, HOT, MINT, OTHER, WINNER, silentLog } from './fakes.js';

function setup(opts: { blocksPerPoll?: number; maxTxs?: number } = {}) {
  const chain = new FakeChain();
  const queue = new FakeQueue();
  const txLog = new FakeTxLog();
  let clock = 0;
  const deps: SenderDeps = {
    queue, txLog, chain, log: silentLog,
    maxTxsPerPrize: opts.maxTxs ?? 5,
    settleBudgetMs: 140_000,
    pollMs: 2_000,
    now: () => clock,
    // Each poll the chain moves on a few blocks.
    sleep: async (ms) => { clock += ms; chain.height += opts.blocksPerPoll ?? 5; },
  };
  return { chain, queue, txLog, deps };
}

async function claim(queue: FakeQueue) {
  const job = await queue.claimNextPrizeSend();
  if (!job) throw new Error('no job');
  return job;
}

describe('prize sender', () => {
  it('sends once and marks the prize sent', async () => {
    const { chain, queue, txLog, deps } = setup();
    queue.add();
    expect(await runPrizeSenderTick(deps, 5)).toEqual(['sent']);
    expect(chain.owners.get(MINT)).toBe(WINNER);
    expect(chain.deliveries()).toBe(1);
    expect(queue.sent).toEqual([{ id: 'job1', signature: 'sig1' }]);
    expect(txLog.rows.map((r) => r.state)).toEqual(['landed']);
    // Nothing left to claim, so a second tick does nothing.
    expect(await runPrizeSenderTick(deps, 5)).toEqual([]);
  });

  it('records the signature before broadcasting', async () => {
    const { chain, queue, txLog, deps } = setup();
    queue.add();
    let recordedBeforeSend = false;
    const origSend = chain.sendRaw.bind(chain);
    chain.sendRaw = async (b64) => {
      recordedBeforeSend = txLog.rows.length === 1 && queue.jobs.get('job1')!.txSignature === 'sig1';
      return origSend(b64);
    };
    await runPrizeSenderTick(deps, 1);
    expect(recordedBeforeSend).toBe(true);
  });

  it('after a crash post-broadcast, finds the landed tx and does not build another', async () => {
    const { chain, queue, txLog, deps } = setup();
    queue.add();
    // Simulate: worker built, recorded, broadcast (it landed), then died before markPrizeSent.
    const asset = (await chain.getAsset(MINT))!;
    const signed = await chain.buildSignedTransfer(asset, WINNER);
    await txLog.insert('job1', signed);
    await queue.recordSubmittedSignature('job1', signed.signature);
    await chain.sendRaw(signed.txBase64);
    chain.calls = [];

    expect(await processJob(await claim(queue), deps)).toBe('sent');
    expect(chain.calls).not.toContain('build');
    expect(chain.deliveries()).toBe(1);
    expect(queue.sent[0]?.signature).toBe('sig1');
  });

  it('waits on a tx whose blockhash is still valid instead of building a new one', async () => {
    const { chain, queue, txLog, deps } = setup();
    queue.add();
    // First broadcast is lost in the network; the rebroadcast lands.
    chain.sendBehavior = ['drop', 'land'];
    expect(await processJob(await claim(queue), deps)).toBe('sent');
    expect(chain.calls.filter((c) => c === 'build')).toHaveLength(1);
    expect(chain.deliveries()).toBe(1);
    expect(txLog.rows).toHaveLength(1);
  });

  it('builds a new tx only after the old one has provably expired', async () => {
    const { chain, queue, txLog, deps } = setup({ blocksPerPoll: 40 });
    queue.add();
    // The first tx and all its rebroadcasts are lost until it expires; the second lands.
    chain.defaultSend = 'drop';
    let builds = 0;
    const origBuild = chain.buildSignedTransfer.bind(chain);
    chain.buildSignedTransfer = async (a, r) => {
      builds++;
      if (builds === 2) chain.defaultSend = 'land';
      return origBuild(a, r);
    };
    expect(await processJob(await claim(queue), deps)).toBe('sent');
    expect(txLog.rows.map((r) => r.state)).toEqual(['expired', 'landed']);
    // The second build happened only once height had passed the first tx's lastValidBlockHeight.
    const first = txLog.rows[0]!;
    expect(chain.height).toBeGreaterThan(first.lastValidBlockHeight);
    expect(chain.deliveries()).toBe(1);
  });

  it('reads block height before signature status when deciding expiry', async () => {
    const { chain, queue, txLog, deps } = setup();
    queue.add();
    const asset = (await chain.getAsset(MINT))!;
    const signed = await chain.buildSignedTransfer(asset, WINNER);
    await txLog.insert('job1', signed);
    await queue.recordSubmittedSignature('job1', signed.signature);
    chain.calls = [];
    // The tx lands right after the height is read but before status is read. Reading status
    // first would see not_found, then a height past expiry, and wrongly call it dead.
    chain.height = signed.lastValidBlockHeight; // still valid at this height
    const origHeight = chain.getBlockHeight.bind(chain);
    chain.getBlockHeight = async () => {
      const h = await origHeight();
      chain.execute(signed.signature);
      chain.height = signed.lastValidBlockHeight + 1;
      return h;
    };
    expect(await processJob(await claim(queue), deps)).toBe('sent');
    expect(chain.calls.slice(0, 2)).toEqual(['height', 'status']);
    expect(chain.calls).not.toContain('build');
    expect(chain.deliveries()).toBe(1);
  });

  it('treats a broadcast error as maybe-sent and settles by signature', async () => {
    const { chain, queue, txLog, deps } = setup();
    queue.add();
    chain.sendBehavior = ['throw_but_land'];
    expect(await processJob(await claim(queue), deps)).toBe('sent');
    expect(txLog.rows).toHaveLength(1);
    expect(chain.deliveries()).toBe(1);
  });

  it('keeps waiting on a processing tx and leaves it submitted when out of time', async () => {
    const { chain, queue, txLog, deps } = setup({ blocksPerPoll: 0 });
    queue.add();
    chain.defaultSend = 'drop';
    chain.sendBehavior = ['process'];
    expect(await processJob(await claim(queue), deps)).toBe('still_in_flight');
    expect(queue.jobs.get('job1')!.status).toBe('submitted');
    expect(txLog.rows.map((r) => r.state)).toEqual(['pending']);
    expect(chain.calls.filter((c) => c === 'build')).toHaveLength(1);
  });

  it('builds a new tx after one fails on chain, and gives up at the cap', async () => {
    const { chain, queue, deps } = setup({ maxTxs: 3 });
    queue.add();
    // Every transfer fails on chain (e.g. card is locked by a delegate).
    chain.execute = (sig) => { const t = chain.txs.get(sig); if (t) t.status = 'failed'; };
    expect(await processJob(await claim(queue), deps)).toBe('failed_permanent');
    expect(chain.calls.filter((c) => c === 'build')).toHaveLength(3);
    expect(queue.failures.at(-1)).toMatchObject({ permanent: true });
    expect(chain.owners.get(MINT)).toBe(HOT);
  });

  it('marks sent without sending when the winner already holds the card', async () => {
    const { chain, queue, txLog, deps } = setup();
    queue.add();
    // A tx we built expired as far as we know, yet the card is with the winner.
    txLog.rows.push({ prizeSendId: 'job1', signature: 'old', lastValidBlockHeight: 1, txBase64: '', state: 'expired' });
    chain.owners.set(MINT, WINNER);
    expect(await processJob(await claim(queue), deps)).toBe('sent');
    expect(chain.calls).not.toContain('build');
  });

  it('stops for an admin when the hot wallet no longer holds the card', async () => {
    const { chain, queue, deps } = setup();
    queue.add();
    chain.owners.set(MINT, OTHER);
    expect(await processJob(await claim(queue), deps)).toBe('failed_permanent');
    expect(chain.calls).not.toContain('build');
    expect(queue.failures[0]).toMatchObject({ permanent: true });
  });

  it('stops for an admin on compressed assets and bad recipients', async () => {
    const a = setup();
    a.queue.add();
    a.chain.standards.set(MINT, 'compressed');
    expect(await processJob(await claim(a.queue), a.deps)).toBe('failed_permanent');

    const b = setup();
    b.queue.add({ recipientAddress: 'not-a-wallet' });
    expect(await processJob(await claim(b.queue), b.deps)).toBe('failed_permanent');

    const c = setup();
    c.queue.add({ recipientAddress: HOT });
    expect(await processJob(await claim(c.queue), c.deps)).toBe('failed_permanent');
    expect([a, b, c].every((s) => !s.chain.calls.includes('build'))).toBe(true);
  });

  it('retries on RPC errors without failing permanently', async () => {
    const { chain, queue, deps } = setup();
    queue.add();
    chain.failGetAsset = true;
    expect(await processJobSafely(await claim(queue), deps)).toBe('retry');
    expect(queue.failures[0]).toMatchObject({ permanent: false });
    expect(queue.jobs.get('job1')!.status).toBe('queued');
    chain.failGetAsset = false;
    expect(await runPrizeSenderTick(deps, 1)).toEqual(['sent']);
  });

  it('a signature the worker never recorded is checked, not resent', async () => {
    const { chain, queue, deps } = setup();
    queue.add({ txSignature: 'mystery', status: 'submitted' });
    expect(await processJob(await claim(queue), deps)).toBe('failed_permanent');
    expect(chain.calls).not.toContain('build');
  });

  it('two workers racing on the same job deliver the card once', async () => {
    const { chain, queue, txLog, deps } = setup();
    queue.add();
    const job = await claim(queue);
    // Simulate a stalled worker whose lock expired and a second worker that reclaimed the job.
    const results = await Promise.all([processJobSafely({ ...job }, deps), processJobSafely({ ...job }, deps)]);
    expect(results).toContain('sent');
    expect(chain.deliveries()).toBe(1);
    expect(chain.owners.get(MINT)).toBe(WINNER);
    expect(txLog.rows.filter((r) => r.state === 'landed')).toHaveLength(1);
  });

  it('processes a batch of different prizes', async () => {
    const { chain, queue, deps } = setup();
    for (let i = 1; i <= 3; i++) {
      const mint = `Mint${i}`.padEnd(44, '1');
      chain.owners.set(mint, HOT);
      queue.add({ id: `job${i}`, nftMint: mint, inventoryItemId: `item${i}` });
    }
    expect(await runPrizeSenderTick(deps, 10)).toEqual(['sent', 'sent', 'sent']);
    expect(queue.sent).toHaveLength(3);
  });
});
