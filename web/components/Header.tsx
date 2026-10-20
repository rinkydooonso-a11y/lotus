"use client";
import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/client";
import { ConnectSheet } from "./ConnectSheet";
import { Logo } from "./Logo";
import { NavLinks } from "./Nav";

export function Header() {
  const { user, balances, signOut, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  return (
    <header className="top">
      <Link href="/" className="brand" aria-label="CardQuest home"><Logo /></Link>
      <NavLinks />
      <div className="grow" />
      {user && balances && (
        <div className="pills">
          <span className="pill" title="10 shards = 1 ticket">◆ {balances.shards}</span>
          <span className="pill tix" title="Tickets spawn a better crate">🎟 {balances.tickets}</span>
        </div>
      )}
      {!loading && !user && <button className="btn sm" onClick={() => setOpen(true)}>Connect</button>}
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
