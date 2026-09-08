import type { Metadata } from "next";
import { Suspense } from "react";
import { getLocale } from "@/lib/i18n/server";
import { LocaleProvider } from "@/components/i18n/locale-provider";
import { LocaleDocumentTitle } from "@/components/i18n/locale-document-title";
import { ServiceWebAnalytics } from "@/components/service-web-analytics";
import { ServiceSpeedInsights } from "@/components/service-speed-insights";
import { Geist, Noto_Sans_KR } from "next/font/google";

import "./globals.css";
import "./presentation.css";
import "./modern.css";
import "./motion.css";
import "./stage.css";
import "./locale.css";

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

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
  title: locale === "en" ? "VARDA LABS · My portfolio" : "VARDA LABS · 나의 포트폴리오",
  description: locale === "en" ? "Follow your assets and plan your portfolio." : "자산의 흐름을 확인하고, 나의 포트폴리오를 계획하는 공간.",
  // All current routes belong to the private portfolio application.
  robots: { index: false, follow: false },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      className={`${geist.variable} ${notoSansKr.variable} h-full`}
    >
      <body>
        <LocaleProvider initialLocale={locale}>
        {children}
        <Suspense fallback={null}><LocaleDocumentTitle /></Suspense>
        <ServiceWebAnalytics />
        <ServiceSpeedInsights />
        </LocaleProvider>
      </body>
    </html>
  );
}
