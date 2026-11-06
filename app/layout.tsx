import type { Metadata } from "next";
import "./globals.css";
import { ru } from "@/lib/i18n/ru";
export const metadata: Metadata = {
  title: ru.brand,
  description: ru.description,
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
