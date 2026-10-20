import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = { title: "Lotus", description: "Walk. Find crates. Win real graded cards.", manifest: "/manifest.webmanifest", appleWebApp: { capable: true, title: "Lotus", statusBarStyle: "black-translucent" } };
export const viewport: Viewport = { themeColor: "#0e0b1a", width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="app">
            <Header />
            <main>{children}</main>
            <Nav />
          </div>
        </Providers>
      </body>
    </html>
  );
}
