import type { Metadata } from "next"
import type { ReactNode } from "react"

export const metadata: Metadata = {
  title: "Locales | RIVR",
  description: "Browse and discover local communities",
}

export default function LocalesLayout({ children }: { children: ReactNode }) {
  return children
}
