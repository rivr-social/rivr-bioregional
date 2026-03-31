import { fetchLocales } from "@/app/actions/graph"
import type { Metadata } from "next"
import type { ReactNode } from "react"

export async function generateMetadata(props: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await props.params

  try {
    const locales = await fetchLocales(500)
    const locale = locales.find((entry) => entry.id === id)

    if (locale?.name) {
      return {
        title: `${locale.name} | RIVR`,
        description: "Discover details about this local community",
      }
    }
  } catch {
    // Fallback metadata is returned below when data loading fails.
  }

  return {
    title: "Locale | RIVR",
    description: "Discover details about this local community",
  }
}

export default function LocaleLayout({ children }: { children: ReactNode }) {
  return children
}
