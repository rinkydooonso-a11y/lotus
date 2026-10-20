"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth/client";
import { LINKS } from "@/lib/links";
import { ConnectSheet } from "./ConnectSheet";
import { CaChip, XButton } from "./CaChip";
import { openFilm } from "./Film";
import { Logo } from "./Logo";
import { NAV, NavLinks } from "./Nav";

function Account({ compact }: { compact?: boolean }) {
  const { user, balances, signOut, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  if (loading) return null;
  if (!user) return (
    <>
      <button className="chip-signin" onClick={() => setOpen(true)}>Connect wallet</button>
      {open && <ConnectSheet onClose={() => setOpen(false)} />}
    </>
  );
  return (
    <div className="menu-wrap">
      <button className="acct" onClick={() => setMenu((m) => !m)}>
        {balances && <span className="acct-bal"><span>◆ {balances.shards}</span><span className="gold">🎟 {balances.tickets}</span></span>}
        <span className="avatar" />{!compact && <span className="acct-addr">{user.address.slice(0, 4)}…{user.address.slice(-4)}</span>}
      </button>
      {menu && (
        <div className="acct-menu" onClick={() => setMenu(false)}>
          <Link href="/history">My prizes</Link>
          {user.isAdmin && <Link href="/admin">Admin</Link>}
          <button onClick={() => void signOut()}>Disconnect</button>
        </div>
      )}
    </div>
  );
}

export function Header() {
  const path = usePathname();
  const home = path === "/";
  const [menu, setMenu] = useState(false);
  return (
    <>
      <header className={home ? "desk-top" : "desk-top is-page"}>
        <Link href="/" className="brand" aria-label="CardQuest home"><Logo /></Link>
        <nav className="desk-nav">
          <NavLinks />
          <CaChip />
          <XButton />
          <Account />
        </nav>
      </header>
      {!home && <div className="site-header-space" />}

      <header className={home ? "hud" : "hud is-page"}>
        <button className="brand" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-label="Menu">
          <Logo size={26} /><svg className={menu ? "chev up" : "chev"} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4.5 6 8l4-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
        <div className="hud-right"><Account compact /></div>
      </header>
      {menu && (
        <>
          <div className="menu-scrim" onClick={() => setMenu(false)} />
          <nav className="menu" onClick={() => setMenu(false)}>
            <button className="menu-item" onClick={openFilm}>Watch the film</button>
            {NAV.map((t) => <Link key={t.href} href={t.href} className="menu-item">{t.label}</Link>)}
            <a className="menu-item muted" href={LINKS.collectorCrypt} rel="noopener noreferrer">Redeem or sell on Collector Crypt</a>
            <div className="menu-foot"><CaChip full /><XButton /></div>
            <Link href="/" className="pill wide">Back to the map</Link>
          </nav>
        </>
      )}
    </>
  );
}
