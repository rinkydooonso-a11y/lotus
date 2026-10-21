"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth/client";
import { LINKS } from "@/lib/links";
import { ConnectSheet } from "./ConnectSheet";
import { CaChip, XButton } from "./CaChip";
import { openFilm } from "./Film";
import { Icon } from "./Icon";
import { Logo } from "./Logo";
import { NAV, NavLinks } from "./Nav";

function Account({ compact }: { compact?: boolean }) {
  const { user, balances, signOut, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  if (loading) return <span className="acct-placeholder" />;
  if (!user) return (
    <>
      <button className="btn sm" onClick={() => setOpen(true)}>{compact ? "Connect" : "Connect wallet"}</button>
      {open && <ConnectSheet onClose={() => setOpen(false)} />}
    </>
  );
  return (
    <div className="menu-wrap">
      <button className="acct" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-label="Account">
        {balances && (
          <span className="acct-bal">
            {!compact && <span title="Shards"><Icon name="shard" size={14} />{balances.shards}</span>}
            <span className="gold" title="Tickets"><Icon name="ticket" size={14} />{balances.tickets}</span>
          </span>
        )}
        <span className="avatar" />{!compact && <span className="acct-addr">{user.address.slice(0, 4)}…{user.address.slice(-4)}</span>}
      </button>
      {menu && (
        <>
          {createPortal(<div className="acct-scrim" onClick={() => setMenu(false)} />, document.body)}
          <div className="acct-menu" onClick={() => setMenu(false)}>
            <p className="acct-who mono">{user.address.slice(0, 6)}…{user.address.slice(-6)}</p>
            <Link href="/history">My prizes</Link>
            {user.isAdmin && <Link href="/admin">Admin</Link>}
            <button onClick={() => void signOut()}>Disconnect</button>
          </div>
        </>
      )}
    </div>
  );
}

export function Header() {
  const path = usePathname();
  const home = path === "/";
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [path]);
  return (
    <>
      <header className={home ? "desk-top" : "desk-top is-page"}>
        <Link href="/" className="brand" aria-label="CardQuest home"><Logo /></Link>
        <nav className="desk-nav" aria-label="Main"><NavLinks /></nav>
        <div className="desk-end">
          <CaChip />
          <XButton />
          <Account />
        </div>
      </header>
      {!home && <div className="site-header-space" />}

      <header className={home ? "hud" : "hud is-page"}>
        <Link href="/" className="brand" aria-label="CardQuest home"><Logo size={26} /></Link>
        <div className="hud-right">
          <Account compact />
          <button className="icon-btn" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-label="Menu"><Icon name={menu ? "close" : "menu"} size={20} /></button>
        </div>
      </header>
      {menu && (
        <>
          <div className="menu-scrim" onClick={() => setMenu(false)} />
          <nav className="menu" onClick={() => setMenu(false)} aria-label="Main">
            <Link href="/" className={home ? "menu-item on" : "menu-item"}>Play<Icon name="chevron" size={16} /></Link>
            {NAV.map((t) => <Link key={t.href} href={t.href} className={path === t.href ? "menu-item on" : "menu-item"}>{t.label}<Icon name="chevron" size={16} /></Link>)}
            <button className="menu-item" onClick={openFilm}>Watch the film<Icon name="play" size={14} /></button>
            <a className="menu-item sub" href={LINKS.collectorCrypt} rel="noopener noreferrer">Redeem or sell on Collector Crypt<Icon name="arrow" size={16} /></a>
            <div className="menu-foot"><CaChip full /><XButton /></div>
            <div className="menu-legal"><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link><Link href="/safe-play">Safe play</Link></div>
          </nav>
        </>
      )}
    </>
  );
}
