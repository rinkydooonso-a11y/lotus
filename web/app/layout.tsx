import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import { Nav } from "@/components/Nav";
import { FilmHost } from "@/components/Film";

export const metadata: Metadata = { title: "CardQuest", description: "Walk to crates on the map. Open them for real graded trading cards.", manifest: "/manifest.webmanifest", appleWebApp: { capable: true, title: "CardQuest", statusBarStyle: "black-translucent" } };
export const viewport: Viewport = { themeColor: "#0b0b0d", width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap" />
      </head>
      <body>
        <Providers>
          <div className="app">
            <Header />
            <main>{children}</main>
            <Nav />
          </div>
          <FilmHost />
        </Providers>
      </body>
    </html>
  );
}
