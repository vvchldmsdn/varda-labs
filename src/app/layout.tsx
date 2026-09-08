import type { Metadata } from "next";
import { ServiceSpeedInsights } from "@/components/service-speed-insights";
import { Geist, Noto_Sans_KR } from "next/font/google";

import "./globals.css";
import "./presentation.css";
import "./modern.css";
import "./motion.css";
import "./stage.css";

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
  title: "VARDA LABS · 나의 포트폴리오",
  description: "자산의 흐름을 확인하고, 나의 포트폴리오를 계획하는 공간.",
  // All current routes belong to the private portfolio application.
  robots: { index: false, follow: false },
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
