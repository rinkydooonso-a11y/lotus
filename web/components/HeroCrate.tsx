"use client";
import type { Feed, FeedPull, Tier } from "@/lib/types";
import { TIER_LABEL, usd } from "@/lib/format";
import { CardThumb } from "./CardThumb";
import { CrateGlyph } from "./Icons";

const SAMPLE: { tier: Tier; grade: string }[] = [{ tier: "uncommon", grade: "PSA 9" }, { tier: "grail", grade: "PSA 10" }, { tier: "rare", grade: "PSA 10" }];

/** Graded cards fanning out of a crate over the local map. Uses real recent prizes when the feed has them. */
export function HeroCrate({ feed }: { feed: Feed | null }) {
  const real: FeedPull[] = [...(feed?.biggest ?? []), ...(feed?.recent ?? [])]
    .filter((p, i, a) => a.findIndex((q) => q.cardName === p.cardName) === i)
    .slice(0, 3);
  const cards = real.length === 3
    ? [real[1], real[0], real[2]].map((p) => ({ key: p.id, tier: p.tier, grade: p.grade, imageUrl: p.imageUrl, name: p.cardName, value: usd(p.valueUsd) }))
    : SAMPLE.map((s) => ({ key: s.tier, tier: s.tier, grade: s.grade, imageUrl: undefined, name: undefined, value: undefined }));
  return (
    <div className="hero-crate hide-phone" aria-hidden={real.length < 3}>
      <div className="hc-fan">
        {cards.map((c, i) => (
          <div key={c.key} className={`hc-card hc-${i}`}>
            <CardThumb tier={c.tier} grade={c.grade} imageUrl={c.imageUrl} name={c.name} size="lg" />
            {c.value && <p className="hc-meta"><span className={`tc-${c.tier}`}>{TIER_LABEL[c.tier]}</span><b className="num">{c.value}</b></p>}
          </div>
        ))}
      </div>
      <div className="hc-crate"><span className="hc-ring" /><CrateGlyph size={96} gold /></div>
    </div>
  );
}
