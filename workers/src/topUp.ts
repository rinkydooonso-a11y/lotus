import type { Logger } from './types.js';

/**
 * Top-up proposer: keeps the hot wallet stocked from the Squads vault without ever being able
 * to move anything itself.
 *
 * Each tick it compares 'available' cards per tier with a target, picks vault cards to cover the
 * gap (oldest first, under a card and dollar cap), and drafts ONE Squads proposal that moves them,
 * plus SOL if the hot wallet is low, to the hot wallet. Its key has only the Initiate permission:
 * signers approve and execute in the Squads app. Inventory sync makes the cards available once
 * they land.
 *
 * One open proposal at a time. Rows are written before any chain call, so a crash leaves a
 * 'creating' row that the next tick reconciles against chain state.
 */

export const TIERS = ['common', 'uncommon', 'rare', 'grail'] as const;
export type Tier = (typeof TIERS)[number];

export interface VaultCard {
  id: string;
  nftMint: string;
  tier: Tier;
  valueUsd: number;
}

export interface TopUpPolicy {
  /** Wanted 'available' cards per tier in the hot wallet. */
  targets: Record<Tier, number>;
  maxCards: number;
  maxUsd: number;
  /** Top up SOL when the hot wallet holds less than this. */
  minHotLamports: bigint;
  solTopUpLamports: bigint;
}

export interface PlannedTopUp {
  cards: VaultCard[];
  solLamports: bigint;
  /** Cards that would have helped but did not fit under the caps. */
  skippedByCap: number;
}

/** Pure: which vault cards (and how much SOL) to move. `candidates` must be oldest first. */
export function planTopUp(
  available: Record<Tier, number>,
  candidates: VaultCard[],
  hotLamports: bigint,
  policy: TopUpPolicy,
): PlannedTopUp {
  const cards: VaultCard[] = [];
  let usd = 0;
  let skippedByCap = 0;
  // Cheaper tiers first: they are won most often, and a dry tier only downgrades a win to shards.
  for (const tier of TIERS) {
    let need = Math.max(0, policy.targets[tier] - (available[tier] ?? 0));
    for (const c of candidates) {
      if (need === 0) break;
      if (c.tier !== tier) continue;
      if (cards.length >= policy.maxCards || usd + c.valueUsd > policy.maxUsd) {
        skippedByCap++;
        need--;
        continue;
      }
      cards.push(c);
      usd += c.valueUsd;
      need--;
    }
  }
  const solLamports = hotLamports < policy.minHotLamports ? policy.solTopUpLamports : 0n;
  return { cards, solLamports, skippedByCap };
}

export type ChainProposalState =
  | 'missing' // no proposal at this index created by our key
  | 'draft'
  | 'active'
  | 'approved'
  | 'executing'
  | 'executed'
  | 'rejected'
  | 'cancelled'
  | 'stale';

export interface OpenProposal {
  id: string;
  transactionIndex: bigint;
  status: 'creating' | 'active';
  createdAt: Date;
}

export interface TopUpStore {
  openProposal(): Promise<OpenProposal | null>;
  /**
   * Vault cards (location 'vault', status 'withheld') that are in no open or executed proposal,
   * oldest first. Executed ones have left the vault but sync hasn't seen them land yet.
   */
  vaultCandidates(): Promise<VaultCard[]>;
  /** 'available' cards per tier, plus executed top-up cards that sync hasn't flipped yet. */
  availableByTier(): Promise<Record<Tier, number>>;
  /** Inserts the proposal as 'creating' with its cards. Throws if another proposal is open. */
  insertProposal(p: { transactionIndex: bigint; solLamports: bigint; cards: VaultCard[] }): Promise<string>;
  setStatus(id: string, status: 'active' | 'rejected' | 'cancelled' | 'stale' | 'abandoned', note?: string): Promise<void>;
  /** Marks it executed and writes one 'topup' treasury event per card (and one for SOL). */
  markExecuted(id: string): Promise<void>;
}

/** Thrown by createTopUpProposal when it failed before anything reached the chain. */
export class NothingSentError extends Error {}

export interface SquadsGateway {
  /** Also re-checks the multisig's safety settings; throws if they no longer hold. */
  nextTransactionIndex(): Promise<bigint>;
  /** The given cards that the vault does not hold on chain right now. */
  notInVault(cards: VaultCard[]): Promise<VaultCard[]>;
  hotWalletLamports(): Promise<bigint>;
  /** Creates the batch, adds one transaction per card (and SOL), then activates the proposal. Throws NothingSentError if nothing landed. */
  createTopUpProposal(transactionIndex: bigint, cards: VaultCard[], solLamports: bigint): Promise<void>;
  proposalState(transactionIndex: bigint): Promise<ChainProposalState>;
}

export interface TopUpDeps {
  store: TopUpStore;
  squads: SquadsGateway;
  policy: TopUpPolicy;
  log: Logger;
  now?: () => Date;
  /** How long a 'creating' row may sit before it's treated as a crash leftover. */
  creatingTimeoutMs?: number;
}

export type TopUpOutcome =
  | { kind: 'waiting'; transactionIndex: string; state: ChainProposalState }
  | { kind: 'idle'; skippedByCap: number }
  | { kind: 'proposed'; transactionIndex: string; cards: number; solLamports: string; skippedByCap: number }
  | { kind: 'create_failed'; transactionIndex: string; error: string; nothingSent: boolean };

export async function runTopUpTick(deps: TopUpDeps): Promise<TopUpOutcome> {
  const { store, squads, policy, log } = deps;
  const now = deps.now ?? (() => new Date());
  const timeout = deps.creatingTimeoutMs ?? 10 * 60_000;

  const open = await store.openProposal();
  if (open) {
    const state = await squads.proposalState(open.transactionIndex);
    const idx = open.transactionIndex.toString();
    switch (state) {
      case 'executed':
        await store.markExecuted(open.id);
        log.info('top-up executed', { transactionIndex: idx });
        break;
      case 'rejected':
      case 'cancelled':
      case 'stale':
        await store.setStatus(open.id, state);
        log.warn('top-up closed without executing', { transactionIndex: idx, state });
        break;
      case 'missing':
      case 'draft': {
        const old = now().getTime() - open.createdAt.getTime() > timeout;
        if (open.status === 'creating' && old) {
          // A leftover draft can't be approved; its cards go back to the candidate pool.
          await store.setStatus(open.id, 'abandoned', `chain state ${state}`);
          log.warn('abandoned unfinished top-up proposal', { transactionIndex: idx, state });
          break;
        }
        return { kind: 'waiting', transactionIndex: idx, state };
      }
      default:
        if (open.status === 'creating') await store.setStatus(open.id, 'active');
        return { kind: 'waiting', transactionIndex: idx, state };
    }
  }

  const [available, candidates, hotLamports] = await Promise.all([
    store.availableByTier(),
    store.vaultCandidates(),
    squads.hotWalletLamports(),
  ]);
  // Never draft a card the vault doesn't hold: drop it, report it, and plan again without it.
  const excluded = new Set<string>();
  let plan = planTopUp(available, candidates, hotLamports, policy);
  for (let round = 0; round < 3 && plan.cards.length > 0; round++) {
    const gone = await squads.notInVault(plan.cards);
    if (gone.length === 0) break;
    for (const c of gone) excluded.add(c.id);
    log.warn('vault cards not on chain in the vault; left out of the top-up', { mints: gone.map((c) => c.nftMint) });
    plan = planTopUp(available, candidates.filter((c) => !excluded.has(c.id)), hotLamports, policy);
  }
  if (plan.cards.length > 0 && (await squads.notInVault(plan.cards)).length > 0) {
    log.warn('vault holdings keep changing; skipping this top-up');
    return { kind: 'idle', skippedByCap: plan.skippedByCap };
  }
  if (plan.cards.length === 0 && plan.solLamports === 0n) {
    if (plan.skippedByCap) log.warn('top-up needed but every card exceeds the caps', { skipped: plan.skippedByCap });
    return { kind: 'idle', skippedByCap: plan.skippedByCap };
  }

  const transactionIndex = await squads.nextTransactionIndex();
  const id = await store.insertProposal({ transactionIndex, solLamports: plan.solLamports, cards: plan.cards });
  const idx = transactionIndex.toString();
  try {
    await squads.createTopUpProposal(transactionIndex, plan.cards, plan.solLamports);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const nothingSent = err instanceof NothingSentError;
    // Nothing on chain: retire the row now so the next tick can retry. Otherwise it stays 'creating'
    // and later ticks reconcile it against chain state.
    if (nothingSent) await store.setStatus(id, 'abandoned', `nothing sent: ${error}`);
    log.error('top-up proposal creation failed', { transactionIndex: idx, error, nothingSent });
    return { kind: 'create_failed', transactionIndex: idx, error, nothingSent };
  }
  await store.setStatus(id, 'active');
  log.info('top-up proposed, waiting on signers', {
    transactionIndex: idx,
    cards: plan.cards.map((c) => c.nftMint),
    solLamports: plan.solLamports.toString(),
  });
  return {
    kind: 'proposed',
    transactionIndex: idx,
    cards: plan.cards.length,
    solLamports: plan.solLamports.toString(),
    skippedByCap: plan.skippedByCap,
  };
}
