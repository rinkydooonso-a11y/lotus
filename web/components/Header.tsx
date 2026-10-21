"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth/client";
import { LINKS } from "@/lib/links";
import { useFullMap } from "@/lib/viewStore";
import { ConnectSheet } from "./ConnectSheet";
import { CaChip, XButton } from "./CaChip";
import { openFilm } from "./Film";
import { Logo } from "./Logo";
import { NAV, NavLinks } from "./Nav";
import { Portal, useScrollLock } from "./Portal";
import { IconArrowUpRight, IconClose, IconMenu, IconPlay, Shard, Ticket } from "./Icons";

function Account({ hideConnect }: { hideConnect?: boolean }) {
  const { user, balances, signOut, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const off = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [menu]);
  if (loading) return null;
  if (!user) return (
    <>
      <button className={hideConnect ? "btn btn-sm connect-chip hide-phone" : "btn btn-sm connect-chip"} onClick={() => setOpen(true)}>Connect</button>
      {open && <ConnectSheet onClose={() => setOpen(false)} />}
    </>
  );
  return (
    <div className="acct-wrap" ref={wrap}>
      <button className="acct" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-label="Account">
        {balances && <span className="acct-bal"><span><Shard size={15} />{balances.shards}</span><span><Ticket size={15} />{balances.tickets}</span></span>}
        <span className="avatar" /><span className="acct-addr hide-phone">{user.address.slice(0, 4)}…{user.address.slice(-4)}</span>
      </button>
      {menu && (
        <div className="pop acct-menu" onClick={() => setMenu(false)}>
          <p className="pop-title mono">{user.address.slice(0, 4)}…{user.address.slice(-4)}</p>
          <Link href="/history">My prizes</Link>
          {user.isAdmin && <Link href="/admin">Admin</Link>}
          <button onClick={() => void signOut()}>Disconnect</button>
        </div>
      )}
    </div>
  );
}

/** Phones: a full-screen menu with big links, like a native app's root list. */
function PhoneMenu({ onClose }: { onClose: () => void }) {
  useScrollLock();
  const path = usePathname();
  return (
    <Portal>
      <div className="pmenu" role="dialog" aria-modal="true" aria-label="Menu">
        <div className="pmenu-top">
          <Link href="/" className="brand" onClick={onClose} aria-label="CardQuest home"><Logo /></Link>
          <button className="icon-btn" onClick={onClose} aria-label="Close menu"><IconClose size={18} /></button>
        </div>
        <nav className="pmenu-links" onClick={onClose}>
          <Link href="/" className={path === "/" ? "on" : ""}>Play</Link>
          {NAV.map((t, i) => <Link key={t.href} href={t.href} className={path === t.href ? "on" : ""} style={{ animationDelay: `${(i + 1) * 30}ms` }}>{t.label}</Link>)}
        </nav>
        <div className="pmenu-sub" onClick={onClose}>
          <button onClick={openFilm}><IconPlay size={14} />Watch the film</button>
          <a href={LINKS.collectorCrypt} rel="noopener noreferrer">Redeem or sell on Collector Crypt<IconArrowUpRight size={14} /></a>
        </div>
        <div className="pmenu-foot">
          <div className="pmenu-row"><CaChip full /><XButton /></div>
          <nav className="pmenu-legal" onClick={onClose}><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link><Link href="/safe-play">Safe play</Link></nav>
        </div>
      </div>
    </Portal>
  );
}

export function Header() {
  const path = usePathname();
  const home = path === "/";
  const full = useFullMap();
  const [menu, setMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [path]);
  useEffect(() => setMenu(false), [path]);
  // Over the home hero the bar is clear; it frosts once the page scrolls, and floats over the map in full-screen play.
  const cls = ["topbar", home && !scrolled && !full ? "clear" : "", home && full ? "over-map" : ""].filter(Boolean).join(" ");
  return (
    <>
      <header className={cls}>
        <div className="topbar-in">
          <Link href="/" className="brand" aria-label="CardQuest home"><Logo /></Link>
          <nav className="topnav" aria-label="Main"><NavLinks /></nav>
          <div className="topbar-end">
            <CaChip className="hide-phone" />
            <XButton className="hide-phone" />
            <Account hideConnect={home} />
            <button className="icon-btn show-phone" onClick={() => setMenu(true)} aria-label="Menu" aria-expanded={menu}><IconMenu size={20} /></button>
          </div>
        </div>
      </header>
      {menu && <PhoneMenu onClose={() => setMenu(false)} />}
    </>
  );
}
