import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Steerable MusicGen",
  description: "Continuous AI music you steer in real time",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
