/**
 * Basin detail page.
 *
 * Route: `/basins/[id]`
 * Purpose: Loads and renders a single basin profile, including chapter children and optional
 * council information.
 * Data requirements: Basin agent and child agents fetched via `fetchAgent` and
 * `fetchAgentChildren` using the route `id` param.
 * Rendering: Client-rendered (`"use client"`), with data loaded in `useEffect`; no metadata
 * export is defined in this client page module.
 */
"use client"

import { use, useState, useEffect, useMemo } from "react"
import { AgentPageShell } from "@/components/agent-page-shell"
import { BasinProfile } from "@/components/basin-profile"
import { fetchAgentChildren } from "@/app/actions/graph"
import { agentToBasin, agentToLocale } from "@/lib/graph-adapters"
import { useAgent } from "@/lib/hooks/use-graph-data"
import type { Basin, Chapter } from "@/lib/types"
import Link from "next/link"
import { Button } from "@/components/ui/button"

/**
 * Renders the basin detail experience for a single dynamic route id.
 *
 * @param props - Next.js route params promise containing a basin `id`.
 * @returns Loading skeleton, not-found state, or populated basin profile.
 */
export default function BasinPage(props: { params: Promise<{ id: string }> }) {
  // Resolve route params on the client from the promise passed by Next.js.
  const params = use(props.params)
  // IndexedDB-first: useAgent reads from local cache instantly, then syncs from server.
  const { agent: basinAgent, state: agentState } = useAgent(params.id)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [council, setCouncil] = useState<{
    id: string
    name: string
    description: string
    members: { id: string; name: string; role: string; avatar: string }[]
    initiatives: { id: string; title: string; status: string }[]
  } | undefined>(undefined)
  const [childrenLoaded, setChildrenLoaded] = useState(false)

  // Derive basin from the hook-managed agent (IndexedDB-first).
  const basin = useMemo<Basin | null>(
    () => (basinAgent ? agentToBasin(basinAgent) : null),
    [basinAgent]
  )

  // Children still need a server call (no dedicated hook), but the parent agent is instant.
  useEffect(() => {
    let cancelled = false

    async function loadChildren() {
      try {
        const children = await fetchAgentChildren(params.id)
        if (cancelled) return

        setChapters(
          children
            .filter((child) => (child.metadata?.placeType as string | undefined) === "chapter")
            .map(agentToLocale)
        )
        const councilAgent = children.find(
          (child) => (child.metadata?.placeType as string | undefined) === "council"
        )
        setCouncil(
          councilAgent
            ? {
                id: councilAgent.id,
                name: councilAgent.name,
                description: councilAgent.description ?? "",
                members: [],
                initiatives: [],
              }
            : undefined
        )
      } catch {
        if (!cancelled) {
          setChapters([])
          setCouncil(undefined)
        }
      } finally {
        if (!cancelled) setChildrenLoaded(true)
      }
    }

    loadChildren()
    return () => { cancelled = true }
  }, [params.id])

  const loading = agentState === "loading" || agentState === "idle" && !childrenLoaded

  // Conditional rendering: loading skeleton while async basin data is resolving.
  if (loading) {
    return (
      <div className="container max-w-4xl mx-auto px-4 py-6">
        <div className="animate-pulse space-y-4">
          <div className="h-48 bg-muted rounded-lg" />
          <div className="h-8 bg-muted rounded w-1/3" />
          <div className="grid grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 bg-muted rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Conditional rendering: explicit not-found presentation for missing basin data.
  if (!basin) {
    return (
      <div className="container max-w-4xl mx-auto px-4 py-6">
        <div className="text-center py-12">
          <h1 className="text-2xl font-bold mb-2">Basin not found</h1>
          <p className="text-muted-foreground mb-4">
            The river basin you are looking for does not exist.
          </p>
          <Link href="/basins">
            <Button>Browse All Basins</Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <AgentPageShell
      backHref="/basins"
      backLabel="Back to basins"
      header={null}
      maxWidthClassName="max-w-4xl"
    >
      <BasinProfile
        basin={basin}
        chapters={chapters}
        bioregionalCouncil={council}
      />
    </AgentPageShell>
  )
}
