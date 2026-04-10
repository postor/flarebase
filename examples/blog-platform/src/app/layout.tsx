import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { FlarebaseProvider } from "@flarebase/react";
import { AuthProvider } from "@/contexts/AuthContext";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Flarebase Blog Platform",
  description: "A real-time blog platform powered by Flarebase",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <FlarebaseProvider baseURL="http://localhost:3000">
          <AuthProvider>
            {children}
          </AuthProvider>
        </FlarebaseProvider>
      </body>
    </html>
  );
}
