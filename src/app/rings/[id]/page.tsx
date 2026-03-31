/**
 * Ring detail page for `/rings/[id]`.
 *
 * Purpose:
 * - Displays a ring (cooperative governance circle) with members, sub-groups (domains),
 *   projects, jobs/tasks hierarchies, assets, vouchers, marketplace listings,
 *   governance items, stake/treasury activity, and a general activity feed.
 *
 * Rendering: Server Component (no `"use client"` directive).
 * Data requirements:
 * - `fetchGroupDetail(id)` for the ring entity, members, subgroups, and resources.
 * - `fetchAgentFeed(id, 60)` for timeline activity (stake contributions, treasury transfers).
 *
 * Auth: No explicit auth gate.
 * Metadata: No `metadata` export; metadata is inherited from the layout.
 *
 * @module rings/[id]/page
 */
import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { FolderKanban, Handshake } from "lucide-react"
import { auth } from "@/auth"
import { fetchAgentFeed, fetchGroupDetail } from "@/app/actions/graph"
import { agentToGroup, agentToUser, resourceToPost } from "@/lib/graph-adapters"
import { buildGroupPageMetadata } from "@/lib/object-metadata"
import { AgentPageShell } from "@/components/agent-page-shell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { GroupProfileHeader } from "@/components/group-profile-header"
import { RingActions } from "@/components/ring-actions"
import { RingTreasuryTab } from "@/components/ring-treasury-tab"
import { VoucherPoolTab } from "@/components/voucher-pool-tab"
import { MutualAssetsTab } from "@/components/mutual-assets-tab"
import { GroupCalendar } from "@/components/group-calendar"
import { PostFeed } from "@/components/post-feed"
import { GroupSubgroups } from "@/components/group-subgroups"
import { GovernanceTab } from "@/components/governance-tab"
import { AboutDocumentsCard } from "@/components/about-documents-card"
import { buildGroupStructuredData, serializeJsonLd } from "@/lib/structured-data"
import type { Poll, Post, Proposal, User } from "@/lib/types"
import { ProposalStatus } from "@/lib/types"

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const detail = await fetchGroupDetail(id)

  if (!detail) {
    return {
      title: "Ring Not Found | RIVR",
    }
  }

  return buildGroupPageMetadata(detail.group, `/rings/${detail.group.id}`)
}

/**
 * Server-rendered page component for a single ring entity.
 *
 * @param params - Promise-based dynamic route params (`{ id }`) supplied by the App Router.
 * @returns Ring detail UI with tabbed sections for members, domains, jobs, governance, etc.
 */
export default async function RingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Fetch ring detail and activity feed in parallel to reduce server render latency.
  const [detail, activity, session] = await Promise.all([
    fetchGroupDetail(id),
    fetchAgentFeed(id, 60).catch(() => []),
    auth(),
  ])

  // If the ring does not exist, render the segment's not-found boundary.
  if (!detail) notFound()

  // Normalize graph entities into UI-facing types.
  const ring = agentToGroup(detail.group)
  const members = detail.members.map(agentToUser)
  const domains = detail.subgroups.map(agentToGroup)
  const meta = (detail.group.metadata ?? {}) as Record<string, unknown>
  const adminIds = Array.isArray(meta.adminIds) ? meta.adminIds : []
  const sessionUserId = session?.user?.id ?? null
  const canManageStripe = !!(
    sessionUserId &&
    (meta.creatorId === sessionUserId || adminIds.includes(sessionUserId))
  )

  // Categorize resources by type/metadata for display in dedicated tabs.
  const resources = detail.resources
  const posts = resources
    .filter((r) => {
      const m = (r.metadata ?? {}) as Record<string, unknown>
      return r.type === "post" || String(m.resourceKind ?? "").toLowerCase() === "post"
    })
    .map((resource) => resourceToPost(resource) as Post)
  const projects = resources.filter((r) => {
    const m = (r.metadata ?? {}) as Record<string, unknown>
    return r.type === "project" || m.resourceKind === "project"
  })
  const listings = resources.filter((r) => {
    const m = (r.metadata ?? {}) as Record<string, unknown>
    return (
      (r.type === "resource" || r.type === "skill" || r.type === "venue")
      && (
        String(m.listingKind ?? "").toLowerCase() === "marketplace-listing"
        || typeof m.listingType === "string"
      )
    )
  })
  const documentResources = resources
    .filter((r) => r.type === "document")
    .map((resource) => ({
      id: resource.id,
      title: resource.name,
      description: resource.description || "",
      content: typeof resource.content === "string" ? resource.content : "",
      createdAt: resource.createdAt,
      updatedAt: resource.updatedAt,
      createdBy: resource.ownerId || "system",
      groupId: ring.id,
      category: typeof (resource.metadata ?? {}).category === "string" ? String((resource.metadata ?? {}).category) : undefined,
      tags: Array.isArray((resource.metadata ?? {}).tags)
        ? ((resource.metadata ?? {}).tags as string[])
        : [],
      showOnAbout: (resource.metadata ?? {}).showOnAbout === true,
    }))
  // Aggregate governance items (proposals, polls, issues) from the ring's metadata.
  const governanceItems = [
    ...(((meta.proposals as unknown[]) ?? []) as unknown[]),
    ...(((meta.polls as unknown[]) ?? []) as unknown[]),
    ...(((meta.issues as unknown[]) ?? []) as unknown[]),
  ]
  const governanceProposals: Proposal[] = governanceItems
    .filter((item) => {
      const rec = item as Record<string, unknown>
      return rec.type === "proposal" || rec.title != null
    })
    .map((item) => {
      const rec = item as Record<string, unknown>
      const normalizedStatus = String(rec.status ?? "active")
      const proposalStatus =
        ProposalStatus[
          (normalizedStatus.charAt(0).toUpperCase() + normalizedStatus.slice(1)) as keyof typeof ProposalStatus
        ] ?? ProposalStatus.Active
      return {
        id: String(rec.id ?? ""),
        title: String(rec.title ?? rec.question ?? "Untitled"),
        description: String(rec.description ?? ""),
        status: proposalStatus,
        votes: {
          yes: Number(rec.votesFor ?? rec.votesYes ?? 0),
          no: Number(rec.votesAgainst ?? rec.votesNo ?? 0),
          abstain: Number(rec.votesAbstain ?? 0),
        },
        quorum: Number(rec.quorum ?? 0),
        threshold: Number(rec.threshold ?? 50),
        endDate: String(rec.deadline ?? rec.endDate ?? ""),
        creator: { id: "", name: String(rec.creatorName ?? "Unknown"), username: "unknown", avatar: "", followers: 0, following: 0 } as User,
        createdAt: String(rec.createdAt ?? ""),
        comments: Number(rec.comments ?? 0),
        groupId: ring.id,
      }
    })
  const governancePolls: Poll[] = governanceItems
    .filter((item) => {
      const rec = item as Record<string, unknown>
      return rec.type === "poll"
    })
    .map((item) => {
      const rec = item as Record<string, unknown>
      const rawOptions = Array.isArray(rec.options) ? (rec.options as Record<string, unknown>[]) : []
      return {
        id: String(rec.id ?? ""),
        question: String(rec.question ?? rec.title ?? ""),
        description: typeof rec.description === "string" ? rec.description : undefined,
        options: rawOptions.map((option, idx) => ({
          id: String(option.id ?? `opt-${idx}`),
          text: String(option.label ?? option.text ?? ""),
          votes: Number(option.votes ?? 0),
        })),
        totalVotes: Number(rec.totalVotes ?? 0),
        creator: { id: "", name: String(rec.creatorName ?? "Unknown"), username: "unknown", avatar: "", followers: 0, following: 0 } as User,
        createdAt: String(rec.createdAt ?? ""),
        endDate: String(rec.deadline ?? rec.endDate ?? ""),
        groupId: ring.id,
      }
    })
  const governanceIssues = governanceItems
    .filter((item) => {
      const rec = item as Record<string, unknown>
      return rec.type === "issue"
    })
    .map((item) => {
      const rec = item as Record<string, unknown>
      return {
        id: String(rec.id ?? ""),
        title: String(rec.title ?? ""),
        description: String(rec.description ?? ""),
        status: String(rec.status ?? "open"),
        creator: { name: String(rec.creatorName ?? "Unknown") },
        createdAt: String(rec.createdAt ?? ""),
        tags: Array.isArray(rec.tags) ? (rec.tags as string[]) : [],
        votes: { up: Number(rec.votesUp ?? 0), down: Number(rec.votesDown ?? 0) },
        comments: Number(rec.comments ?? 0),
      }
    })

  // Filter activity feed for treasury and stake-specific entries.
  const peopleUsers: User[] = members.map((member) => ({
    id: member.id,
    name: member.name,
    username: member.username || member.id,
    avatar: member.avatar || "/placeholder-user.jpg",
    followers: 0,
    following: 0,
  }))
  const adminMembers = members.filter((member) => adminIds.includes(member.id))
  const ringLocationText =
    typeof ring.location === "string"
      ? ring.location
      : ring.location && typeof ring.location === "object"
        ? String((ring.location as Record<string, unknown>).address ?? (ring.location as Record<string, unknown>).name ?? "Location not provided")
        : "Location not provided"
  const structuredData = buildGroupStructuredData(ring, {
    path: `/rings/${ring.id}`,
    visibility: detail.group.visibility ?? null,
    groupType: String(meta.groupType ?? "ring"),
    memberCount: members.length || ring.memberCount || 0,
  })
  const header = (
    <GroupProfileHeader
      groupId={ring.id}
      name={ring.name}
      description={ring.description}
      avatar={ring.image || "/placeholder.svg"}
      coverImage={
        typeof meta.coverImage === "string" && meta.coverImage
          ? meta.coverImage as string
          : "/vibrant-garden-tending.png"
      }
      location={ringLocationText}
      memberCount={members.length || ring.memberCount || 0}
      tags={ring.chapterTags ?? []}
      isAdmin={canManageStripe}
      groupType={String(meta.groupType ?? "ring")}
      commissionBps={typeof meta.commissionBps === "number" ? meta.commissionBps as number : undefined}
    >
      <RingActions
        ringId={ring.id}
        ringName={ring.name}
        ringDescription={ring.description}
        ownerId={meta.creatorId as string}
      />
    </GroupProfileHeader>
  )

  return (
    <AgentPageShell
      backHref="/rings"
      backLabel="Back to rings"
      header={header}
      structuredDataJson={structuredData ? serializeJsonLd(structuredData) : null}
    >
      <Tabs defaultValue="about" className="w-full">
        <div className="overflow-x-auto -mx-4 px-4 scrollbar-hide">
        <TabsList className="inline-flex w-max min-w-full gap-1">
          <TabsTrigger value="about">About</TabsTrigger>
          <TabsTrigger value="feed">Feed</TabsTrigger>
          <TabsTrigger value="families">Families</TabsTrigger>
          <TabsTrigger value="assets">Assets</TabsTrigger>
          <TabsTrigger value="vouchers">Vouchers</TabsTrigger>
          <TabsTrigger value="treasury">Treasury</TabsTrigger>
          <TabsTrigger value="joint-ventures">Joint Ventures</TabsTrigger>
          <TabsTrigger value="governance">Voice</TabsTrigger>
          <TabsTrigger value="admins">Admins</TabsTrigger>
        </TabsList>
        </div>

        <TabsContent value="about" className="space-y-4 mt-4">
          <GroupCalendar
            eventResources={[]}
            projectResources={projects}
            jobResources={[]}
            groupName={ring.name}
          />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle>Ring Overview</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-sm">
                <p>{ring.description || "No description yet."}</p>
                {ring.chapterTags?.length ? (
                  <div className="flex flex-wrap gap-2">
                    {ring.chapterTags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                  </div>
                ) : null}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Ring Stats</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>Members: {members.length}</p>
                <p>Posts: {posts.length}</p>
                <p>Families: {detail.subgroups.length}</p>
                <p>Resources: {resources.length}</p>
              </CardContent>
            </Card>
          </div>
          <AboutDocumentsCard
            documents={documentResources}
            docsPath={`/rings/${ring.id}/docs`}
            emptyLabel="Open the documents page to create one and turn on “Show on About page.”"
          />
        </TabsContent>

        <TabsContent value="feed" className="space-y-4 mt-4">
          <PostFeed posts={posts} />
        </TabsContent>

        <TabsContent value="families" className="space-y-4 mt-4">
          <GroupSubgroups parentGroupId={ring.id} isCreator={canManageStripe} isAdmin={canManageStripe} />
        </TabsContent>

        <TabsContent value="assets" className="space-y-3 mt-4">
          <MutualAssetsTab ringId={ring.id} />
        </TabsContent>

        <TabsContent value="vouchers" className="space-y-3 mt-4">
          <VoucherPoolTab
            ringId={ring.id}
            ringName={ring.name}
            localeIds={ring.chapterTags ?? []}
            currentUserId={sessionUserId ?? undefined}
            members={members}
          />
        </TabsContent>

        <TabsContent value="governance" className="space-y-3 mt-4">
          <GovernanceTab
            groupId={ring.id}
            issues={governanceIssues}
            polls={governancePolls}
            proposals={governanceProposals}
          />
        </TabsContent>

        <TabsContent value="treasury" className="space-y-3 mt-4">
          <RingTreasuryTab ringId={ring.id} canManageStripe={canManageStripe} />
        </TabsContent>

        <TabsContent value="joint-ventures" className="space-y-3 mt-4">
          {projects.length === 0 && listings.length === 0 ? <p className="text-sm text-muted-foreground">No joint ventures found yet.</p> : null}
          {projects.map((project) => (
            <Card key={project.id}>
              <CardContent className="py-3 flex items-center justify-between gap-3">
                <p className="font-medium inline-flex items-center gap-2"><Handshake className="h-4 w-4" />{project.name}</p>
                <Link href={`/projects/${project.id}`} className="text-sm text-primary hover:underline">Open</Link>
              </CardContent>
            </Card>
          ))}
          {listings.map((listing) => (
            <Card key={listing.id}>
              <CardContent className="py-3">
                <p className="font-medium">{listing.name}</p>
                <p className="text-sm text-muted-foreground">{listing.description || "No description"}</p>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="admins" className="space-y-3 mt-4">
          {adminMembers.length === 0 ? <p className="text-sm text-muted-foreground">No ring admins listed yet.</p> : null}
          {adminMembers.map((admin) => (
            <Card key={admin.id}>
              <CardContent className="py-3 flex items-center justify-between gap-3">
                <p className="font-medium">{admin.name}</p>
                <span className="text-sm text-muted-foreground">@{admin.username || admin.id}</span>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </AgentPageShell>
  )
}
