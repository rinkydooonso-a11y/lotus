"use client";
import { useEffect, useState } from "react";
import qrcode from "qrcode-generator";

/** "Play on your phone": QR for the current site, so desktop visitors can jump to mobile. */
export function QrCard() {
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
    <div className="panel-card qr">
      <div className="qr-code" aria-label="QR code to open CardQuest on your phone" dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="qr-copy">
        <b>Play on your phone</b>
        <p>Scan with your camera to open CardQuest in your phone&apos;s browser. Nothing to download.</p>
        {host && <button className="chip" onClick={copy}>{copied ? "Copied" : host}<span aria-hidden="true">⧉</span></button>}
      </div>
    </div>
  );
}
