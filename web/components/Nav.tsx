"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const TABS = [
  { href: "/", label: "Map", icon: "◎" },
  { href: "/history", label: "Prizes", icon: "✦" },
  { href: "/vault", label: "Vault", icon: "▣" },
];

/** Inline links for the desktop header. */
export function NavLinks() {
  const path = usePathname();
  return <>{TABS.map((t) => <Link key={t.href} href={t.href} className={path === t.href ? "on" : ""}>{t.label}</Link>)}</>;
}

/** Bottom tab bar on phones. */
export function Nav() {
  const path = usePathname();
  return (
    <nav className="tabbar">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={path === t.href ? "tab on" : "tab"}>
          <span className="ti">{t.icon}</span>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
