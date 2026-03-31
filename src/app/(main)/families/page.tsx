"use client"
import { useState } from "react"
import { LocaleSwitcher } from "@/components/locale-switcher"
import { FamilyFeed } from "@/components/family-feed"
import { Plus } from "lucide-react"
import Link from "next/link"
import { useGroups } from "@/lib/hooks/use-graph-data"
import { GroupType, type Family, type Ring } from "@/lib/types"

/**
 * Families page for browsing and creating family groups.
 *
 * Route: `/families` (App Router page segment).
 * Data requirements: reads `groups` with `useGroups()` and derives family/ring collections
 * for `FamilyFeed` plus chapter/query filtering.
 *
 * Rendering: client-rendered (`"use client"`) due to client hooks/state usage.
 * Metadata: no `metadata` export is declared in this file.
 * Auth/redirects: no auth checks or redirect behavior are implemented here.
 */
/**
 * Renders the Families index UI with chapter switcher, search, create action, and feed.
 *
 * @returns The Families page content.
 */
export default function FamiliesPage() {
  const [selectedChapter, setSelectedChapter] = useState("all")
  const [searchQuery, setSearchQuery] = useState("")
  // Client-side hook for graph-backed group data.
  const { groups } = useGroups()

  // Derive family entities from generic groups and include parent ring linkage.
  const families: Family[] = groups
    .filter((group) => group.type === GroupType.Family)
    .map((group) => ({
      ...group,
      type: GroupType.Family,
      parentRingId: group.parentGroupId ?? "",
    }) as Family)
  // Derive ring entities used for family context/rendering.
  const rings: Ring[] = groups
    .filter((group) => group.type === GroupType.Ring)
    .map((group) => ({ ...group, type: GroupType.Ring }) as Ring)
  
  return (
    <div className="container max-w-4xl mx-auto px-4 py-6">
      <div className="flex justify-center mb-4">
        <LocaleSwitcher onLocaleChange={setSelectedChapter} selectedLocale={selectedChapter} />
      </div>

      <div className="flex items-center justify-between mb-4">
        <div className="flex-1 flex justify-center">
          <div className="border-b-2 border-primary px-4 py-2">
            <span className="text-primary font-medium">Families</span>
          </div>
        </div>
      </div>

      <div className="mb-6">
        <div className="flex items-center gap-3 bg-muted rounded-full p-2 pl-4 mb-6">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search family name"
              className="bg-transparent w-full focus:outline-none"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* User-driven navigation to family creation; there is no automatic redirect path in this page. */}
        <Link href="/create?tab=group&type=family" className="flex items-center gap-3 mb-6">
          <div className="bg-muted rounded-full p-3">
            <Plus className="h-5 w-5" />
          </div>
          <span className="text-lg font-medium">Create a family</span>
        </Link>

        {/* Feed component conditionally renders entries based on chapter and search query props. */}
        <FamilyFeed families={families} rings={rings} query={searchQuery} chapterId={selectedChapter} />
      </div>
    </div>
  )
}
