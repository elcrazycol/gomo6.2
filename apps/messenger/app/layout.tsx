import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "gomo6 messenger",
  description: "End-to-end encrypted messenger for gomo6",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
