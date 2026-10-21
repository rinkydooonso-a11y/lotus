"use client";
import type { OpenResult } from "@/lib/types";
import { TIER_LABEL, usd } from "@/lib/format";
import { CardThumb } from "./CardThumb";
import { Sheet } from "./Sheet";
import { IconAlert, Shard, Ticket } from "./Icons";

const REJECT_TEXT: Record<string, string> = {
  too_far: "You're too far from this crate. Walk closer.",
  expired: "This crate expired.",
  already_opened: "This crate was already opened.",
  not_found: "Crate not found.",
  taken: "Another collector got to this crate first.",
  // daily_limit deliberately has no entry: the server's message carries today's actual numbers.
  frozen: "Your account is under review.",
  anticheat: "We couldn't verify your location. Try again in a moment.",
  invalid_input: "Something went wrong. Try again.",
};

export function ResultModal({ result, onClose, shardsPerTicket }: { result: OpenResult; onClose: () => void; shardsPerTicket: number }) {
  return (
    <Sheet onClose={onClose} label={result.kind === "card" ? "You pulled a card" : result.kind === "shards" ? "Shards" : "Couldn't open"} center className={`reveal ${result.kind === "card" ? "r-card t-" + result.tier : "r-" + result.kind}`}>
      {result.kind === "card" && (
        <>
          <div className="reveal-stage"><span className="reveal-glow" aria-hidden="true" /><CardThumb tier={result.tier} grade={result.grade} imageUrl={result.imageUrl} name={result.cardName} size="lg" /></div>
          <p className="reveal-kicker">You pulled</p>
          <h2>{result.cardName}</h2>
          <p className="reveal-meta"><span className={`tier-pill t-${result.tier}`}>{TIER_LABEL[result.tier]}</span><span>{result.grade}</span></p>
          <p className="reveal-value num">{usd(result.valueUsd)}</p>
          <p className="reveal-status"><span className={result.status === "sent" ? "dot ok" : "dot pending"} />{result.status === "sent" ? "Sent to your wallet." : "Heading to your wallet. This usually takes about a minute."}</p>
        </>
      )}
      {result.kind === "shards" && (
        <>
          <div className="reveal-stage small"><span className="reveal-glow" aria-hidden="true" /><span className="reveal-gem"><Shard size={72} /></span></div>
          <p className="reveal-kicker">No card this time</p>
          <h2>+{result.shards} {result.shards === 1 ? "shard" : "shards"}</h2>
          {result.ticketsGained > 0 ? <p className="reveal-note"><Ticket size={18} />That&apos;s a new ticket! You have {result.ticketsTotal}.</p> : (
            <div className="reveal-progress">
              <i className="bar"><i style={{ width: `${Math.min(100, (result.shardsTotal / shardsPerTicket) * 100)}%` }} /></i>
              <p>{result.shardsTotal} / {shardsPerTicket} toward your next ticket</p>
            </div>
          )}
        </>
      )}
      {result.kind === "rejected" && (
        <>
          <div className="reveal-icon"><IconAlert size={30} /></div>
          <h2>Couldn&apos;t open</h2>
          <p className="reveal-note">{REJECT_TEXT[result.code] ?? result.message}</p>
        </>
      )}
      <button className={result.kind === "rejected" ? "btn btn-lg btn-gray wide" : "btn btn-lg wide"} onClick={onClose}>{result.kind === "rejected" ? "OK" : result.kind === "card" ? "Keep hunting" : "Nice"}</button>
    </Sheet>
  );
}
