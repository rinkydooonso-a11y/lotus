"use client";
import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/client";
import { LINKS, coinLive } from "@/lib/links";
import { ConnectSheet } from "./ConnectSheet";
import { openFilm } from "./Film";
import { Logo } from "./Logo";
import { NavLinks } from "./Nav";

function CaChip() {
  const [copied, setCopied] = useState(false);
  const copy = () => { if (coinLive) void navigator.clipboard?.writeText(LINKS.coin).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };
  return (
    <button className="ca" onClick={copy} title={coinLive ? "Copy contract address" : "Contract address coming soon"}>
      <b>CA</b><span className="mono">{copied ? "Copied" : coinLive ? `${LINKS.coin.slice(0, 4)}…${LINKS.coin.slice(-4)}` : "soon"}</span>
      {coinLive && <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" strokeWidth="2" /></svg>}
    </button>
  );
}

export function Header() {
  const { user, balances, signOut, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  return (
    <header className="top">
      <Link href="/" className="brand" aria-label="CardQuest home"><Logo /></Link>
      <div className="grow" />
      <nav className="navlinks">
        <button onClick={openFilm}>How it works</button>
        <NavLinks />
      </nav>
      <CaChip />
      <a className="xbtn" href={LINKS.x} target="_blank" rel="noopener noreferrer" aria-label="CardQuest on X">
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77L17.75 3Zm-1.08 16.2h1.7L7.4 4.7H5.58l11.09 14.5Z" /></svg>
      </a>
      {user && balances && (
        <div className="pills">
          <span className="pill" title="10 shards = 1 ticket">◆ {balances.shards}</span>
          <span className="pill tix" title="Tickets spawn a better crate">🎟 {balances.tickets}</span>
        </div>
      )}
      {!loading && !user && <button className="btn light sm" onClick={() => setOpen(true)}>Connect wallet</button>}
      {user && (
        <div className="menu-wrap">
          <button className="btn ghost sm addr" onClick={() => setMenu((m) => !m)}><span className="avatar" /><span className="addr-t">{user.address.slice(0, 4)}…{user.address.slice(-4)}</span></button>
          {menu && (
            <div className="menu" onClick={() => setMenu(false)}>
              {user.isAdmin && <Link href="/admin">Admin</Link>}
              <button onClick={() => void signOut()}>Disconnect</button>
            </div>
          )}
        </div>
      )}
      {open && !user && <ConnectSheet onClose={() => setOpen(false)} />}
    </header>
  );
}
