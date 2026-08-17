import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dover Controls",
  description: "Private residential operations and control center.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
