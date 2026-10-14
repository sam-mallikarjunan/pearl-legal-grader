import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Independent Law Practice Grader | Fount",
  description:
    "Build a practice that works for you. Explore a short operating assessment, a clear improvement plan, and your next useful action.",
  robots: { index: false, follow: false },
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
