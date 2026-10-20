"use client";
import { useEffect, useState } from "react";
import qrcode from "qrcode-generator";

/** "Play on your phone": QR for the current site, so desktop visitors can jump to mobile. */
export function QrCard({ className = "desk-qr" }: { className?: string }) {
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
      <div className="desk-qr-text">
        <b>Play on your phone</b>
        <p>Scan it with your phone&apos;s camera to play in the browser. No download needed.</p>
        {host && <button className="copy-link" onClick={copy}>{copied ? "Copied" : host}<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" strokeWidth="2" /></svg></button>}
      </div>
    </div>
  );
}
