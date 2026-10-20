import type { Tier } from "@/lib/types";

/** Graded-slab thumbnail. Falls back to a drawn slab when the card has no image. */
export function CardThumb({ tier, grade, imageUrl, size = "md" }: { tier: Tier; grade: string; imageUrl?: string; size?: "md" | "lg" }) {
  return (
    <div className={`slab s-${tier} ${size}`}>
      <div className="slab-label"><span>{grade}</span></div>
      <div className="slab-art">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {imageUrl ? <img src={imageUrl} alt="" loading="lazy" /> : <i />}
      </div>
    </div>
  );
}
