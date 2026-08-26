import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Launch Auth — Launch & Authority Engine",
  description: "Build a source-backed launch campaign from your company URL.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
