"use client";
import { useState } from "react";
import { LINKS, coinLive } from "@/lib/links";
import { Icon } from "./Icon";

/** Contract address pill: copies the full address. */
export function CaChip({ full = false }: { full?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { if (coinLive) void navigator.clipboard?.writeText(LINKS.coin).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };
  const shown = !coinLive ? "Launching soon" : full ? LINKS.coin : `${LINKS.coin.slice(0, 4)}…${LINKS.coin.slice(-4)}`;
  return (
    <button className={`ca${full ? " full" : ""}${coinLive ? "" : " soon"}`} onClick={copy} title={coinLive ? "Copy contract address" : "Contract address coming soon"}>
      <span className="ca-label">CA</span><span className="ca-value">{copied ? "Copied" : shown}</span>
      {coinLive && <Icon name={copied ? "check" : "copy"} size={14} />}
    </button>
  );
}

export function XButton() {
  return (
    <a className="icon-btn" href={LINKS.x} target="_blank" rel="noopener noreferrer" aria-label="CardQuest on X">
      <Icon name="x" size={15} />
    </a>
  );
}
