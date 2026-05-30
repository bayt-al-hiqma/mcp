import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bayt al-Hiqma Memory MCP",
  description: "Personal Markdown memory MCP server for ChatGPT.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
