import { fetchBasins } from "@/app/actions/graph"
import type { Metadata } from "next"
import type { ReactNode } from "react"

export async function generateMetadata(props: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await props.params

  try {
    const basins = await fetchBasins(500)
    const basin = basins.find((entry) => entry.id === id)

    if (basin?.name) {
      return {
        title: `${basin.name} | RIVR`,
        description: "Explore this river basin and its connected communities",
      }
    }
  } catch {
    // Fallback metadata is returned below when data loading fails.
  }

  return {
    title: "Basin | RIVR",
    description: "Explore this river basin and its connected communities",
  }
}

export default function BasinLayout({ children }: { children: ReactNode }) {
  return children
}
