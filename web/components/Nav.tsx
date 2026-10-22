"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LINKS } from "@/lib/links";

/** Open off-site links in a new tab. */
export const ext = (href: string) => (href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {});

export const NAV = [
  { href: "/how", label: "How it works" },
  { href: "/history", label: "Prizes" },
  { href: LINKS.vault, label: "Vault" },
  { href: "/coin", label: LINKS.ticker },
  { href: "/stats", label: "Live stats" },
];

/** Inline links for the desktop header. */
export function NavLinks() {
  const path = usePathname();
  return <>{NAV.map((t) => <Link key={t.href} href={t.href} {...ext(t.href)} className={path === t.href ? "on" : ""}>{t.label}</Link>)}</>;
}
