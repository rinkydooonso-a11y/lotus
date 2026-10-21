"use client";
import { useEffect, useState } from "react";
import qrcode from "qrcode-generator";
import { IconCheck, IconCopy } from "./Icons";

/** "Play on your phone": QR for the current site, so desktop visitors can jump to mobile. */
export function QrCard({ className = "qr-card" }: { className?: string }) {
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => setUrl(window.location.origin), []);
  const host = url.replace(/^https?:\/\//, "");
  const svg = (() => {
    if (!url) return "";
    const q = qrcode(0, "M");
    q.addData(url);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  })();
  const copy = () => { void navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };
  return (
    <div className={className}>
      <div className="qr" aria-label="QR code to open CardQuest on your phone" dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="qr-text">
        <b>Play on your phone</b>
        <p>Scan it with your phone&apos;s camera to play in the browser. No download needed.</p>
        {host && <button className="copy-link" onClick={copy}>{copied ? "Copied" : host}{copied ? <IconCheck size={14} /> : <IconCopy size={14} />}</button>}
      </div>
    </div>
  );
}
