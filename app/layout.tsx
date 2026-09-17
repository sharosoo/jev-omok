import type { Metadata, Viewport } from "next";
import { Noto_Sans_KR } from "next/font/google";
import type { ReactNode } from "react";

import { SiteHeader } from "@/components/account/SiteHeader";
import { APP_DESCRIPTION, APP_TITLE } from "@/lib/lines";

import "./globals.css";

/* No `weight`: the variable face covers every weight in one file per unicode
 * chunk, which keeps the Hangul download a fraction of the static cut. */
const sans = Noto_Sans_KR({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: APP_TITLE,
  description: APP_DESCRIPTION,
  openGraph: { title: APP_TITLE, description: APP_DESCRIPTION, type: "website" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0e14",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" className={sans.variable}>
      <body>
        {/* The header is part of every route, so screens size against
          * `.app__main` rather than the viewport. */}
        <div className="app">
          <SiteHeader />
          <div className="app__main">{children}</div>
        </div>
      </body>
    </html>
  );
}
