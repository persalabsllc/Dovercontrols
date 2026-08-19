import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dover Controls",
  description: "Private access gateway for protected systems and operational environments.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
