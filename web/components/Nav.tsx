"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LINKS } from "@/lib/links";
import { toggleTab, useTab, type HomeTab } from "@/lib/tabStore";

/** Open off-site links in a new tab. */
export const ext = (href: string) => (href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {});

export const NAV = [
  { href: "/how", label: "How it works" },
  { href: "/history", label: "Prizes" },
  { href: LINKS.vault, label: "Vault" },
  { href: "/coin", label: LINKS.ticker },
  { href: "/stats", label: "Live stats" },
];

export const HOME_TABS: { id: HomeTab; label: string; href: string }[] = [
  { id: "stats", label: "Stats", href: "/stats" },
  { id: "crates", label: "Crates", href: "/stats" },
  { id: "pulls", label: "Pulls", href: "/history" },
  { id: "collectors", label: "Collectors", href: "/stats" },
  { id: "how", label: "How it works", href: "/how" },
];

/** Header links. On the home screen they open panels over the globe (the page never scrolls); elsewhere they go to the full pages. */
export function NavLinks() {
  const path = usePathname();
  const tab = useTab();
  if (path === "/") {
    return <>{HOME_TABS.map((t) => <button key={t.id} className={tab === t.id ? "on" : ""} aria-pressed={tab === t.id} onClick={() => toggleTab(t.id)}>{t.label}</button>)}</>;
  }
  return <>{HOME_TABS.filter((t, i, a) => a.findIndex((x) => x.href === t.href) === i).map((t) => <Link key={t.href} href={t.href} className={path === t.href ? "on" : ""}>{t.id === "stats" ? "Stats" : t.id === "pulls" ? "Prizes" : t.label}</Link>)}</>;
}
