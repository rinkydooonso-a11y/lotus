"use client";
import { useState } from "react";
import { LINKS, coinLive } from "@/lib/links";

/** Contract address pill: copies the full address. */
export function CaChip({ full = false }: { full?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { if (coinLive) void navigator.clipboard?.writeText(LINKS.coin).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };
  const shown = !coinLive ? "coming soon" : full ? LINKS.coin : `${LINKS.coin.slice(0, 4)}…${LINKS.coin.slice(-4)}`;
  return (
    <button className={full ? "ca full" : "ca"} onClick={copy} title={coinLive ? "Copy contract address" : "Contract address coming soon"}>
      <span className="ca-label">CA</span><span className="ca-value">{copied ? "Copied" : shown}</span>
      {coinLive && <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" strokeWidth="2" /></svg>}
    </button>
  );
}

export function XButton() {
  return (
    <a className="x-btn" href={LINKS.x} target="_blank" rel="noopener noreferrer" aria-label="CardQuest on X">
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77L17.75 3Zm-1.08 16.2h1.7L7.4 4.7H5.58l11.09 14.5Z" /></svg>
    </a>
  );
}
