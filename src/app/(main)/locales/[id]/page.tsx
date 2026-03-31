/**
 * Locale detail page.
 *
 * Route: `/locales/[id]`
 * Purpose: Shows a single locale profile, related basin context, and membership interaction.
 * Data requirements: Locale agent data from `useAgent(id)`, basin list from
 * `useLocalesAndBasins()`, and membership mutation through `toggleJoinGroup`.
 * Rendering: Client-rendered (`"use client"`), with hook-based data loading and no metadata
 * export from this module.
 */
"use client"

import { use } from "react"
import Link from "next/link"
import Image from "next/image"
import { AgentPageShell } from "@/components/agent-page-shell"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { MapPin, Users, Globe, Heart } from "lucide-react"
import { useAgent, useLocalesAndBasins } from "@/lib/hooks/use-graph-data"
import { agentToLocale } from "@/lib/graph-adapters"
import { useToast } from "@/components/ui/use-toast"
import { toggleJoinGroup } from "@/app/actions/interactions"
import { useState } from "react"

/**
 * Renders locale detail content for the dynamic locale id route.
 *
 * @param props - Next.js route params promise containing locale `id`.
 * @returns Loading skeleton, not-found state, or locale profile UI with join action.
 */
export default function LocalePage(props: { params: Promise<{ id: string }> }) {
  // Resolve route parameters for client-side data hooks and actions.
  const params = use(props.params)
  const { toast } = useToast()
  const [joinPending, setJoinPending] = useState(false)
  // Hook manages locale agent fetch lifecycle (`idle`/`loading`/resolved states).
  const { agent, state } = useAgent(params.id)
  const {
    data: { basins },
  } = useLocalesAndBasins()

  // Conditional rendering for loading and idle fetch states.
  if (state === "loading" || state === "idle") {
    return (
      <div className="container mx-auto px-4 py-6">
        <div className="animate-pulse space-y-4">
          <div className="h-48 bg-muted rounded-lg" />
          <div className="h-8 bg-muted rounded w-1/3" />
          <div className="h-24 bg-muted rounded" />
        </div>
      </div>
    )
  }

  // Conditional rendering for missing locale data; no redirect is triggered.
  if (!agent) {
    return (
      <div className="container mx-auto px-4 py-6">
        <div className="text-center py-12">
          <h1 className="text-2xl font-bold mb-2">Locale not found</h1>
          <p className="text-muted-foreground mb-4">The locale you are looking for does not exist.</p>
          <Link href="/locales">
            <Button>Browse All Locales</Button>
          </Link>
        </div>
      </div>
    )
  }

  const locale = agentToLocale(agent)
  // Basin lookup uses both explicit locale basin id and fallback parent agent id.
  const basin = basins.find((b) => b.id === locale.basinId || b.id === agent.parentId)
  /**
   * Toggles current-user membership for the locale and reports the result by toast.
   */
  const handleJoin = async () => {
    setJoinPending(true)
    try {
      // Mutation is executed client-side; server action response drives toast feedback.
      const result = await toggleJoinGroup(params.id, "group")
      if (!result.success) {
        toast({ title: "Could not update membership", description: result.message, variant: "destructive" })
        return
      }
      toast({ title: result.active ? "Joined locale" : "Left locale", description: result.message })
    } finally {
      setJoinPending(false)
    }
  }
  const header = (
    <div className="space-y-4">
      {locale.image && (
        <div className="h-48 overflow-hidden rounded-lg">
          <Image
            src={locale.image}
            alt={locale.name}
            width={1200}
            height={360}
            className="h-full w-full object-cover"
          />
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <h1 className="text-3xl font-bold">{locale.name}</h1>
            {locale.isCommons && <Badge>Commons</Badge>}
          </div>
          <div className="flex flex-wrap items-center gap-4 text-muted-foreground">
            <div className="flex items-center gap-1">
              <MapPin className="h-4 w-4" />
              {locale.location || "Location unavailable"}
            </div>
            <div className="flex items-center gap-1">
              <Users className="h-4 w-4" />
              {locale.memberCount} members
            </div>
            <div className="flex items-center gap-1">
              <Globe className="h-4 w-4" />
              {basin?.name || "Basin unavailable"}
            </div>
          </div>
        </div>
        <Button onClick={() => void handleJoin()} disabled={joinPending}>
          <Heart className="mr-2 h-4 w-4" />
          {joinPending ? "Updating..." : "Join Locale"}
        </Button>
      </div>
    </div>
  )

  return (
    <AgentPageShell
      backHref="/locales"
      backLabel="Back to locales"
      header={header}
      maxWidthClassName="max-w-5xl"
    >
      <Card>
        <CardHeader>
          <CardTitle>About {locale.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4">{locale.description || "No description provided."}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h4 className="font-semibold mb-2">Location</h4>
              <p className="text-sm text-muted-foreground">{locale.location || "Unknown"}</p>
            </div>
            <div>
              <h4 className="font-semibold mb-2">River Basin</h4>
              <p className="text-sm text-muted-foreground">{basin?.name || "Unknown"}</p>
            </div>
            <div>
              <h4 className="font-semibold mb-2">Members</h4>
              <p className="text-sm text-muted-foreground">{locale.memberCount} active members</p>
            </div>
            <div>
              <h4 className="font-semibold mb-2">Status</h4>
              <p className="text-sm text-muted-foreground">{locale.isCommons ? "Activated Commons" : "Locale"}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </AgentPageShell>
  )
}
