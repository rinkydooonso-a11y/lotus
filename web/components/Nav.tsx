"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV = [
  { href: "/how", label: "How it works" },
  { href: "/history", label: "Prizes" },
  { href: "/vault", label: "Vault" },
  { href: "/coin", label: "$CQ" },
  { href: "/stats", label: "Live stats" },
];

/** Inline links for the desktop header. */
export function NavLinks() {
  const path = usePathname();
  return <>{NAV.map((t) => <Link key={t.href} href={t.href} className={path === t.href ? "on" : ""}>{t.label}</Link>)}</>;
}
