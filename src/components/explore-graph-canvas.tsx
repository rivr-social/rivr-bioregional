"use client"

/**
 * Force-directed graph canvas for the Explore page.
 *
 * Renders all first-order objects (people, groups, events, posts, offerings) for the
 * currently selected locale as a D3 force-directed graph. Clicking a node re-centers
 * the graph on that object and fetches its connections (members, posts, groups, etc.),
 * creating a navigable knowledge-graph experience.
 *
 * Dependencies:
 * - d3 (d3-force, d3-selection, d3-zoom) — already in package.json
 * - Server actions from `@/app/actions/graph` for fetching connections on click
 * - Hooks from `@/lib/hooks/use-graph-data` for initial data loading
 */

import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import {
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceX,
  forceY,
  forceCollide,
  select,
  zoom as d3Zoom,
  zoomIdentity,
  drag as d3Drag,
} from "d3"
import { useHomeFeed, usePosts } from "@/lib/hooks/use-graph-data"
import {
  fetchGroupDetail,
  fetchProfileData,
  fetchResourcesByOwner,
  queryLedgerEntries,
} from "@/app/actions/graph"
import type { LedgerFilter } from "@/components/query-composer"
import {
  agentToUser,
  agentToGroup,
  agentToEvent,
  resourceToPost,
  resourceToMarketplaceListing,
} from "@/lib/graph-adapters"
import { Button } from "@/components/ui/button"
import { RotateCcw, ChevronLeft } from "lucide-react"
import {
  GRAPH_CATEGORY_COLORS,
  GRAPH_CATEGORY_RADII,
  type GraphNodeCategory,
} from "@/lib/entity-style"

// ─── Constants ──────────────────────────────────────────────────────────────

/** Node types with distinct visual identities. */
const NODE_TYPE = {
  PERSON: "person",
  GROUP: "group",
  EVENT: "event",
  POST: "post",
  OFFERING: "offering",
} as const

type NodeType = (typeof NODE_TYPE)[keyof typeof NODE_TYPE]

/** Color palette per node type — sourced from centralized entity-style. */
const NODE_COLORS: Record<NodeType, string> = GRAPH_CATEGORY_COLORS

/** Node radius by type — sourced from centralized entity-style. */
const NODE_RADII: Record<NodeType, number> = GRAPH_CATEGORY_RADII

/** Maximum label length before truncation. */
const MAX_LABEL_LENGTH = 18

/** Force simulation parameters. */
const FORCE_CHARGE_STRENGTH = -250
const FORCE_LINK_DISTANCE = 200
const FORCE_COLLISION_PADDING = 15
const SIMULATION_ALPHA_TARGET = 0
const SIMULATION_ALPHA_RESTART = 0.3
const SIMULATION_VELOCITY_DECAY = 0.4

// ─── Types ──────────────────────────────────────────────────────────────────

interface GraphNode extends SimulationNodeDatum {
  id: string
  label: string
  type: NodeType
  href: string
  /** When true, node is pinned at center during re-centering. */
  pinned?: boolean
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  id: string
  /** Optional verb label to show on the edge. */
  label?: string
}

interface NavigationEntry {
  centerId: string | null
  label: string
}

// ─── Component Props ────────────────────────────────────────────────────────

interface ExploreGraphCanvasProps {
  /** Currently selected locale/chapter ID from the app context. "all" = no filter. */
  selectedChapter: string
  /** Search query to filter nodes by name. */
  searchQuery?: string
  /** When set, shows only ledger entries matching the filter instead of the default overview. */
  ledgerFilter?: LedgerFilter
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function truncateLabel(label: string): string {
  if (label.length <= MAX_LABEL_LENGTH) return label
  return label.slice(0, MAX_LABEL_LENGTH - 1) + "\u2026"
}

function makeLinkId(sourceId: string, targetId: string): string {
  return sourceId < targetId ? `${sourceId}--${targetId}` : `${targetId}--${sourceId}`
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function ExploreGraphCanvas({ selectedChapter, searchQuery = "", ledgerFilter }: ExploreGraphCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const expandNodeRef = useRef<(node: GraphNode) => void>(() => {})
  const simulationRef = useRef<Simulation<GraphNode, GraphLink> | null>(null)
  const simNodesRef = useRef<GraphNode[]>([])

  // Focus state: when a node is clicked, dim unrelated nodes/edges
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)

  // Ledger filter state
  const [ledgerNodes, setLedgerNodes] = useState<GraphNode[]>([])
  const [ledgerLinks, setLedgerLinks] = useState<GraphLink[]>([])
  const [isLedgerLoading, setIsLedgerLoading] = useState(false)
  const isLedgerMode = !!(ledgerFilter?.subjectId || ledgerFilter?.verb || ledgerFilter?.objectId)

  // Fetch ledger entries when filter changes
  useEffect(() => {
    if (!isLedgerMode) {
      setLedgerNodes([])
      setLedgerLinks([])
      return
    }

    let cancelled = false
    setIsLedgerLoading(true)

    async function fetchLedger() {
      try {
        const entries = await queryLedgerEntries({
          subjectId: ledgerFilter?.subjectId,
          verb: ledgerFilter?.verb,
          objectId: ledgerFilter?.objectId,
          startDate: ledgerFilter?.startDate,
          endDate: ledgerFilter?.endDate,
        })

        if (cancelled) return

        const nodes: GraphNode[] = []
        const links: GraphLink[] = []
        const nodeIds = new Set<string>()

        const typeMap: Record<string, NodeType> = {
          person: NODE_TYPE.PERSON,
          organization: NODE_TYPE.GROUP,
          group: NODE_TYPE.GROUP,
          event: NODE_TYPE.EVENT,
          post: NODE_TYPE.POST,
          note: NODE_TYPE.POST,
          offering: NODE_TYPE.OFFERING,
          product: NODE_TYPE.OFFERING,
          service: NODE_TYPE.OFFERING,
        }

        for (const entry of entries) {
          // Subject node
          if (!nodeIds.has(entry.subjectId)) {
            nodeIds.add(entry.subjectId)
            nodes.push({
              id: entry.subjectId,
              label: entry.subjectName,
              type: typeMap[entry.subjectType] ?? NODE_TYPE.PERSON,
              href: entry.subjectType === "person" ? `/people/${entry.subjectId}` : `/groups/${entry.subjectId}`,
            })
          }

          // Object node
          if (entry.objectId && !nodeIds.has(entry.objectId)) {
            nodeIds.add(entry.objectId)
            const objType = typeMap[entry.objectType ?? ""] ?? NODE_TYPE.PERSON
            nodes.push({
              id: entry.objectId,
              label: entry.objectName ?? "Unknown",
              type: objType,
              href: objType === NODE_TYPE.PERSON ? `/people/${entry.objectId}` : `/${entry.objectType ?? "agents"}/${entry.objectId}`,
            })
          }

          // Link with verb label
          if (entry.objectId) {
            const linkId = `${entry.id}`
            links.push({
            id: linkId,
            source: entry.subjectId,
            target: entry.objectId,
            label: entry.verb.replace("_", " "),
          })
        }
      }

      setLedgerNodes(nodes)
      setLedgerLinks(links)
      setIsLedgerLoading(false)
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to fetch ledger entries:", err)
          setLedgerNodes([])
          setLedgerLinks([])
          setIsLedgerLoading(false)
        }
      }
    }

    fetchLedger()
    return () => { cancelled = true }
  }, [isLedgerMode, ledgerFilter?.subjectId, ledgerFilter?.verb, ledgerFilter?.objectId, ledgerFilter?.startDate, ledgerFilter?.endDate])

  // Type filter state
  const [visibleTypes, setVisibleTypes] = useState<Set<NodeType>>(
    new Set(Object.values(NODE_TYPE))
  )

  const toggleType = useCallback((type: NodeType) => {
    setVisibleTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) {
        if (next.size > 1) next.delete(type) // always keep at least one
      } else {
        next.add(type)
      }
      return next
    })
  }, [])

  // Data from hooks
  const { data: feedData, state: feedState } = useHomeFeed(100, selectedChapter)
  const { posts, state: postsState } = usePosts(100, selectedChapter)

  const isLoading = feedState === "loading" || postsState === "loading" || isLedgerLoading

  // Navigation state for click-to-center drill-down
  const [navStack, setNavStack] = useState<NavigationEntry[]>([
    { centerId: null, label: "Overview" },
  ])
  const [expandedNodes, setExpandedNodes] = useState<Map<string, GraphNode[]>>(new Map())
  const [expandedLinks, setExpandedLinks] = useState<Map<string, GraphLink[]>>(new Map())
  const [isExpanding, setIsExpanding] = useState(false)

  const currentCenter = navStack[navStack.length - 1]?.centerId ?? null

  // ─── Build initial node/link data from feed ─────────────────────────────

  const { baseNodes, baseLinks } = useMemo(() => {
    const nodes: GraphNode[] = []
    const links: GraphLink[] = []
    const nodeIds = new Set<string>()

    // People
    for (const person of feedData.people) {
      if (nodeIds.has(person.id)) continue
      nodeIds.add(person.id)
      nodes.push({
        id: person.id,
        label: person.name || person.username || "Unknown",
        type: NODE_TYPE.PERSON,
        href: person.profileHref || `/people/${person.id}`,
      })
    }

    // Groups
    for (const group of feedData.groups) {
      if (nodeIds.has(group.id)) continue
      nodeIds.add(group.id)
      nodes.push({
        id: group.id,
        label: group.name || "Unknown Group",
        type: NODE_TYPE.GROUP,
        href: `/groups/${group.id}`,
      })
    }

    // Events
    for (const event of feedData.events) {
      if (nodeIds.has(event.id)) continue
      nodeIds.add(event.id)
      nodes.push({
        id: event.id,
        label: event.name || event.title || "Unknown Event",
        type: NODE_TYPE.EVENT,
        href: `/events/${event.id}`,
      })
    }

    // Posts
    for (const post of posts) {
      if (nodeIds.has(post.id)) continue
      nodeIds.add(post.id)
      nodes.push({
        id: post.id,
        label: post.title || post.content?.slice(0, 30) || "Post",
        type: NODE_TYPE.POST,
        href: `/posts/${post.id}`,
      })

      // Link post to author if author exists in nodes
      if (post.author?.id && nodeIds.has(post.author.id)) {
        const linkId = makeLinkId(post.id, post.author.id)
        links.push({ id: linkId, source: post.id, target: post.author.id, label: "authored" })
      }
    }

    // Marketplace/Offerings
    for (const listing of feedData.marketplace) {
      if (nodeIds.has(listing.id)) continue
      nodeIds.add(listing.id)
      nodes.push({
        id: listing.id,
        label: listing.title || "Offering",
        type: NODE_TYPE.OFFERING,
        href: `/marketplace/${listing.id}`,
      })

      // Link offering to seller if seller exists
      if (listing.seller?.id && nodeIds.has(listing.seller.id)) {
        const linkId = makeLinkId(listing.id, listing.seller.id)
        links.push({ id: linkId, source: listing.id, target: listing.seller.id, label: "offers" })
      }
    }

    return { baseNodes: nodes, baseLinks: links }
  }, [feedData, posts])

  // ─── Fetch ledger relationships (admin/member/owner) between base nodes ──

  const [relationshipLinks, setRelationshipLinks] = useState<GraphLink[]>([])

  // Stable fingerprint of base node IDs to prevent re-fetching on hook reference changes
  const baseNodeFingerprint = useMemo(
    () => baseNodes.map((n) => n.id).sort().join(","),
    [baseNodes]
  )
  const lastFetchedFingerprint = useRef("")

  useEffect(() => {
    if (baseNodes.length === 0) return
    // Only re-fetch if the node set actually changed
    if (lastFetchedFingerprint.current === baseNodeFingerprint) return
    lastFetchedFingerprint.current = baseNodeFingerprint
    let cancelled = false

    const personIds = baseNodes.filter((n) => n.type === NODE_TYPE.PERSON).map((n) => n.id)
    const groupIds = baseNodes.filter((n) => n.type === NODE_TYPE.GROUP).map((n) => n.id)
    if (personIds.length === 0 || groupIds.length === 0) return

    // Query ledger for membership verbs between people and groups.
    // Query per person (scoped) rather than globally to avoid missing entries.
    const nodeIds = new Set(baseNodes.map((n) => n.id))
    const links: GraphLink[] = []
    const seen = new Set<string>()

    const membershipVerbs = ["join", "manage", "own", "belong"]

    // Fetch relationships for each person in the graph
    const personNodes = baseNodes.filter((n) => n.type === NODE_TYPE.PERSON)
    Promise.all(
      personNodes.map((person) =>
        Promise.all(
          membershipVerbs.map((verb) =>
            queryLedgerEntries({ subjectId: person.id, verb }, 50).catch(() => [])
          )
        ).then((results) => results.flat())
      )
    ).then((allResults) => {
      if (cancelled) return
      for (const entry of allResults.flat()) {
        if (!entry.objectId || !nodeIds.has(entry.objectId)) continue
        const key = `${entry.subjectId}-${entry.objectId}`
        if (seen.has(key)) continue
        seen.add(key)
        links.push({
          id: makeLinkId(entry.subjectId, entry.objectId),
          source: entry.subjectId,
          target: entry.objectId,
          label: entry.verb.replace("_", " "),
        })
      }
      setRelationshipLinks(links)
      /* loaded */
    }).catch(() => {
      if (!cancelled) { setRelationshipLinks([]) }
    })

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- baseNodeFingerprint is stable identity
  }, [baseNodeFingerprint])

  // ─── Merge base + expanded data ──────────────────────────────────────────

  const { allNodes, allLinks } = useMemo(() => {
    const nodeMap = new Map<string, GraphNode>()
    for (const n of baseNodes) nodeMap.set(n.id, n)
    for (const [, extraNodes] of expandedNodes) {
      for (const n of extraNodes) {
        if (!nodeMap.has(n.id)) nodeMap.set(n.id, n)
      }
    }

    const linkMap = new Map<string, GraphLink>()
    for (const l of baseLinks) linkMap.set(l.id, l)
    for (const l of relationshipLinks) { if (!linkMap.has(l.id)) linkMap.set(l.id, l) }
    for (const [, extraLinks] of expandedLinks) {
      for (const l of extraLinks) {
        if (!linkMap.has(l.id)) linkMap.set(l.id, l)
      }
    }

    // Filter links to only include those where both endpoints exist
    const nodeIds = new Set(nodeMap.keys())
    const validLinks = Array.from(linkMap.values()).filter((l) => {
      const sId = typeof l.source === "object" ? (l.source as GraphNode).id : l.source
      const tId = typeof l.target === "object" ? (l.target as GraphNode).id : l.target
      return nodeIds.has(sId as string) && nodeIds.has(tId as string)
    })

    return { allNodes: Array.from(nodeMap.values()), allLinks: validLinks }
  }, [baseNodes, baseLinks, relationshipLinks, expandedNodes, expandedLinks])

  // Apply search + type filters — switch data source based on ledger mode
  const { filteredNodes, filteredLinks } = useMemo(() => {
    const sourceNodes = isLedgerMode ? ledgerNodes : allNodes
    const sourceLinks = isLedgerMode ? ledgerLinks : allLinks

    const q = searchQuery.toLowerCase()
    const filtered = sourceNodes.filter((n) => {
      if (!visibleTypes.has(n.type)) return false
      if (q && !n.label.toLowerCase().includes(q)) return false
      return true
    })
    const nodeIds = new Set(filtered.map((n) => n.id))
    const links = sourceLinks.filter((l) => {
      const sId = typeof l.source === "object" ? (l.source as GraphNode).id : l.source
      const tId = typeof l.target === "object" ? (l.target as GraphNode).id : l.target
      return nodeIds.has(sId as string) && nodeIds.has(tId as string)
    })
    return { filteredNodes: filtered, filteredLinks: links }
  }, [allNodes, allLinks, ledgerNodes, ledgerLinks, isLedgerMode, visibleTypes, searchQuery])

  // Stable fingerprint so the D3 effect only re-runs when actual data changes,
  // not on every hook re-render that produces the same node set.
  // Only use node IDs for the fingerprint — link changes (e.g. relationship
  // loading) should update existing graph data, not trigger a full rebuild.
  const graphFingerprint = useMemo(
    () => filteredNodes.map((n) => n.id).sort().join(","),
    [filteredNodes]
  )

  // ─── Fetch connections on node click ─────────────────────────────────────

  const expandNode = useCallback(
    async (node: GraphNode) => {
      if (expandedNodes.has(node.id)) {
        // Already expanded — just navigate
        setNavStack((prev) => [...prev, { centerId: node.id, label: node.label }])
        return
      }

      setIsExpanding(true)
      const newNodes: GraphNode[] = []
      const newLinks: GraphLink[] = []
      const existingIds = new Set(allNodes.map((n) => n.id))

      try {
        if (node.type === NODE_TYPE.GROUP) {
          const detail = await fetchGroupDetail(node.id)
          if (detail) {
            // Members
            for (const member of detail.members) {
              const user = agentToUser(member)
              if (!existingIds.has(user.id)) {
                existingIds.add(user.id)
                newNodes.push({
                  id: user.id,
                  label: user.name || user.username || "Unknown",
                  type: NODE_TYPE.PERSON,
                  href: user.profileHref || `/people/${user.id}`,
                })
              }
              newLinks.push({
                id: makeLinkId(node.id, user.id),
                source: node.id,
                target: user.id,
                label: "member",
              })
            }

            // Subgroups
            for (const sub of detail.subgroups) {
              const group = agentToGroup(sub)
              if (!existingIds.has(group.id)) {
                existingIds.add(group.id)
                newNodes.push({
                  id: group.id,
                  label: group.name || "Subgroup",
                  type: NODE_TYPE.GROUP,
                  href: `/groups/${group.id}`,
                })
              }
              newLinks.push({
                id: makeLinkId(node.id, group.id),
                source: node.id,
                target: group.id,
                label: "contains",
              })
            }

            // Events
            for (const evt of detail.events) {
              const event = agentToEvent(evt)
              if (!existingIds.has(event.id)) {
                existingIds.add(event.id)
                newNodes.push({
                  id: event.id,
                  label: event.name || event.title || "Event",
                  type: NODE_TYPE.EVENT,
                  href: `/events/${event.id}`,
                })
              }
              newLinks.push({
                id: makeLinkId(node.id, event.id),
                source: node.id,
                target: event.id,
                label: "hosts",
              })
            }

            // Resources → posts/offerings
            for (const res of detail.resources) {
              const meta = (res.metadata ?? {}) as Record<string, unknown>
              const entityType = String(meta.entityType ?? res.type ?? "")
              if (entityType === "post" || res.type === "post" || res.type === "note") {
                const post = resourceToPost(res)
                if (!existingIds.has(post.id)) {
                  existingIds.add(post.id)
                  newNodes.push({
                    id: post.id,
                    label: post.title || post.content?.slice(0, 30) || "Post",
                    type: NODE_TYPE.POST,
                    href: `/posts/${post.id}`,
                  })
                }
                newLinks.push({
                  id: makeLinkId(node.id, post.id),
                  source: node.id,
                  target: post.id,
                  label: "posted",
                })
              } else if (meta.listingType) {
                const listing = resourceToMarketplaceListing(res)
                if (!existingIds.has(listing.id)) {
                  existingIds.add(listing.id)
                  newNodes.push({
                    id: listing.id,
                    label: listing.title || "Offering",
                    type: NODE_TYPE.OFFERING,
                    href: `/marketplace/${listing.id}`,
                  })
                }
                newLinks.push({
                  id: makeLinkId(node.id, listing.id),
                  source: node.id,
                  target: listing.id,
                  label: "offers",
                })
              }
            }
          }
        } else if (node.type === NODE_TYPE.PERSON) {
          const profile = await fetchProfileData(node.id)
          if (profile) {
            // Resources owned by person
            for (const res of profile.resources) {
              const meta = (res.metadata ?? {}) as Record<string, unknown>
              const entityType = String(meta.entityType ?? res.type ?? "")
              if (entityType === "post" || res.type === "post" || res.type === "note") {
                const post = resourceToPost(res)
                if (!existingIds.has(post.id)) {
                  existingIds.add(post.id)
                  newNodes.push({
                    id: post.id,
                    label: post.title || post.content?.slice(0, 30) || "Post",
                    type: NODE_TYPE.POST,
                    href: `/posts/${post.id}`,
                  })
                }
                newLinks.push({
                  id: makeLinkId(node.id, post.id),
                  source: node.id,
                  target: post.id,
                  label: "posted",
                })
              } else if (meta.listingType) {
                const listing = resourceToMarketplaceListing(res)
                if (!existingIds.has(listing.id)) {
                  existingIds.add(listing.id)
                  newNodes.push({
                    id: listing.id,
                    label: listing.title || "Offering",
                    type: NODE_TYPE.OFFERING,
                    href: `/marketplace/${listing.id}`,
                  })
                }
                newLinks.push({
                  id: makeLinkId(node.id, listing.id),
                  source: node.id,
                  target: listing.id,
                  label: "offers",
                })
              }
            }

            // Recent activity — connect to referenced objects already in graph
            for (const activity of profile.recentActivity) {
              if (activity.objectId && existingIds.has(activity.objectId)) {
                newLinks.push({
                  id: makeLinkId(node.id, activity.objectId),
                  source: node.id,
                  target: activity.objectId,
                  label: activity.verb || "related",
                })
              }
            }
          }
        } else if (node.type === NODE_TYPE.POST || node.type === NODE_TYPE.OFFERING) {
          // For posts/offerings, find the owner and link back
          const resources = await fetchResourcesByOwner(node.id).catch(() => [])
          // Also check if this resource's owner is already in graph
          const matchingPost = posts.find((p) => p.id === node.id)
          if (matchingPost?.author?.id && existingIds.has(matchingPost.author.id)) {
            newLinks.push({
              id: makeLinkId(node.id, matchingPost.author.id),
              source: node.id,
              target: matchingPost.author.id,
              label: "authored",
            })
          }
          const matchingListing = feedData.marketplace.find((l) => l.id === node.id)
          if (matchingListing?.seller?.id && existingIds.has(matchingListing.seller.id)) {
            newLinks.push({
              id: makeLinkId(node.id, matchingListing.seller.id),
              source: node.id,
              target: matchingListing.seller.id,
              label: "sells",
            })
          }
        }
      } catch (err) {
        console.error("[ExploreGraphCanvas] Failed to expand node:", err)
      }

      setExpandedNodes((prev) => new Map(prev).set(node.id, newNodes))
      setExpandedLinks((prev) => new Map(prev).set(node.id, newLinks))
      setNavStack((prev) => [...prev, { centerId: node.id, label: node.label }])
      setIsExpanding(false)
    },
    [allNodes, expandedNodes, posts, feedData.marketplace]
  )

  // Keep ref in sync so D3 click handler always calls latest version
  expandNodeRef.current = expandNode

  // ─── Navigation handlers ─────────────────────────────────────────────────

  const handleBack = useCallback(() => {
    setFocusedNodeId(null)
    setNavStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))
  }, [])

  const handleReset = useCallback(() => {
    setFocusedNodeId(null)
    setNavStack([{ centerId: null, label: "Overview" }])
    setExpandedNodes(new Map())
    setExpandedLinks(new Map())
  }, [])

  // ─── D3 SVG Rendering ────────────────────────────────────────────────────

  const graphBuiltRef = useRef(false)

  useEffect(() => {
    const svg = svgRef.current
    const container = containerRef.current
    if (!svg || !container || filteredNodes.length === 0) return
    // Only build the graph ONCE. Never rebuild on data changes.
    if (graphBuiltRef.current) return
    graphBuiltRef.current = true

    const width = container.clientWidth
    const height = container.clientHeight || 400

    // Clear previous render
    select(svg).selectAll("*").remove()

    const svgSel = select(svg)
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", `0 0 ${width} ${height}`)
      .style("background", "#003333")

    // Root group for zoom/pan
    const g = svgSel.append("g")

    // Zoom behavior
    const zoom = d3Zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform)
      })

    svgSel.call(zoom)

    // Deep-clone nodes so D3 mutation does not corrupt React state
    const simNodes: GraphNode[] = filteredNodes.map((n) => ({ ...n }))
    const simLinks: GraphLink[] = filteredLinks.map((l) => ({
      ...l,
      source: typeof l.source === "object" ? (l.source as GraphNode).id : l.source,
      target: typeof l.target === "object" ? (l.target as GraphNode).id : l.target,
    }))

    // Pin center node to canvas center
    if (currentCenter) {
      const centerNode = simNodes.find((n) => n.id === currentCenter)
      if (centerNode) {
        centerNode.fx = width / 2
        centerNode.fy = height / 2
        centerNode.pinned = true
      }
    }

    // Force simulation
    const simulation = forceSimulation(simNodes)
      .force(
        "link",
        forceLink<GraphNode, GraphLink>(simLinks)
          .id((d) => d.id)
          .distance(FORCE_LINK_DISTANCE)
      )
      .force("charge", forceManyBody().strength(FORCE_CHARGE_STRENGTH).distanceMax(300))
      .force("center", forceCenter(width / 2, height / 2).strength(0.1))
      .force("x", forceX(width / 2).strength(0.05))
      .force("y", forceY(height / 2).strength(0.05))
      .force(
        "collision",
        forceCollide<GraphNode>().radius((d) => NODE_RADII[d.type] + FORCE_COLLISION_PADDING)
      )
      .velocityDecay(SIMULATION_VELOCITY_DECAY)
      .alphaDecay(0.05)
      .alphaTarget(SIMULATION_ALPHA_TARGET)

    // Store refs for constellation focus effect
    simulationRef.current = simulation
    simNodesRef.current = simNodes

    // Links — visible with color-coded strokes
    const link = g
      .append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(simLinks)
      .join("line")
      .attr("stroke", (d) => {
        // Color edges by source node type
        const sourceNode = simNodes.find((n) => n.id === (typeof d.source === "object" ? (d.source as GraphNode).id : d.source))
        return sourceNode ? NODE_COLORS[sourceNode.type] : "currentColor"
      })
      .attr("stroke-opacity", 0.35)
      .attr("stroke-width", 2)

    // Edge labels — always show the label if present, show relationship type for all edges
    const edgeLabels = g
      .append("g")
      .attr("class", "edge-labels")
      .selectAll("text")
      .data(simLinks)
      .join("text")
      .text((d) => d.label ?? "")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("fill", "currentColor")
      .attr("font-size", "9px")
      .attr("font-weight", "500")
      .attr("opacity", 0.5)
      .attr("pointer-events", "none")
      .style("text-shadow", "0 1px 2px rgba(0,0,0,0.8)")

    // Node groups
    const nodeGroup = g
      .append("g")
      .attr("class", "nodes")
      .selectAll<SVGGElement, GraphNode>("g")
      .data(simNodes)
      .join("g")
      .attr("cursor", "pointer")
      .call(
        d3Drag<SVGGElement, GraphNode>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.1).restart()
            d.fx = d.x
            d.fy = d.y
          })
          .on("drag", (event, d) => {
            d.fx = event.x
            d.fy = event.y
            // Immediately update position for responsive feel
            select(event.sourceEvent.target.closest("g")).attr("transform", `translate(${event.x},${event.y})`)
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0)
            // Keep node pinned where dropped
            d.fx = d.x
            d.fy = d.y
          })
      )

    // Click handler — constellation focus with chain navigation
    nodeGroup.on("click", (event, d) => {
      event.stopPropagation()
      setFocusedNodeId((prev) => {
        if (prev === d.id) {
          // Second click on same focused node — expand/navigate
          expandNodeRef.current(d)
          return null
        }
        // Click on any node (new focus or chain navigation from connected node)
        // Pin the clicked node to canvas center and let simulation rearrange
        for (const n of simNodes) {
          if (n.id === d.id) {
            n.fx = width / 2
            n.fy = height / 2
          } else if (!n.pinned) {
            // Unpin non-center nodes so they can rearrange
            n.fx = null
            n.fy = null
          }
        }
        // Restart simulation briefly so connected nodes orbit the new center
        simulation.alpha(0.4).restart()

        // Smooth zoom to center the focused node
        const scale = 1.5
        const transform = zoomIdentity
          .translate(width / 2, height / 2)
          .scale(scale)
          .translate(-width / 2, -height / 2)
        svgSel.transition().duration(500).call(zoom.transform, transform)
        return d.id
      })
    })

    // Background click — clear focus, unpin all, and reset zoom
    svgSel.on("click", (event) => {
      if (event.target === svg) {
        setFocusedNodeId(null)
        // Unpin all non-center nodes
        for (const n of simNodes) {
          if (!n.pinned) {
            n.fx = null
            n.fy = null
          }
        }
        simulation.alpha(0.3).restart()
        svgSel.transition().duration(400).call(zoom.transform, zoomIdentity)
      }
    })

    // Draw node shapes
    nodeGroup.each(function (d) {
      const el = select(this)
      const r = NODE_RADII[d.type]
      const color = NODE_COLORS[d.type]
      const isCentered = d.id === currentCenter

      if (d.type === NODE_TYPE.GROUP) {
        // Rounded rectangle
        const w = r * 2
        const h = r * 1.6
        el.append("rect")
          .attr("x", -w / 2)
          .attr("y", -h / 2)
          .attr("width", w)
          .attr("height", h)
          .attr("rx", 6)
          .attr("ry", 6)
          .attr("fill", color)
          .attr("fill-opacity", 0.85)
          .attr("stroke", isCentered ? "#fff" : color)
          .attr("stroke-width", isCentered ? 3 : 1.5)
          .attr("stroke-opacity", isCentered ? 1 : 0.5)
      } else if (d.type === NODE_TYPE.EVENT) {
        // Diamond
        const pts = [
          [0, -r],
          [r, 0],
          [0, r],
          [-r, 0],
        ]
          .map(([px, py]) => `${px},${py}`)
          .join(" ")
        el.append("polygon")
          .attr("points", pts)
          .attr("fill", color)
          .attr("fill-opacity", 0.85)
          .attr("stroke", isCentered ? "#fff" : color)
          .attr("stroke-width", isCentered ? 3 : 1.5)
          .attr("stroke-opacity", isCentered ? 1 : 0.5)
      } else {
        // Circle (person, post, offering)
        el.append("circle")
          .attr("r", r)
          .attr("fill", color)
          .attr("fill-opacity", 0.85)
          .attr("stroke", isCentered ? "#fff" : color)
          .attr("stroke-width", isCentered ? 3 : 1.5)
          .attr("stroke-opacity", isCentered ? 1 : 0.5)
      }

      // Label
      el.append("text")
        .text(truncateLabel(d.label))
        .attr("text-anchor", "middle")
        .attr("dy", r + 14)
        .attr("fill", "currentColor")
        .attr("font-size", d.type === NODE_TYPE.POST ? "10px" : "11px")
        .attr("font-weight", isCentered ? "600" : "400")
        .attr("pointer-events", "none")
        .style("text-shadow", "0 1px 3px rgba(0,0,0,0.3)")

      // Inline SVG icon inside node (white lineal/outline style)
      const iconScale = r * 0.04
      const iconG = el.append("g")
        .attr("fill", "none")
        .attr("stroke", "white")
        .attr("stroke-width", 1.5)
        .attr("stroke-linecap", "round")
        .attr("stroke-linejoin", "round")
        .attr("pointer-events", "none")
        .attr("transform", `scale(${iconScale})`)

      if (d.type === NODE_TYPE.PERSON) {
        // Person silhouette: circle head + shoulders arc
        iconG.append("circle").attr("cx", 0).attr("cy", -5).attr("r", 5)
        iconG.append("path").attr("d", "M-10 12 C-10 4 10 4 10 12")
      } else if (d.type === NODE_TYPE.GROUP) {
        // Two overlapping person silhouettes
        iconG.append("circle").attr("cx", -4).attr("cy", -5).attr("r", 4)
        iconG.append("path").attr("d", "M-12 10 C-12 4 4 4 4 10")
        iconG.append("circle").attr("cx", 5).attr("cy", -5).attr("r", 4)
        iconG.append("path").attr("d", "M-3 10 C-3 4 13 4 13 10")
      } else if (d.type === NODE_TYPE.EVENT) {
        // Calendar: rectangle with two hanging tabs
        iconG.append("rect").attr("x", -8).attr("y", -5).attr("width", 16).attr("height", 14).attr("rx", 2)
        iconG.append("line").attr("x1", -4).attr("y1", -8).attr("x2", -4).attr("y2", -3)
        iconG.append("line").attr("x1", 4).attr("y1", -8).attr("x2", 4).attr("y2", -3)
        iconG.append("line").attr("x1", -8).attr("y1", 0).attr("x2", 8).attr("y2", 0)
      } else if (d.type === NODE_TYPE.POST) {
        // Document: rectangle with lines
        iconG.append("rect").attr("x", -7).attr("y", -9).attr("width", 14).attr("height", 18).attr("rx", 2)
        iconG.append("line").attr("x1", -3).attr("y1", -3).attr("x2", 3).attr("y2", -3)
        iconG.append("line").attr("x1", -3).attr("y1", 1).attr("x2", 3).attr("y2", 1)
        iconG.append("line").attr("x1", -3).attr("y1", 5).attr("x2", 1).attr("y2", 5)
      } else if (d.type === NODE_TYPE.OFFERING) {
        // Price tag shape
        iconG.append("path").attr("d", "M-8 -2 L0 -10 L8 -2 L8 8 L-8 8 Z")
        iconG.append("circle").attr("cx", 0).attr("cy", -4).attr("r", 2)
      }
    })

    // Hover effects
    nodeGroup
      .on("mouseenter", function (_, d) {
        // Highlight node
        select(this).select("circle, rect, polygon")
          .attr("fill-opacity", 1)
          .attr("stroke", "#fff")
          .attr("stroke-width", 3)
        // Highlight connected edges
        link.attr("stroke-opacity", (l) => {
          const sId = typeof l.source === "object" ? (l.source as GraphNode).id : l.source
          const tId = typeof l.target === "object" ? (l.target as GraphNode).id : l.target
          return sId === d.id || tId === d.id ? 0.8 : 0.1
        }).attr("stroke-width", (l) => {
          const sId = typeof l.source === "object" ? (l.source as GraphNode).id : l.source
          const tId = typeof l.target === "object" ? (l.target as GraphNode).id : l.target
          return sId === d.id || tId === d.id ? 3 : 1.5
        })
        // Highlight connected edge labels
        edgeLabels.attr("opacity", (l) => {
          const sId = typeof l.source === "object" ? (l.source as GraphNode).id : l.source
          const tId = typeof l.target === "object" ? (l.target as GraphNode).id : l.target
          return sId === d.id || tId === d.id ? 1 : 0.2
        })
      })
      .on("mouseleave", function () {
        select(this).select("circle, rect, polygon")
          .attr("fill-opacity", 0.85)
          .attr("stroke-width", 1.5)
        // Reset edges
        link.attr("stroke-opacity", 0.35).attr("stroke-width", 2)
        edgeLabels.attr("opacity", 0.5)
      })

    // Tick update
    simulation.on("tick", () => {
      link
        .attr("x1", (d) => ((d.source as GraphNode).x ?? 0))
        .attr("y1", (d) => ((d.source as GraphNode).y ?? 0))
        .attr("x2", (d) => ((d.target as GraphNode).x ?? 0))
        .attr("y2", (d) => ((d.target as GraphNode).y ?? 0))

      // Position edge labels at midpoint of each link
      edgeLabels
        .attr("x", (d) => {
          const sx = (d.source as GraphNode).x ?? 0
          const tx = (d.target as GraphNode).x ?? 0
          return (sx + tx) / 2
        })
        .attr("y", (d) => {
          const sy = (d.source as GraphNode).y ?? 0
          const ty = (d.target as GraphNode).y ?? 0
          return (sy + ty) / 2 - 6
        })

      nodeGroup.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })

    // Animate to center when a node is centered
    if (currentCenter) {
      simulation.alpha(SIMULATION_ALPHA_RESTART).restart()
    }

    return () => {
      simulation.stop()
      simulationRef.current = null
      simNodesRef.current = []
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- graphFingerprint is a stable identity; expandNodeRef avoids re-renders
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphFingerprint])

  // ─── Constellation focus effect ─────────────────────────────────────────
  //
  // When focusedNodeId changes:
  // - The focused node becomes visually prominent (larger, brighter, white ring)
  // - Connected nodes are at full opacity, slightly enlarged
  // - Unconnected nodes are nearly invisible (opacity 0.05)
  // - Connected edge labels are fully visible
  // - Creates a "constellation" effect around the focused star

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return

    const svgSel = select(svg)

    if (!focusedNodeId) {
      // Reset all visual changes
      svgSel.selectAll<SVGGElement, GraphNode>(".nodes g")
        .transition().duration(300)
        .attr("opacity", 1)
        .attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)
      svgSel.selectAll(".nodes g").select("circle, rect, polygon")
        .transition().duration(300)
        .attr("stroke", function () {
          return select(this).attr("fill") ?? "currentColor"
        })
        .attr("stroke-width", 1.5)
        .attr("stroke-opacity", 0.5)
      svgSel.selectAll(".links line")
        .transition().duration(300)
        .attr("opacity", null)
        .attr("stroke-width", 2)
      svgSel.selectAll(".edge-labels text")
        .transition().duration(300)
        .attr("opacity", 0.5)
      return
    }

    // Compute connected node IDs from current links
    const connectedIds = new Set<string>()
    connectedIds.add(focusedNodeId)

    svgSel.selectAll<SVGLineElement, GraphLink>(".links line").each(function (d) {
      const sId = typeof d.source === "object" ? (d.source as GraphNode).id : (d.source as string)
      const tId = typeof d.target === "object" ? (d.target as GraphNode).id : (d.target as string)
      if (sId === focusedNodeId) connectedIds.add(tId)
      if (tId === focusedNodeId) connectedIds.add(sId)
    })

    // Constellation node styling: focused = star, connected = bright, rest = nearly invisible
    svgSel.selectAll<SVGGElement, GraphNode>(".nodes g")
      .transition().duration(400)
      .attr("opacity", (d) => {
        if (d.id === focusedNodeId) return 1
        if (connectedIds.has(d.id)) return 1
        return 0.05
      })

    // Focused node: white ring border, enlarged shape
    svgSel.selectAll<SVGGElement, GraphNode>(".nodes g").each(function (d) {
      const shape = select(this).select("circle, rect, polygon")
      if (d.id === focusedNodeId) {
        shape
          .transition().duration(400)
          .attr("stroke", "#fff")
          .attr("stroke-width", 4)
          .attr("stroke-opacity", 1)
          .attr("fill-opacity", 1)
      } else if (connectedIds.has(d.id)) {
        shape
          .transition().duration(400)
          .attr("stroke", "#fff")
          .attr("stroke-width", 2)
          .attr("stroke-opacity", 0.6)
          .attr("fill-opacity", 0.95)
      } else {
        shape
          .transition().duration(400)
          .attr("stroke-width", 1)
          .attr("stroke-opacity", 0.2)
          .attr("fill-opacity", 0.3)
      }
    })

    // Connected edges bright, unconnected nearly invisible
    svgSel.selectAll<SVGLineElement, GraphLink>(".links line")
      .transition().duration(400)
      .attr("opacity", (d) => {
        const sId = typeof d.source === "object" ? (d.source as GraphNode).id : (d.source as string)
        const tId = typeof d.target === "object" ? (d.target as GraphNode).id : (d.target as string)
        return (sId === focusedNodeId || tId === focusedNodeId) ? 0.6 : 0.02
      })
      .attr("stroke-width", (d) => {
        const sId = typeof d.source === "object" ? (d.source as GraphNode).id : (d.source as string)
        const tId = typeof d.target === "object" ? (d.target as GraphNode).id : (d.target as string)
        return (sId === focusedNodeId || tId === focusedNodeId) ? 3 : 1
      })

    // Connected edge labels fully visible, rest invisible
    svgSel.selectAll<SVGTextElement, GraphLink>(".edge-labels text")
      .transition().duration(400)
      .attr("opacity", (d) => {
        const sId = typeof d.source === "object" ? (d.source as GraphNode).id : (d.source as string)
        const tId = typeof d.target === "object" ? (d.target as GraphNode).id : (d.target as string)
        return (sId === focusedNodeId || tId === focusedNodeId) ? 1 : 0.02
      })
  }, [focusedNodeId])

  // ─── Escape key clears focus ─────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocusedNodeId(null)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  // ─── Resize handling ──────────────────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current
    const svg = svgRef.current
    if (!container || !svg) return

    const observer = new ResizeObserver(() => {
      const w = container.clientWidth
      const h = container.clientHeight || 400
      select(svg).attr("width", w).attr("height", h).attr("viewBox", `0 0 ${w} ${h}`)
    })

    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // ─── Legend ───────────────────────────────────────────────────────────────

  const legendItems: { type: NodeType; label: string }[] = [
    { type: NODE_TYPE.PERSON, label: "People" },
    { type: NODE_TYPE.GROUP, label: "Groups" },
    { type: NODE_TYPE.EVENT, label: "Events" },
    { type: NODE_TYPE.POST, label: "Posts" },
    { type: NODE_TYPE.OFFERING, label: "Offerings" },
  ]

  // ─── Render ───────────────────────────────────────────────────────────────

  if (isLoading && filteredNodes.length === 0) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        Loading graph data...
      </div>
    )
  }

  if (filteredNodes.length === 0) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        No data available for this locale.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Navigation bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {navStack.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBack}
              disabled={isExpanding}
              className="gap-1"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </Button>
          )}

          {/* Breadcrumb */}
          <nav className="flex items-center gap-1 text-sm text-muted-foreground">
            {navStack.map((entry, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span>/</span>}
                <span
                  className={
                    i === navStack.length - 1
                      ? "font-medium text-foreground"
                      : "cursor-pointer hover:text-foreground transition-colors"
                  }
                  onClick={() => {
                    if (i < navStack.length - 1) {
                      setNavStack((prev) => prev.slice(0, i + 1))
                    }
                  }}
                >
                  {entry.label}
                </span>
              </span>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {isExpanding && (
            <span className="text-xs text-muted-foreground animate-pulse">
              Loading connections...
            </span>
          )}
          {navStack.length > 1 && (
            <Button variant="outline" size="sm" onClick={handleReset} className="gap-1">
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* Type filters */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        {legendItems.map((item) => {
          const active = visibleTypes.has(item.type)
          return (
            <button
              key={item.type}
              type="button"
              onClick={() => toggleType(item.type)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 border transition-colors ${
                active
                  ? "border-current text-foreground"
                  : "border-muted text-muted-foreground/40 line-through"
              }`}
              style={active ? { borderColor: NODE_COLORS[item.type], color: NODE_COLORS[item.type] } : undefined}
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: active ? NODE_COLORS[item.type] : "currentColor" }}
              />
              <span>{item.label}</span>
            </button>
          )
        })}
        <span className="ml-auto text-muted-foreground/60">
          {filteredNodes.length} nodes &middot; {filteredLinks.length} connections
        </span>
      </div>

      {/* Graph canvas */}
      <div
        ref={containerRef}
        className="relative w-full rounded-lg border bg-background overflow-hidden"
        style={{ height: 400 }}
      >
        <svg
          ref={svgRef}
          className="w-full text-foreground"
          style={{ height: 400 }}
        />
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Click a node to explore its connections. Drag to rearrange. Scroll to zoom.
      </p>
    </div>
  )
}
