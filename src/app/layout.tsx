import type { Metadata } from "next";

import "./globals.css";

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
    <html lang="ko" className="h-full">
      <body>{children}</body>
    </html>
  );
}
