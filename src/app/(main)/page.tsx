import { Suspense } from "react"
import { fetchHomeFeed, fetchBasins, fetchLocales, fetchPublicResources } from "@/app/actions/graph"
import {
  agentToUser,
  agentToGroup,
  agentToEvent,
  agentToPlace,
  agentToBasin,
  agentToLocale,
  resourceToMarketplaceListing,
  resourceToPost,
} from "@/lib/graph-adapters"
import type { SerializedResource } from "@/lib/graph-serializers"
import HomeClient from "./home-client"

/**
 * Skeleton placeholder rendered while the home feed data streams in.
 * Mimics the tab bar + card grid layout of the real feed.
 */
function HomeSkeleton() {
  return (
    <div className="container max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* Tab bar skeleton */}
      <div className="flex gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-9 w-20 animate-pulse bg-muted rounded-md" />
        ))}
      </div>
      {/* Card grid skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-3 p-4 border rounded-lg">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 animate-pulse bg-muted rounded-full" />
              <div className="space-y-2 flex-1">
                <div className="h-4 w-3/4 animate-pulse bg-muted rounded" />
                <div className="h-3 w-1/2 animate-pulse bg-muted rounded" />
              </div>
            </div>
            <div className="h-32 animate-pulse bg-muted rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Main feed page (`/`) for the primary application shell.
 *
 * Route: `/`
 * Rendering: Server Component (no `"use client"`), with server-side data fetching.
 * Data requirements:
 * - Home feed resources (`fetchHomeFeed`)
 * - Basin agents (`fetchBasins`)
 * - Locale agents (`fetchLocales`)
 *
 * Metadata: This file does not export `metadata` or `generateMetadata`; metadata is inherited.
 */
export default function Home() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <HomeFeedLoader />
    </Suspense>
  )
}

/**
 * Async server component that fetches feed data and renders HomeClient.
 * Wrapped in Suspense so the skeleton shows while data loads.
 */
async function HomeFeedLoader() {
  const result = await loadHomeFeed()
  return (
    <HomeClient
      initialPeople={result.people}
      initialGroups={result.groups}
      initialEvents={result.events}
      initialPlaces={result.places}
      initialMarketplace={result.marketplace}
      initialPosts={result.posts}
      initialBasins={result.basins}
      initialLocales={result.locales}
    />
  )
}

async function loadHomeFeed() {
  try {
    const [feed, basinAgents, localeAgents, publicResources] = await Promise.all([
      fetchHomeFeed(50),
      fetchBasins(),
      fetchLocales(),
      fetchPublicResources(300),
    ])

    const postResources = publicResources.filter((r) => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>
      return meta.entityType === "post" || r.type === "post" || r.type === "note"
    })

    return {
      people: feed.people.map(agentToUser),
      groups: feed.groups.map(agentToGroup),
      events: feed.events.map(agentToEvent),
      places: feed.places.map(agentToPlace),
      marketplace: feed.marketplace.map((item) =>
        resourceToMarketplaceListing(item as unknown as SerializedResource)
      ),
      posts: postResources.map((r) => resourceToPost(r)) as import("@/lib/types").Post[],
      basins: basinAgents.map(agentToBasin),
      locales: localeAgents.map(agentToLocale),
    }
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err)
    console.error(`[Home] Server-side data fetch failed: ${msg}`)

    return {
      people: [],
      groups: [],
      events: [],
      places: [],
      marketplace: [],
      posts: [],
      basins: [],
      locales: [],
    }
  }
}
