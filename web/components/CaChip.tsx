"use client";
import { useState } from "react";
import { LINKS, coinLive } from "@/lib/links";
import { IconCheck, IconCopy, IconX } from "./Icons";

/** Contract address chip: copies the full address once the coin is live. */
export function CaChip({ full = false, className = "" }: { full?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { if (coinLive) void navigator.clipboard?.writeText(LINKS.coin).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };
  const shown = !coinLive ? "Launching soon" : full ? LINKS.coin : `${LINKS.coin.slice(0, 4)}…${LINKS.coin.slice(-4)}`;
  return (
    <button className={`ca${full ? " full" : ""}${coinLive ? "" : " soon"} ${className}`} onClick={copy} title={coinLive ? "Copy contract address" : "Contract address coming soon"}>
      <span className="ca-label">CA</span><span className="ca-value">{copied ? "Copied" : shown}</span>
      {coinLive && (copied ? <IconCheck size={14} /> : <IconCopy size={14} />)}
    </button>
  );
}

export function XButton({ className = "" }: { className?: string }) {
  return (
    <a className={`x-btn ${className}`} href={LINKS.x} target="_blank" rel="noopener noreferrer" aria-label="CardQuest on X">
      <IconX size={14} />
    </a>
  );
}
