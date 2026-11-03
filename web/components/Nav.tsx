"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LINKS } from "@/lib/links";
import { setExploring } from "@/lib/viewStore";

/** Open off-site links in a new tab. */
export const ext = (href: string) => (href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {});

export const NAV = [
  { href: "/how", label: "How it works" },
  { href: "/history", label: "Prizes" },
  { href: LINKS.vault, label: "Vault" },
  { href: "/coin", label: LINKS.ticker },
  { href: "/stats", label: "Live stats" },
];

/** Inline links for the desktop header: the three things a visitor looks for first. */
export function NavLinks() {
  const path = usePathname();
  return (
    <>
      <Link href="/" onClick={() => setExploring(true)} className={path === "/" ? "on" : ""}>Explore</Link>
      <Link href="/history" className={path === "/history" ? "on" : ""}>Prizes</Link>
      <Link href="/how" className={path === "/how" ? "on" : ""}>How it works</Link>
    </>
  );
}
