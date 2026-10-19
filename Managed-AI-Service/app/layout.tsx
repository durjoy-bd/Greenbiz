import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GreenBiz AI · A helping hand for your business",
  description: "Managed AI assistance for GreenBiz stock photos, sales and practical business advice. Review suggestions in the GreenBiz app.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
