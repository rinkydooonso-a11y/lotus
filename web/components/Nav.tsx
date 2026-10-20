"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/", label: "Map", icon: "◎" },
  { href: "/history", label: "Prizes", icon: "✦" },
  { href: "/vault", label: "Vault", icon: "▣" },
];
export function Nav() {
  const path = usePathname();
  return (
    <nav className="tabbar">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className={path === t.href ? "tab on" : "tab"}>
          <span className="ti">{t.icon}</span>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
