import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    "https://atlas-architecture-intelligence.shahinyanm.chatgpt.site",
  ),
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
      "A local codebase map where the graph is the source of truth and AI only explains.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
