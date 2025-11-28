import type { Metadata } from "next";
import { Outfit, Playfair_Display } from "next/font/google";
import { GameProvider } from "@/contexts/GameContext";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["700"],
});

export const metadata: Metadata = {
  title: "🕵️ Undercover | nobadvibes.games",
  description: "A social deduction party game. One of you doesn't belong. Find them.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${outfit.variable} ${playfair.variable} font-sans antialiased bg-gray-950 text-white`}>
        <GameProvider>
          {children}
        </GameProvider>
      </body>
    </html>
  );
}
