import type { Metadata } from "next"
import { Inter, JetBrains_Mono } from "next/font/google"
import "./globals.css"
import { Providers } from "@/components/Providers"

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" })

export const metadata: Metadata = {
  title: "Bow — hybrid AI staking primitive on Arc",
  description: "An on-chain treasury agent that allocates between USDC, USYC and EURC on Arc, with every decision logged, explained by Claude, and challenged by humans.",
  keywords: ["Arc", "Circle", "USDC", "USYC", "EURC", "AI agent", "DeFi", "yield", "treasury", "Bow"],
  openGraph: {
    title: "Bow — hybrid AI staking primitive on Arc",
    description: "AI-orchestrated 3-asset vault on Arc. Real settlement, public reasoning trail, cooldown withdraws.",
    siteName: "Bow",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bow — hybrid AI staking primitive on Arc",
    description: "AI-orchestrated 3-asset vault on Arc. USDC + USYC + EURC, dynamically rebalanced.",
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
