import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/Docs";

export const metadata: Metadata = { title: "Page not found · CardQuest" };

/** 404: the site's own look instead of Next.js's default white page. */
export default function NotFound() {
  return (
    <div className="docs">
      <p className="page-kicker">404</p>
      <h1>Nothing here.</h1>
      <p className="muted">This page doesn&apos;t exist or has moved. The crates are on the map.</p>
      <div className="nf-actions">
        <Link href="/" className="btn">Open the map</Link>
        <Link href="/how" className="btn btn-gray">How it works</Link>
      </div>
      <SiteFooter />
    </div>
  );
}
