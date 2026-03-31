"use client"
import { useState } from "react"
import { LocaleSwitcher } from "@/components/locale-switcher"
import { RingFeed } from "@/components/ring-feed"
import { Plus } from "lucide-react"
import Link from "next/link"
import { useGroups } from "@/lib/hooks/use-graph-data"
import { GroupType, type Family, type Ring } from "@/lib/types"

/**
 * Rings page for browsing and creating ring groups.
 *
 * Route: `/rings` (App Router page segment).
 * Data requirements: reads `groups` via `useGroups()` and derives ring/family subsets
 * for `RingFeed` rendering and chapter/query filtering.
 *
 * Rendering: client-rendered (`"use client"`) because it uses React state and client hooks.
 * Metadata: no `metadata` export is defined in this file.
 * Auth/redirects: this page does not perform auth checks or server/client redirects.
 */
/**
 * Renders the Rings index UI, including chapter selection, search, create action, and feed results.
 *
 * @returns The Rings page content.
 */
export default function RingsPage() {
  const [selectedChapter, setSelectedChapter] = useState("all")
  const [searchQuery, setSearchQuery] = useState("")
  // Client-side graph data hook used to populate rings/families for feed display.
  const { groups } = useGroups()

  // Normalize groups into ring entities for RingFeed consumption.
  const rings: Ring[] = groups
    .filter((group) => group.type === GroupType.Ring)
    .map((group) => ({ ...group, type: GroupType.Ring }) as Ring)
  // Normalize groups into family entities and preserve parent ring relationship.
  const families: Family[] = groups
    .filter((group) => group.type === GroupType.Family)
    .map((group) => ({
      ...group,
      type: GroupType.Family,
      parentRingId: group.parentGroupId ?? "",
    }) as Family)
  
  return (
    <div className="container max-w-4xl mx-auto px-4 py-6">
      <div className="flex justify-center mb-4">
        <LocaleSwitcher onLocaleChange={setSelectedChapter} selectedLocale={selectedChapter} />
      </div>

      <div className="flex items-center justify-between mb-4">
        <div className="flex-1 flex justify-center">
          <div className="border-b-2 border-primary px-4 py-2">
            <span className="text-primary font-medium">Rings</span>
          </div>
        </div>
      </div>

      <div className="mb-6">
        <div className="flex items-center gap-3 bg-gray-100 rounded-full p-2 pl-4 mb-6">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search ring name"
              className="bg-transparent w-full focus:outline-none"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* User-initiated navigation to creation flow; no automatic redirect logic occurs on this page. */}
        <Link href="/create?tab=group&type=ring" className="flex items-center gap-3 mb-6">
          <div className="bg-gray-100 rounded-full p-3">
            <Plus className="h-5 w-5" />
          </div>
          <span className="text-lg font-medium">Create a ring</span>
        </Link>

        {/* Feed handles conditional filtering internally using query/chapter props. */}
        <RingFeed rings={rings} families={families} query={searchQuery} chapterId={selectedChapter} />
      </div>
    </div>
  )
}
