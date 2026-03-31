import type { Metadata } from "next"
import type { ReactNode } from "react"

export const metadata: Metadata = {
  title: "Basins | RIVR",
  description: "Explore river basins and watersheds",
}

export default function BasinsLayout({ children }: { children: ReactNode }) {
  return children
}
