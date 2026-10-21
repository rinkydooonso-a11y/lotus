"use client";
import type { OpenResult } from "@/lib/types";
import { TIER_LABEL, usd } from "@/lib/format";
import { CardThumb } from "./CardThumb";

const REJECT_TEXT: Record<string, string> = {
  too_far: "You're too far from this crate. Walk closer.",
  expired: "This crate expired.",
  already_opened: "This crate was already opened.",
  not_found: "Crate not found.",
  taken: "Another collector got to this crate first.",
  daily_limit: "That's your open for today. Bank 10 shards for a ticket and you can open another.",
  frozen: "Your account is under review.",
  anticheat: "We couldn't verify your location. Try again in a moment.",
  invalid_input: "Something went wrong. Try again.",
};

export function ResultModal({ result, onClose }: { result: OpenResult; onClose: () => void }) {
  return (
    <div className="sheet-back center" onClick={onClose}>
      <div className={`result ${result.kind === "card" ? "r-" + result.tier : ""}`} onClick={(e) => e.stopPropagation()}>
        {result.kind === "card" && (
          <>
            <div className="rays" aria-hidden="true" />
            <p className="eyebrow">You pulled</p>
            <CardThumb tier={result.tier} grade={result.grade} imageUrl={result.imageUrl} size="lg" />
            <span className={`badge b-${result.tier}`}>{TIER_LABEL[result.tier]}</span>
            <h2>{result.cardName}</h2>
            <p className="result-val"><b>{usd(result.valueUsd)}</b><span className="muted">{result.grade}</span></p>
            <p className="muted small">{result.status === "sent" ? "Sent to your wallet." : "Heading to your wallet. This usually takes about a minute."}</p>
          </>
        )}
        {result.kind === "shards" && (
          <>
            <p className="eyebrow">No card this time</p>
            <div className="shards">◆ +{result.shards}</div>
            <h2>{result.shards === 1 ? "Shard" : "Shards"}</h2>
            {result.ticketsGained > 0 ? <p className="muted">That&apos;s a new ticket! You have {result.ticketsTotal}.</p> : (
              <>
                <i className="bar wide"><i style={{ width: `${result.shardsTotal * 10}%` }} /></i>
                <p className="muted small">{result.shardsTotal} / 10 toward your next ticket</p>
              </>
            )}
          </>
        )}
        {result.kind === "rejected" && (
          <>
            <div className="shards dim">✕</div>
            <h2>Couldn&apos;t open</h2>
            <p className="muted">{REJECT_TEXT[result.code] ?? result.message}</p>
          </>
        )}
        <button className={result.kind === "rejected" ? "btn ghost" : "btn"} onClick={onClose}>{result.kind === "rejected" ? "OK" : result.kind === "card" ? "Keep hunting" : "Nice"}</button>
      </div>
    </div>
  );
}
