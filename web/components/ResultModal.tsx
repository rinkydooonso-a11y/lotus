"use client";
import type { OpenResult } from "@/lib/types";

const TIER_LABEL = { common: "Common", uncommon: "Uncommon", rare: "Rare", grail: "Grail" } as const;
const REJECT_TEXT: Record<string, string> = {
  too_far: "You're too far from this crate. Walk closer.",
  expired: "This crate expired.",
  already_opened: "This crate was already opened.",
  not_found: "Crate not found.",
  not_yours: "That crate isn't yours.",
  frozen: "Your account is under review.",
  anticheat: "We couldn't verify your location. Try again in a moment.",
  invalid_input: "Something went wrong. Try again.",
};

export function ResultModal({ result, onClose }: { result: OpenResult; onClose: () => void }) {
  return (
    <div className="sheet-back center" onClick={onClose}>
      <div className={`result ${result.kind === "card" ? "t-" + result.tier : ""}`} onClick={(e) => e.stopPropagation()}>
        {result.kind === "card" && (
          <>
            <div className={`badge b-${result.tier}`}>{TIER_LABEL[result.tier]}</div>
            <div className="cardart">{result.imageUrl /* eslint-disable-next-line @next/next/no-img-element */ ? <img src={result.imageUrl} alt={result.cardName} /> : <span>🃏</span>}</div>
            <h2>{result.cardName}</h2>
            <p className="muted">{result.grade} · ~${result.valueUsd.toLocaleString()}</p>
            <p className="small">{result.status === "sent" ? "Sent to your wallet." : "Heading to your wallet. This usually takes about a minute."}</p>
          </>
        )}
        {result.kind === "shards" && (
          <>
            <div className="shards">◆ +{result.shards}</div>
            <h2>Shards</h2>
            <p className="muted">{result.ticketsGained > 0 ? `That's a new ticket! You have ${result.ticketsTotal}.` : `${result.shardsTotal} / 10 toward your next ticket.`}</p>
          </>
        )}
        {result.kind === "rejected" && (
          <>
            <div className="shards">✕</div>
            <h2>Couldn't open</h2>
            <p className="muted">{REJECT_TEXT[result.code] ?? result.message}</p>
          </>
        )}
        <button className="btn" onClick={onClose}>{result.kind === "rejected" ? "OK" : "Nice"}</button>
      </div>
    </div>
  );
}
