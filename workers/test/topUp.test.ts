import { describe, expect, it } from 'vitest';
import {
  planTopUp, runTopUpTick, type ChainProposalState, type OpenProposal, type SquadsGateway, type Tier, type TopUpPolicy,
  type TopUpStore, type VaultCard,
} from '../src/topUp.js';
import { silentLog } from './fakes.js';

const policy: TopUpPolicy = {
  targets: { common: 3, uncommon: 1, rare: 1, grail: 0 },
  maxCards: 10,
  maxUsd: 1000,
  minHotLamports: 50_000_000n,
  solTopUpLamports: 100_000_000n,
};
const none = { common: 0, uncommon: 0, rare: 0, grail: 0 };
const card = (id: string, tier: Tier, valueUsd = 10): VaultCard => ({ id, nftMint: `mint-${id}`, tier, valueUsd });

describe('planTopUp', () => {
  it('fills each tier up to its target, oldest first', () => {
    const plan = planTopUp(
      { ...none, common: 1 },
      [card('c1', 'common'), card('r1', 'rare', 100), card('c2', 'common'), card('c3', 'common'), card('u1', 'uncommon', 40)],
      1_000_000_000n,
      policy,
    );
    expect(plan.cards.map((c) => c.id)).toEqual(['c1', 'c2', 'u1', 'r1']);
    expect(plan.solLamports).toBe(0n);
  });

  it('respects the card and dollar caps and reports what it skipped', () => {
    const plan = planTopUp(none, [card('c1', 'common', 30), card('c2', 'common', 30), card('r1', 'rare', 500)], 1n, {
      ...policy, maxUsd: 100,
    });
    expect(plan.cards.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(plan.skippedByCap).toBe(1);
    expect(plan.solLamports).toBe(100_000_000n);
  });

  it('proposes nothing when stocked and the hot wallet has SOL', () => {
    const plan = planTopUp({ common: 3, uncommon: 1, rare: 1, grail: 0 }, [card('c1', 'common')], 1_000_000_000n, policy);
    expect(plan.cards).toEqual([]);
    expect(plan.solLamports).toBe(0n);
  });
});

class MemStore implements TopUpStore {
  proposals: Array<OpenProposal & { status: string; cards: VaultCard[]; solLamports: bigint; note?: string }> = [];
  vault: VaultCard[] = [];
  available = { ...none };
  executed: string[] = [];
  clock = () => new Date();
  async openProposal() {
    const p = this.proposals.find((x) => x.status === 'creating' || x.status === 'active');
    return p ? { id: p.id, transactionIndex: p.transactionIndex, status: p.status as 'creating' | 'active', createdAt: p.createdAt } : null;
  }
  async vaultCandidates() {
    const taken = new Set(
      this.proposals.filter((p) => ['creating', 'active', 'executed'].includes(p.status)).flatMap((p) => p.cards.map((c) => c.id)),
    );
    return this.vault.filter((c) => !taken.has(c.id));
  }
  async availableByTier() { return { ...this.available }; }
  async insertProposal(p: { transactionIndex: bigint; solLamports: bigint; cards: VaultCard[] }) {
    if (await this.openProposal()) throw new Error('one open proposal at a time');
    const id = String(this.proposals.length + 1);
    this.proposals.push({ id, transactionIndex: p.transactionIndex, status: 'creating', createdAt: this.clock(), cards: p.cards, solLamports: p.solLamports });
    return id;
  }
  async setStatus(id: string, status: string, note?: string) {
    const p = this.proposals.find((x) => x.id === id)!;
    if (p.status === 'creating' || p.status === 'active') Object.assign(p, { status, note });
  }
  async markExecuted(id: string) { await this.setStatus(id, 'executed'); this.executed.push(id); }
}

class FakeSquads implements SquadsGateway {
  index = 5n;
  lamports = 1_000_000_000n;
  states = new Map<bigint, ChainProposalState>();
  created: Array<{ index: bigint; mints: string[]; sol: bigint }> = [];
  failCreate = false;
  async nextTransactionIndex() { return this.index + 1n; }
  async hotWalletLamports() { return this.lamports; }
  async createTopUpProposal(index: bigint, cards: VaultCard[], sol: bigint) {
    if (this.failCreate) throw new Error('rpc down');
    this.index = index;
    this.created.push({ index, mints: cards.map((c) => c.nftMint), sol });
    this.states.set(index, 'active');
  }
  async proposalState(index: bigint) { return this.states.get(index) ?? 'missing'; }
}

function setup() {
  const store = new MemStore();
  const squads = new FakeSquads();
  let t = Date.parse('2026-10-20T20:00:00Z');
  store.clock = () => new Date(t);
  const deps = { store, squads, policy, log: silentLog, now: () => new Date(t) };
  return { store, squads, deps, advance: (ms: number) => { t += ms; } };
}

describe('top-up tick', () => {
  it('proposes once, then waits on the signers instead of proposing again', async () => {
    const s = setup();
    s.store.vault = [card('c1', 'common'), card('c2', 'common')];
    const r = await runTopUpTick(s.deps);
    expect(r).toMatchObject({ kind: 'proposed', transactionIndex: '6', cards: 2 });
    expect(s.squads.created).toEqual([{ index: 6n, mints: ['mint-c1', 'mint-c2'], sol: 0n }]);
    expect(s.store.proposals[0]!.status).toBe('active');

    s.store.vault.push(card('c3', 'common'));
    expect(await runTopUpTick(s.deps)).toMatchObject({ kind: 'waiting', state: 'active' });
    expect(s.squads.created).toHaveLength(1);
  });

  it('records an executed top-up and never re-proposes its cards', async () => {
    const s = setup();
    s.store.vault = [card('c1', 'common')];
    await runTopUpTick(s.deps);
    s.squads.states.set(6n, 'executed');
    const r = await runTopUpTick(s.deps);
    expect(s.store.executed).toEqual(['1']);
    expect(r).toMatchObject({ kind: 'idle' });
    expect(s.squads.created).toHaveLength(1);
  });

  it('frees the cards of a rejected proposal for the next one', async () => {
    const s = setup();
    s.store.vault = [card('c1', 'common')];
    await runTopUpTick(s.deps);
    s.squads.states.set(6n, 'rejected');
    const r = await runTopUpTick(s.deps);
    expect(s.store.proposals[0]!.status).toBe('rejected');
    expect(r).toMatchObject({ kind: 'proposed', transactionIndex: '7' });
    expect(s.squads.created.at(-1)!.mints).toEqual(['mint-c1']);
  });

  it('waits after a failed create, then abandons it once it is clearly a leftover', async () => {
    const s = setup();
    s.store.vault = [card('c1', 'common')];
    s.squads.failCreate = true;
    expect(await runTopUpTick(s.deps)).toMatchObject({ kind: 'create_failed' });
    expect(s.store.proposals[0]!.status).toBe('creating');

    s.squads.failCreate = false;
    expect(await runTopUpTick(s.deps)).toMatchObject({ kind: 'waiting', state: 'missing' });
    expect(s.squads.created).toHaveLength(0);

    s.advance(11 * 60_000);
    const r = await runTopUpTick(s.deps);
    expect(s.store.proposals[0]!.status).toBe('abandoned');
    expect(r).toMatchObject({ kind: 'proposed' });
  });

  it('adopts a creating row whose proposal did go live', async () => {
    const s = setup();
    s.store.vault = [card('c1', 'common')];
    s.squads.failCreate = true;
    await runTopUpTick(s.deps);
    s.squads.states.set(6n, 'active'); // the create landed even though our call errored
    expect(await runTopUpTick(s.deps)).toMatchObject({ kind: 'waiting', state: 'active' });
    expect(s.store.proposals[0]!.status).toBe('active');
  });

  it('sends SOL alone when cards are stocked but the hot wallet is low', async () => {
    const s = setup();
    s.store.available = { common: 3, uncommon: 1, rare: 1, grail: 0 };
    s.squads.lamports = 1_000n;
    const r = await runTopUpTick(s.deps);
    expect(r).toMatchObject({ kind: 'proposed', cards: 0, solLamports: '100000000' });
  });
});
