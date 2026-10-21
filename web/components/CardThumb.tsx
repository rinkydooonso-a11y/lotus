import type { Tier } from "@/lib/types";

/**
 * A graded slab: clear case, grading label, card window and a foil sheen in the tier colour.
 * Without an image it draws a card face, so empty data still reads as a card.
 */
export function CardThumb({ tier, grade, imageUrl, name, size = "md" }: { tier: Tier; grade: string; imageUrl?: string; name?: string; size?: "sm" | "md" | "lg" | "xl" }) {
  const big = size === "lg" || size === "xl";
  return (
    <div className={`slab t-${tier} ${size}`}>
      <div className="slab-label">
        {big && name && <span className="slab-name">{name}</span>}
        <b>{grade}</b>
      </div>
      <div className="slab-art">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {imageUrl ? <img src={imageUrl} alt="" loading="lazy" /> : <i className="face" />}
        <span className="foil" aria-hidden="true" />
      </div>
    </div>
  );
}
