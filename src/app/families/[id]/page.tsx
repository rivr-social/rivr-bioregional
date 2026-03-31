/**
 * Family detail page for `/families/[id]`.
 *
 * Purpose:
 * - Displays a family entity (household-level governance unit) with members,
 *   governance items, feed/activity, stake contributions, treasury transfers, and resources.
 *
 * Rendering: Server Component (no `"use client"` directive).
 * Data requirements:
 * - `fetchGroupDetail(id)` for the family entity, members, and resources.
 * - `fetchAgentFeed(id, 60)` for timeline activity (stake, treasury, general feed).
 *
 * Auth: No explicit auth gate.
 * Metadata: No `metadata` export; metadata is inherited from the layout.
 *
 * @module families/[id]/page
 */
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { Calendar } from "lucide-react"
import { auth } from "@/auth"
import { fetchAgentFeed, fetchGroupDetail } from "@/app/actions/graph"
import { agentToGroup, agentToUser, resourceToPost } from "@/lib/graph-adapters"
import { buildGroupPageMetadata } from "@/lib/object-metadata"
import { AgentPageShell } from "@/components/agent-page-shell"
import { FamilyActions } from "@/components/family-actions"
import { GroupProfileHeader } from "@/components/group-profile-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs"
import { ResponsiveTabsList } from "@/components/responsive-tabs-list"
import { FamilyActivityTab } from "@/components/family-activity-tab"
import { FamilyTreasuryTab } from "@/components/family-treasury-tab"
import { PostFeed } from "@/components/post-feed"
import { PeopleFeed } from "@/components/people-feed"
import { GovernanceTab } from "@/components/governance-tab"
import { StakeTab } from "@/components/stake-tab"
import { AboutDocumentsCard } from "@/components/about-documents-card"
import { buildGroupStructuredData, serializeJsonLd } from "@/lib/structured-data"
import type { Post } from "@/lib/types"
import { ProposalStatus } from "@/lib/types"

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const detail = await fetchGroupDetail(id)

  if (!detail) {
    return {
      title: "Family Not Found | RIVR",
      robots: {
        index: false,
        follow: false,
      },
    }
  }

  return {
    ...buildGroupPageMetadata(detail.group, `/families/${detail.group.id}`),
    robots: {
      index: false,
      follow: false,
    },
  }
}

/**
 * Server-rendered page component for a single family entity.
 *
 * @param params - Promise-based dynamic route params (`{ id }`) supplied by the App Router.
 * @returns Family detail UI with tabbed sections for members, governance, activity, etc.
 */
export default async function FamilyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) notFound()

  // Fetch family detail and activity feed in parallel.
  const [detail, activity] = await Promise.all([
    fetchGroupDetail(id),
    fetchAgentFeed(id, 60).catch(() => []),
  ])

  // If the family does not exist, render the segment's not-found boundary.
  if (!detail) notFound()

  // Normalize graph entities into UI-facing types.
  const family = agentToGroup(detail.group)
  const members = detail.members.map(agentToUser)
  const meta = (detail.group.metadata ?? {}) as Record<string, unknown>
  const adminIds = Array.isArray(meta.adminIds) ? meta.adminIds : []
  const sessionUserId = session?.user?.id ?? null
  const canManageStripe = !!(
    sessionUserId &&
    (meta.creatorId === sessionUserId || adminIds.includes(sessionUserId))
  )
  // Aggregate governance items from the family's metadata.
  const governanceItems = [
    ...(((meta.proposals as unknown[]) ?? []) as unknown[]),
    ...(((meta.polls as unknown[]) ?? []) as unknown[]),
    ...(((meta.issues as unknown[]) ?? []) as unknown[]),
  ]
  const familyPostResources = detail.resources.filter((resource) => {
    const resourceMeta = (resource.metadata ?? {}) as Record<string, unknown>
    return resource.type === "post" || resource.type === "note" || String(resourceMeta.entityType ?? "") === "post"
  })
  const documentResources = detail.resources
    .filter((resource) => resource.type === "document")
    .map((resource) => {
      const metadata = (resource.metadata ?? {}) as Record<string, unknown>
      return {
        id: resource.id,
        title: resource.name,
        description: resource.description || "",
        content: typeof resource.content === "string" ? resource.content : "",
        createdAt: resource.createdAt,
        updatedAt: resource.updatedAt,
        createdBy: resource.ownerId || "system",
        groupId: family.id,
        category: typeof metadata.category === "string" ? metadata.category : undefined,
        tags: Array.isArray(metadata.tags) ? metadata.tags.filter((value): value is string => typeof value === "string") : [],
        showOnAbout: metadata.showOnAbout === true,
      }
    })
  const posts = familyPostResources.map((resource) => resourceToPost(resource) as Post)
  const peopleUsers = members.map((member) => ({
    ...member,
    followers: member.followers ?? 0,
    following: member.following ?? 0,
  }))
  const memberStakes = members.map((member) => ({
    user: {
      ...member,
      followers: member.followers ?? 0,
      following: member.following ?? 0,
    },
    profitShare: members.length > 0 ? Math.round((100 / members.length) * 100) / 100 : 0,
    contributionMetrics: {
      offersCreated: 0,
      offersAccepted: 0,
      thanksReceived: 0,
      thanksGiven: 0,
      proposalsCreated: 0,
      votesParticipated: 0,
    },
    joinedAt: member.joinedAt ?? member.joinDate ?? new Date().toISOString(),
    groupId: family.id,
  }))
  const proposals = governanceItems
    .filter((item) => {
      const record = item as Record<string, unknown>
      return record.type === "proposal" || record.title != null
    })
    .map((item) => {
      const record = item as Record<string, unknown>
      return {
        id: String(record.id ?? ""),
        title: String(record.title ?? record.question ?? "Untitled"),
        description: String(record.description ?? ""),
        status: (
          ProposalStatus[
            (String(record.status ?? "Active").charAt(0).toUpperCase() +
              String(record.status ?? "Active").slice(1)) as keyof typeof ProposalStatus
          ] ?? ProposalStatus.Active
        ),
        votes: {
          yes: Number(record.votesFor ?? record.votesYes ?? 0),
          no: Number(record.votesAgainst ?? record.votesNo ?? 0),
          abstain: Number(record.votesAbstain ?? 0),
        },
        quorum: Number(record.quorum ?? 0),
        threshold: Number(record.threshold ?? 50),
        endDate: String(record.deadline ?? record.endDate ?? ""),
        creator: {
          id: "",
          name: String(record.creatorName ?? "Unknown"),
          username: "unknown",
          avatar: "",
          followers: 0,
          following: 0,
        },
        createdAt: String(record.createdAt ?? ""),
        comments: Number(record.comments ?? 0),
        groupId: family.id,
      }
    })
  const polls = governanceItems
    .filter((item) => {
      const record = item as Record<string, unknown>
      return record.type === "poll" || Array.isArray(record.options)
    })
    .map((item) => {
      const record = item as Record<string, unknown>
      return {
        id: String(record.id ?? ""),
        question: String(record.question ?? record.title ?? "Untitled poll"),
        description: typeof record.description === "string" ? record.description : undefined,
        options: Array.isArray(record.options)
          ? record.options.map((option, index) => {
              const optionRecord = option as Record<string, unknown>
              return {
                id: String(optionRecord.id ?? index),
                text: String(optionRecord.text ?? optionRecord.label ?? `Option ${index + 1}`),
                votes: Number(optionRecord.votes ?? 0),
              }
            })
          : [],
        totalVotes: Number(record.totalVotes ?? 0),
        endDate: String(record.endDate ?? record.deadline ?? new Date().toISOString()),
        creator: {
          id: "",
          name: String(record.creatorName ?? "Unknown"),
          username: "unknown",
          avatar: "",
          followers: 0,
          following: 0,
        },
        createdAt: String(record.createdAt ?? ""),
        groupId: family.id,
      }
    })
  const issues = governanceItems
    .filter((item) => {
      const record = item as Record<string, unknown>
      return record.type === "issue"
    })
    .map((item) => {
      const record = item as Record<string, unknown>
      return {
        id: String(record.id ?? ""),
        title: String(record.title ?? "Untitled issue"),
        description: String(record.description ?? ""),
        status: String(record.status ?? "open"),
        creator: { name: String(record.creatorName ?? "Unknown") },
        createdAt: String(record.createdAt ?? ""),
        tags: Array.isArray(record.tags) ? record.tags.filter((value): value is string => typeof value === "string") : [],
        votes: {
          up: Number(record.votesUp ?? record.votesFor ?? 0),
          down: Number(record.votesDown ?? record.votesAgainst ?? 0),
        },
        comments: Number(record.comments ?? 0),
      }
    })

  // Filter activity feed for treasury and stake-specific entries.
  const stakeActivity = activity.filter((a) => a.verb === "fund")
  const structuredData = buildGroupStructuredData(family, {
    path: `/families/${family.id}`,
    visibility: detail.group.visibility ?? null,
    groupType: String(meta.groupType ?? "family"),
    memberCount: members.length || family.memberCount || 0,
  })
  const familyLocationText =
    typeof family.location === "string"
      ? family.location
      : family.location && typeof family.location === "object"
        ? String((family.location as Record<string, unknown>).address ?? (family.location as Record<string, unknown>).name ?? "Location not provided")
        : "Location not provided"
  const familyFoundedText = new Date(family.createdAt).toLocaleDateString()
  const header = (
    <GroupProfileHeader
      groupId={family.id}
      name={family.name}
      description={family.description}
      avatar={family.image || "/placeholder.svg"}
      coverImage={
        typeof meta.coverImage === "string" && meta.coverImage
          ? meta.coverImage as string
          : "/vibrant-garden-tending.png"
      }
      location={familyLocationText}
      memberCount={members.length || family.memberCount || 0}
      tags={family.chapterTags ?? []}
      isAdmin={canManageStripe}
      groupType={String(meta.groupType ?? "family")}
      commissionBps={typeof meta.commissionBps === "number" ? meta.commissionBps as number : undefined}
    >
      <FamilyActions
        familyId={family.id}
        familyName={family.name}
        familyDescription={family.description}
        ownerId={typeof meta.creatorId === "string" ? meta.creatorId : undefined}
      />
    </GroupProfileHeader>
  )
  return (
    <AgentPageShell
      backHref="/families"
      backLabel="Back to families"
      header={header}
      structuredDataJson={structuredData ? serializeJsonLd(structuredData) : null}
    >
      <Tabs defaultValue="about">
        <ResponsiveTabsList>
          <TabsTrigger value="about">About</TabsTrigger>
          <TabsTrigger value="feed">Feed</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="governance">Governance</TabsTrigger>
          <TabsTrigger value="stake">Stake</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </ResponsiveTabsList>
        <ResponsiveTabsList className="mt-2">
          <TabsTrigger value="treasury">Treasury</TabsTrigger>
          <TabsTrigger value="resources">Resources</TabsTrigger>
        </ResponsiveTabsList>

        <TabsContent value="about" className="mt-4">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Family Overview</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>{family.description || "No description yet."}</p>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  Founded {familyFoundedText}
                </div>
              </CardContent>
            </Card>
            <AboutDocumentsCard
              documents={documentResources}
              docsPath={`/families/${family.id}/docs`}
              emptyLabel="Open the documents page to create one and turn on “Show on About page.”"
            />
          </div>
        </TabsContent>

        <TabsContent value="feed" className="space-y-3 mt-4">
          <PostFeed posts={posts} />
        </TabsContent>

        <TabsContent value="members" className="space-y-3 mt-4">
          <PeopleFeed people={peopleUsers} />
        </TabsContent>

        <TabsContent value="governance" className="space-y-3 mt-4">
          <GovernanceTab groupId={family.id} issues={issues} polls={polls} proposals={proposals} />
        </TabsContent>

        <TabsContent value="stake" className="space-y-3 mt-4">
          <StakeTab groupId={family.id} memberStakes={memberStakes} totalStakes={100} />
        </TabsContent>

        <TabsContent value="activity" className="space-y-3 mt-4">
          <FamilyActivityTab familyId={family.id} />
        </TabsContent>

        <TabsContent value="treasury" className="space-y-3 mt-4">
          <FamilyTreasuryTab familyId={family.id} canManageStripe={canManageStripe} />
        </TabsContent>

        <TabsContent value="resources" className="space-y-3 mt-4">
          {detail.resources.length === 0 ? <p className="text-sm text-muted-foreground">No resources found.</p> : null}
          {detail.resources.map((r) => <Card key={r.id}><CardContent className="py-3"><p className="font-medium">{r.name}</p><p className="text-sm text-muted-foreground">{r.description || "No description"}</p></CardContent></Card>)}
        </TabsContent>
      </Tabs>
    </AgentPageShell>
  )
}
