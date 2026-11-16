import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "PAYTRIVA | JSAN Consulting",
    template: "%s | PAYTRIVA",
  },
  description: "JSAN Consulting's enterprise financial control platform.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
