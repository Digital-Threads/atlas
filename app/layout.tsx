import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Atlas - Architecture Intelligence Engine",
    template: "%s | Atlas",
  },
  description:
    "A local architecture intelligence engine for NestJS projects that turns static analysis into an explorable codebase graph.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "Atlas - Architecture Intelligence Engine",
    description:
      "Static analysis, exact graph, interactive viewer, and MCP tools for understanding NestJS projects.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Atlas - Architecture Intelligence Engine",
    description:
      "A local codebase map built from static analysis and typed architecture evidence.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
