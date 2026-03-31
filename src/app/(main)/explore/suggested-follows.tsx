"use client"

/**
 * SuggestedFollows displays a list of people the current user may want to follow.
 *
 * Data source: `fetchPeople` server action from `@/app/actions/graph`.
 * Interactions: `toggleFollowAgent` and `fetchFollowingIds` from `@/app/actions/interactions`.
 * Follow state is loaded on mount and toggled optimistically on click.
 */

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import Link from "next/link"
import { Users } from "lucide-react"
import { fetchPeople } from "@/app/actions/graph"
import { toggleFollowAgent, fetchFollowingIds } from "@/app/actions/interactions"
import { useUser } from "@/contexts/user-context"
import { useToast } from "@/components/ui/use-toast"
import { getLocalAgentsByType, upsertAgents, type LocalAgent } from "@/lib/local-db"
import type { SerializedAgent } from "@/lib/graph-serializers"

/** Maximum number of suggested people to fetch from the server. */
const SUGGESTED_PEOPLE_LIMIT = 50

interface SuggestedFollowsProps {
  chapterId?: string
}

/**
 * Renders a card with suggested people to follow, backed by real DB queries.
 *
 * Behavior:
 * - Fetches people and current follow state on mount.
 * - Filters out the current user from suggestions.
 * - Optimistically toggles follow state on button click and reverts on failure.
 *
 * @param props.chapterId - Optional chapter filter (reserved for future scope filtering).
 */
export function SuggestedFollows({ chapterId = "all" }: SuggestedFollowsProps) {
  const { currentUser } = useUser()
  const { toast } = useToast()

  const [people, setPeople] = useState<SerializedAgent[]>([])
  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())

  const matchesChapter = useCallback(
    (agent: SerializedAgent): boolean => {
      if (!chapterId || chapterId === "all") return true
      const metadata = (agent.metadata ?? {}) as Record<string, unknown>
      const chapterTags = Array.isArray(metadata.chapterTags)
        ? (metadata.chapterTags as string[])
        : []
      const localeId = typeof metadata.localeId === "string" ? metadata.localeId : ""
      const localeIdAlt = typeof metadata.locale_id === "string" ? metadata.locale_id : ""
      const pathIds = Array.isArray(agent.pathIds) ? agent.pathIds : []
      const scope = new Set([localeId, localeIdAlt, ...chapterTags, ...pathIds].filter(Boolean))
      return scope.has(chapterId)
    },
    [chapterId],
  )

  useEffect(() => {
    let cancelled = false

    // Phase 1: Instant read from IndexedDB for immediate display.
    getLocalAgentsByType("person", SUGGESTED_PEOPLE_LIMIT)
      .then((localPeople: LocalAgent[]) => {
        if (cancelled || localPeople.length === 0) return
        const asAgents: SerializedAgent[] = localPeople.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          description: a.description,
          email: a.email,
          image: a.image,
          metadata: a.metadata,
          parentId: a.parentId,
          pathIds: a.pathIds,
          depth: a.depth,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
        }))
        const filtered = currentUser
          ? asAgents.filter((agent) => agent.id !== currentUser.id)
          : asAgents
        setPeople(filtered)
        setLoading(false)
      })
      .catch(() => {})

    // Phase 2: Authoritative server fetch + follow state.
    async function loadData() {
      try {
        const [fetchedPeople, followingIds] = await Promise.all([
          fetchPeople(SUGGESTED_PEOPLE_LIMIT),
          fetchFollowingIds(),
        ])

        if (cancelled) return

        const filtered = currentUser
          ? fetchedPeople.filter((agent) => agent.id !== currentUser.id)
          : fetchedPeople

        setPeople(filtered)
        setFollowedIds(new Set(followingIds))

        // Persist to IndexedDB for future instant loads.
        upsertAgents(fetchedPeople.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          description: a.description,
          email: a.email,
          image: a.image,
          metadata: a.metadata ?? {},
          parentId: a.parentId,
          pathIds: a.pathIds ?? [],
          depth: a.depth,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
        }))).catch(() => {})
      } catch {
        if (cancelled) return
        setPeople([])
        setFollowedIds(new Set())
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadData()

    return () => {
      cancelled = true
    }
  }, [currentUser])

  /**
   * Resolves a display username from the agent metadata or falls back to the agent ID.
   */
  const getUsername = useCallback((agent: SerializedAgent): string => {
    const metaUsername = agent.metadata?.username
    if (typeof metaUsername === "string" && metaUsername.length > 0) return metaUsername
    return agent.id
  }, [])

  /**
   * Resolves a display bio/description for the agent.
   */
  const getBio = useCallback((agent: SerializedAgent): string => {
    if (agent.description) return agent.description
    const metaBio = agent.metadata?.bio
    if (typeof metaBio === "string" && metaBio.length > 0) return metaBio
    return ""
  }, [])

  /**
   * Toggles follow state with optimistic UI and server action confirmation.
   * Reverts the optimistic change and shows an error toast on failure.
   */
  const handleFollow = useCallback(
    async (agentId: string) => {
      // Prevent duplicate clicks while a toggle is in flight.
      if (pendingIds.has(agentId)) return

      const wasFollowed = followedIds.has(agentId)

      // Optimistic update: toggle immediately for responsive UI.
      setFollowedIds((prev) => {
        const next = new Set(prev)
        if (wasFollowed) {
          next.delete(agentId)
        } else {
          next.add(agentId)
        }
        return next
      })

      setPendingIds((prev) => new Set(prev).add(agentId))

      try {
        const result = await toggleFollowAgent(agentId)

        if (!result.success) {
          // Revert optimistic state on server failure.
          setFollowedIds((prev) => {
            const reverted = new Set(prev)
            if (wasFollowed) {
              reverted.add(agentId)
            } else {
              reverted.delete(agentId)
            }
            return reverted
          })

          toast({
            title: "Could not update follow",
            description: result.message,
            variant: "destructive",
          })
          return
        }

        // Reconcile with server-confirmed active state.
        setFollowedIds((prev) => {
          const reconciled = new Set(prev)
          if (result.active) {
            reconciled.add(agentId)
          } else {
            reconciled.delete(agentId)
          }
          return reconciled
        })

        toast({
          title: result.active ? "Following" : "Unfollowed",
          description: result.message,
        })
      } catch {
        // Revert on network/unexpected error.
        setFollowedIds((prev) => {
          const reverted = new Set(prev)
          if (wasFollowed) {
            reverted.add(agentId)
          } else {
            reverted.delete(agentId)
          }
          return reverted
        })

        toast({
          title: "Could not update follow",
          description: "An unexpected error occurred. Please try again.",
          variant: "destructive",
        })
      } finally {
        setPendingIds((prev) => {
          const next = new Set(prev)
          next.delete(agentId)
          return next
        })
      }
    },
    [followedIds, pendingIds, toast],
  )

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold flex items-center">
            <Users className="h-5 w-5 mr-2 text-primary" />
            Suggested Follows
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center">
                  <Skeleton className="h-8 w-8 rounded-full mr-2" />
                  <div>
                    <Skeleton className="h-4 w-24 mb-1" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </div>
                <Skeleton className="h-8 w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-semibold flex items-center">
          <Users className="h-5 w-5 mr-2 text-primary" />
          Suggested Follows
        </CardTitle>
      </CardHeader>
      <CardContent>
        {people.filter(matchesChapter).length > 0 ? (
          <div className="space-y-4">
            {people.filter(matchesChapter).map((agent) => {
              const username = getUsername(agent)
              const bio = getBio(agent)
              const isFollowed = followedIds.has(agent.id)
              const isPending = pendingIds.has(agent.id)

              return (
                <div key={agent.id} className="flex items-center justify-between">
                  <div className="flex items-center">
                    <Avatar className="h-8 w-8 mr-2">
                      <AvatarImage src={agent.image || "/placeholder.svg"} alt={agent.name} />
                      <AvatarFallback>{agent.name.substring(0, 2)}</AvatarFallback>
                    </Avatar>
                    <div>
                      <Link href={`/profile/${username}`} className="font-medium hover:underline block">
                        {agent.name}
                      </Link>
                      {bio && <p className="text-xs text-muted-foreground">{bio}</p>}
                    </div>
                  </div>
                  <Button
                    variant={isFollowed ? "outline" : "default"}
                    size="sm"
                    disabled={isPending}
                    onClick={() => void handleFollow(agent.id)}
                  >
                    {isPending ? "Updating..." : isFollowed ? "Following" : "Follow"}
                  </Button>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-center text-muted-foreground py-2">No suggested follows available</p>
        )}
      </CardContent>
    </Card>
  )
}
