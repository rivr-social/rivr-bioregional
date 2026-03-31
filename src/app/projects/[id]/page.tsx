/**
 * Project detail page for `/projects/[id]`.
 *
 * Purpose:
 * - Renders a comprehensive project profile with owner info, member list,
 *   activity feed, status progress, and action controls.
 *
 * Rendering: Server Component (no `"use client"` directive).
 * Data requirements:
 * - Fetches the project agent directly via `fetchAgent(id)`.
 * - Resolves owner/creator from agent metadata via a second `fetchAgent` call.
 * - Loads child agents via `fetchAgentChildren` for the member list.
 * - Loads recent activity via `fetchAgentFeed` for the timeline.
 * - Normalizes the agent to a `Project` type via `agentToProject`.
 *
 * Auth: No explicit auth gate; visibility is enforced by graph-layer policy.
 * Metadata: No `metadata` export; metadata is inherited from the layout.
 *
 * @module projects/[id]/page
 */
import Link from "next/link"
import Image from "next/image"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import {
  ArrowLeft,
  Briefcase,
  Calendar,
  Clock,
  Edit,
  MapPin,
  MessageSquare,
  Plus,
  Star,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { fetchAgent, fetchAgentChildren, fetchAgentFeed } from "@/app/actions/graph"
import { agentToProject } from "@/lib/graph-adapters"
import { buildGroupPageMetadata } from "@/lib/object-metadata"
import { buildProjectStructuredData, serializeJsonLd } from "@/lib/structured-data"
import { ProjectActions } from "@/components/project-actions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"

/** Status-to-progress mapping for project lifecycle stages. */
const STATUS_PROGRESS: Record<string, number> = {
  planning: 0,
  active: 50,
  completed: 100,
}

/** Status-to-badge-variant mapping for visual differentiation. */
const STATUS_BADGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  planning: "outline",
  active: "default",
  completed: "secondary",
}

/** Status-to-label mapping for display text. */
const STATUS_LABEL: Record<string, string> = {
  planning: "Planning",
  active: "Active",
  completed: "Completed",
}

/** Icon mapping for activity feed verb types. */
const VERB_ICON_MAP: Record<string, typeof Star> = {
  create: Plus,
  join: UserPlus,
  update: Edit,
  delete: Trash2,
  comment: MessageSquare,
  like: Star,
}

/** Maximum number of members displayed before the overflow indicator. */
const MAX_VISIBLE_MEMBERS = 10

/** Maximum number of activity feed entries to display. */
const ACTIVITY_FEED_LIMIT = 10

async function getProjectPageData(id: string) {
  const agent = await fetchAgent(id)
  if (!agent) return null

  const project = agentToProject(agent)
  const ownerId = resolveOwnerId(agent.metadata ?? {})
  const [owner, children, activity] = await Promise.all([
    ownerId ? fetchAgent(ownerId) : Promise.resolve(null),
    fetchAgentChildren(id),
    fetchAgentFeed(id, ACTIVITY_FEED_LIMIT),
  ])

  return {
    agent,
    project,
    ownerId,
    owner,
    children,
    activity,
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const data = await getProjectPageData(id)

  if (!data) {
    return {
      title: "Project Not Found | RIVR",
    }
  }

  return buildGroupPageMetadata(data.agent, `/projects/${data.project.id}`)
}

/**
 * Resolves the owner/creator ID from agent metadata, checking multiple fallback keys.
 *
 * @param metadata - The agent's metadata record.
 * @returns The owner ID string, or `null` if no valid owner key is found.
 */
function resolveOwnerId(metadata: Record<string, unknown>): string | null {
  if (typeof metadata.creatorId === "string" && metadata.creatorId.length > 0) {
    return metadata.creatorId
  }
  if (typeof metadata.ownerId === "string" && metadata.ownerId.length > 0) {
    return metadata.ownerId
  }
  return null
}

/**
 * Formats an ISO timestamp into a human-readable relative time string.
 *
 * @param timestamp - ISO 8601 date string.
 * @returns Relative time string (e.g., "3 hours ago"), or "Unknown" if parsing fails.
 */
function formatRelativeTime(timestamp: string): string {
  try {
    return formatDistanceToNow(new Date(timestamp), { addSuffix: true })
  } catch {
    return "Unknown"
  }
}

/**
 * Server-rendered page component for a single project.
 *
 * Fetches the project agent directly by ID, resolves the owner, loads members and
 * activity feed, then renders an enriched multi-card layout with status progress,
 * owner info, member grid, and activity timeline.
 *
 * @param params - Promise-based dynamic route params (`{ id }`) supplied by the App Router.
 * @returns Enriched project detail view, or triggers the segment's 404 boundary if not found.
 */
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await getProjectPageData(id)

  // If the project agent does not exist or is not viewable, render the 404 boundary.
  if (!data) {
    notFound()
  }

  const { agent, project, ownerId, owner, children, activity } = data
  const members = children.filter((child) => child.type === "person")

  // Derive status display values.
  const statusKey = project.status || "active"
  const progressValue = STATUS_PROGRESS[statusKey] ?? 50
  const badgeVariant = STATUS_BADGE_VARIANT[statusKey] ?? "default"
  const statusLabel = STATUS_LABEL[statusKey] ?? statusKey

  // Count overflow members beyond the visible limit.
  const visibleMembers = members.slice(0, MAX_VISIBLE_MEMBERS)
  const overflowCount = members.length - visibleMembers.length
  const structuredData = buildProjectStructuredData(project, {
    visibility: agent.visibility ?? null,
    ownerName: owner?.name ?? null,
  })

  return (
    <div className="container max-w-4xl mx-auto px-4 py-6 space-y-4">
      {structuredData ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }}
        />
      ) : null}
      {/* Back navigation link */}
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Back to home
      </Link>

      {/* Main project card */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="text-2xl">{project.name}</CardTitle>
              {project.description ? (
                <p className="text-muted-foreground">{project.description}</p>
              ) : null}
            </div>
            <Badge variant={badgeVariant}>{statusLabel}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Status progress bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Progress</span>
              <span>{progressValue}%</span>
            </div>
            <Progress value={progressValue} className="h-2" />
          </div>

          {/* Metadata row: members, location, date */}
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <Users className="h-4 w-4" />
              {project.memberCount || members.length || 0} members
            </span>
            <span className="inline-flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              {project.location || "Location not provided"}
            </span>
            <span className="inline-flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              {new Date(project.createdAt).toLocaleDateString()}
            </span>
          </div>

          {/* Chapter tags */}
          {project.chapterTags?.length ? (
            <div className="flex flex-wrap gap-2">
              {project.chapterTags.map((tag) => (
                <Badge key={tag} variant="secondary">{tag}</Badge>
              ))}
            </div>
          ) : null}

          {/* General tags */}
          {project.tags?.length ? (
            <div className="flex flex-wrap gap-2">
              {project.tags.map((tag) => (
                <Badge key={tag} variant="outline">{tag}</Badge>
              ))}
            </div>
          ) : null}

          {/* Owner-only edit/delete actions */}
          <ProjectActions
            projectId={project.id}
            projectName={project.name}
            projectDescription={project.description}
            ownerId={ownerId}
          />
        </CardContent>
      </Card>

      {/* Owner / project lead card */}
      {owner ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Project Lead</CardTitle>
          </CardHeader>
          <CardContent>
            <Link
              href={`/profile/${(owner.metadata?.username as string) || owner.id}`}
              className="inline-flex items-center gap-3 hover:opacity-80 transition-opacity"
            >
              <Image
                src={owner.image || "/placeholder-user.jpg"}
                alt={owner.name}
                width={40}
                height={40}
                className="rounded-full object-cover"
              />
              <div>
                <p className="text-sm font-medium leading-none">{owner.name}</p>
                <p className="text-xs text-muted-foreground mt-1">Project lead</p>
              </div>
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {/* Members card */}
      {members.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Members
              <span className="text-sm font-normal text-muted-foreground ml-2">
                ({members.length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
              {visibleMembers.map((member) => (
                <Link
                  key={member.id}
                  href={`/profile/${(member.metadata?.username as string) || member.id}`}
                  className="flex flex-col items-center gap-2 hover:opacity-80 transition-opacity"
                >
                  <Image
                    src={member.image || "/placeholder-user.jpg"}
                    alt={member.name}
                    width={40}
                    height={40}
                    className="rounded-full object-cover"
                  />
                  <span className="text-xs text-center truncate max-w-[80px]">{member.name}</span>
                </Link>
              ))}
              {overflowCount > 0 ? (
                <div className="flex flex-col items-center justify-center gap-2">
                  <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">
                    +{overflowCount}
                  </div>
                  <span className="text-xs text-muted-foreground">more</span>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Activity feed card */}
      {activity.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {activity.map((entry) => {
                const VerbIcon = VERB_ICON_MAP[entry.verb] ?? Briefcase
                const description =
                  typeof entry.metadata?.description === "string"
                    ? entry.metadata.description
                    : `${entry.verb} on ${entry.objectType || "item"}`

                return (
                  <div key={entry.id} className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                      <VerbIcon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{description}</p>
                      <p className="text-xs text-muted-foreground inline-flex items-center gap-1 mt-1">
                        <Clock className="h-3 w-3" />
                        {formatRelativeTime(entry.timestamp)}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
