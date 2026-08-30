import type { Metadata } from "next";
import { ServiceSpeedInsights } from "@/components/service-speed-insights";
import { Geist, Noto_Sans_KR } from "next/font/google";

import "./globals.css";
import "./presentation.css";

const geist = Geist({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-geist",
});

const notoSansKr = Noto_Sans_KR({
  display: "swap",
  preload: false,
  variable: "--font-noto-sans-kr",
  weight: "variable",
});

export const metadata: Metadata = {
  title: "Varda Labs Portfolio",
  description: "Read-only portfolio dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geist.variable} ${notoSansKr.variable} h-full`}
    >
      <body>
        {children}
        <ServiceSpeedInsights />
      </body>
    </html>
  );
}
