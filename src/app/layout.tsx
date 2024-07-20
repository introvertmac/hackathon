import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dapps Hunt",
  description: "Discover and analyze Solana dApps with Dapps Hunt",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Chivo:wght@400;700&italic&display=swap" rel="stylesheet" />
        <link rel="icon" type="image/x-icon" href="/favicon.ico" />
      </head>
      <body>{children}</body>
    </html>
  );
}