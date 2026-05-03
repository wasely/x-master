import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Playfair_Display, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import BottomNav from "@/components/BottomNav";

const space = Space_Grotesk({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-space",
  display: "swap",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-playfair",
  display: "swap",
});

const ibmMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "X Master",
  description: "Generate writing from TikTok ideas and saved X examples",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  manifest: "/manifest.json",
  icons: {
    icon: "/icons/icon-192.svg",
    apple: "/icons/apple-touch-icon.svg",
  },
  openGraph: {
    title: "X Master",
    description: "Generate writing from TikTok ideas and saved X examples",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "X Master",
    description: "Generate writing from TikTok ideas and saved X examples",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "X Master",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${space.variable} ${playfair.variable} ${ibmMono.variable}`}>
      <body className="min-h-screen bg-black antialiased">
        <div className="app-frame relative mx-auto min-h-screen w-full max-w-[430px]">
          {children}
          <BottomNav />
        </div>
      </body>
    </html>
  );
}
