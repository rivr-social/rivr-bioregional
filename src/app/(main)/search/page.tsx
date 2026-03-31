"use client"

/**
 * Search results page for cross-entity discovery in the main app shell.
 *
 * Route: `/search` with expected query params:
 * - `q`: search term used by feed modules and local people filtering.
 * - `chapter`: optional chapter/locale scope (defaults to `"all"`).
 *
 * Data requirements:
 * - Client-side people list from `usePeople()` for `PeopleFeed` and member hydration.
 * - Child feed components (`PostFeed`, `EventFeed`, `GroupFeed`) fetch their own data.
 *
 * Rendering model:
 * - Client Component (`"use client"`), rendered on the client because it reads URL params,
 *   uses router navigation APIs, and holds interactive local state.
 *
 * Metadata:
 * - No `metadata` or `generateMetadata` export is defined in this file.
 */
import { useState, useMemo, useTransition } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ResponsiveTabsList } from "@/components/responsive-tabs-list"
import { SearchHeader } from "@/components/search-header"
import { PostFeed } from "@/components/post-feed"
import { EventFeed } from "@/components/event-feed"
import { GroupFeed } from "@/components/group-feed"
import { PeopleFeed } from "@/components/people-feed"
import { usePeople } from "@/lib/hooks/use-graph-data"
import { toggleJoinGroup } from "@/app/actions/interactions"
import type { User } from "@/lib/types"

/**
 * Renders tabbed search results for posts, events, groups, and people.
 * URL params drive the query and optional scope filter while tabs segment result types.
 */
export default function SearchPage() {
  // Read the current URL search params on the client (no server-side redirect/auth logic here).
  const searchParams = useSearchParams()
  const router = useRouter()
  const query = searchParams.get("q") || ""
  const [selectedChapter, setSelectedChapter] = useState(searchParams.get("chapter") || "all")
  // Fetch people once for local people-tab filtering and group member lookup.
  const { people: users } = usePeople()
  const [, startTransition] = useTransition()

  // Filter people based on search query and selected chapter
  const filteredPeople = useMemo(() => {
    // Only return people results when a query exists to match explicit search intent.
    if (query) {
      return users.filter(
        (user) =>
          user.name.toLowerCase().includes(query.toLowerCase()) ||
          (user.username || "").toLowerCase().includes(query.toLowerCase()) ||
          (user.bio && user.bio.toLowerCase().includes(query.toLowerCase())),
      )
    }
    return []
  }, [query, users])

  /**
   * Updates the selected chapter scope and synchronizes it to the URL.
   * Uses `router.replace` to avoid adding a history entry for each scope change.
   */
  // Update URL when chapter changes
  const handleChapterChange = (chapterId: string) => {
    setSelectedChapter(chapterId)

    // Update URL with new chapter
    const params = new URLSearchParams(searchParams.toString())
    params.set("chapter", chapterId)
    router.replace(`/search?${params.toString()}`)
  }

  /**
   * Resolves group member IDs into user objects for `GroupFeed`.
   * Falls back to placeholder users when referenced IDs are missing.
   *
   * @param memberIds - User IDs associated with a group.
   * @returns `User[]` with guaranteed entries for each ID.
   */
  // Helper function to get members for a group
  const getMembers = (memberIds: string[]): User[] => {
    return memberIds.map((id) => {
      const user = users.find((u) => u.id === id)
      return user || { id, name: "Unknown User", username: "unknown", avatar: "", followers: 0, following: 0 } as User
    })
  }

  return (
    <div className="flex flex-col min-h-screen">
      <div className="container mx-auto px-4 py-6 flex-1 pb-16">
        <SearchHeader selectedChapter={selectedChapter} onChapterChange={handleChapterChange} />
        {query && (
          <h1 className="text-2xl font-bold mt-4 mb-2">Search Results for &quot;{query}&quot;</h1>
        )}
        {/* Conditionally surface active chapter scope when not using the global scope. */}
        {selectedChapter !== "all" && (
          <p className="text-muted-foreground mb-4">Filtered by chapter: {selectedChapter}</p>
        )}

        <Tabs defaultValue="posts" className="mt-6">
          <ResponsiveTabsList>
            <TabsTrigger value="posts">Posts</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="groups">Groups</TabsTrigger>
            <TabsTrigger value="people">People</TabsTrigger>
          </ResponsiveTabsList>
          <TabsContent value="posts" className="mt-4">
            {/* Child feed is responsible for fetching/rendering post search results. */}
            <PostFeed query={query} chapterId={selectedChapter} />
          </TabsContent>
          <TabsContent value="events" className="mt-4">
            {/* Child feed is responsible for fetching/rendering event search results. */}
            <EventFeed query={query} chapterId={selectedChapter} />
          </TabsContent>
          <TabsContent value="groups" className="mt-4">
            {/* GroupFeed receives member-resolver helper for rendering member previews. */}
            <GroupFeed
              query={query}
              chapterId={selectedChapter}
              getMembers={getMembers}
              onJoinGroup={(groupId) => {
              startTransition(async () => {
                await toggleJoinGroup(groupId, "group")
              })
            }}
            />
          </TabsContent>
          <TabsContent value="people" className="mt-4">
            {/* People tab uses memoized, locally filtered data from the loaded people graph. */}
            <PeopleFeed people={filteredPeople} query={query} chapterId={selectedChapter} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
