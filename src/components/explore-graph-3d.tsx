"use client"

/**
 * 3D Force-directed graph canvas for the Explore page.
 *
 * Renders the same knowledge graph as the 2D SVG version but using Three.js
 * via the `3d-force-graph` library. Supports orbit controls, click-to-focus,
 * double-click-to-expand, type filtering, ledger mode, and navigation stack.
 *
 * MUST be loaded with `dynamic({ ssr: false })` because Three.js/WebGL
 * cannot run server-side.
 */

import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import type { ForceGraph3DInstance } from "3d-force-graph"
import type { NodeObject, LinkObject } from "3d-force-graph"
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
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

const NODE_TYPE = {
  PERSON: "person",
  GROUP: "group",
  EVENT: "event",
  POST: "post",
  OFFERING: "offering",
} as const

type NodeType = (typeof NODE_TYPE)[keyof typeof NODE_TYPE]

const NODE_COLORS: Record<NodeType, string> = GRAPH_CATEGORY_COLORS
const NODE_RADII: Record<NodeType, number> = GRAPH_CATEGORY_RADII

const MAX_LABEL_LENGTH = 18

/** Scale factor to convert SVG radii into 3D nodeVal units. */
const NODE_VAL_SCALE = 0.8

/** Background color for the 3D scene. */
const SCENE_BG_COLOR = "#003333"

/** Force simulation parameters. */
const FORCE_CHARGE_STRENGTH = -250
const FORCE_LINK_DISTANCE = 60

/** Camera fly-to duration in ms. */
const CAMERA_FLY_DURATION = 800

/** Warmup/cooldown ticks to prevent infinite simulation. */
const WARMUP_TICKS = 50
const COOLDOWN_TICKS = 200

// ─── Types ──────────────────────────────────────────────────────────────────

interface GraphNode {
  id: string
  label: string
  type: NodeType
  href: string
  modelUrl?: string
  pinned?: boolean
  // d3 simulation fields added at runtime
  x?: number
  y?: number
  z?: number
  fx?: number
  fy?: number
  fz?: number
}

interface GraphLink {
  id: string
  source: string | GraphNode
  target: string | GraphNode
  label?: string
}

interface NavigationEntry {
  centerId: string | null
  label: string
}

// ─── Component Props ────────────────────────────────────────────────────────

interface ExploreGraph3DProps {
  selectedChapter: string
  searchQuery?: string
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

function getNodeId(node: string | GraphNode): string {
  return typeof node === "object" ? node.id : node
}

// ─── Main Component ─────────────────────────────────────────────────────────

/** Cache for loaded GLB models keyed by URL to avoid redundant fetches. */
const glbCache = new Map<string, THREE.Group>()
const glbLoader = new GLTFLoader()

export function ExploreGraph3D({ selectedChapter, searchQuery = "", ledgerFilter }: ExploreGraph3DProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<ForceGraph3DInstance | null>(null)
  const expandNodeRef = useRef<(node: GraphNode) => void>(() => {})
  const graphBuiltRef = useRef(false)

  // Focus state: when a node is clicked, dim unrelated nodes/edges
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)
  const focusedNodeIdRef = useRef<string | null>(null)

  // Keep ref in sync for use inside 3d-force-graph callbacks
  useEffect(() => {
    focusedNodeIdRef.current = focusedNodeId
  }, [focusedNodeId])

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
        if (!nodeIds.has(entry.subjectId)) {
          nodeIds.add(entry.subjectId)
          nodes.push({
            id: entry.subjectId,
            label: entry.subjectName,
            type: typeMap[entry.subjectType] ?? NODE_TYPE.PERSON,
            href: entry.subjectType === "person" ? `/people/${entry.subjectId}` : `/groups/${entry.subjectId}`,
          })
        }

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

        if (entry.objectId) {
          links.push({
            id: `${entry.id}`,
            source: entry.subjectId,
            target: entry.objectId,
            label: entry.verb.replace("_", " "),
          })
        }
      }

      setLedgerNodes(nodes)
      setLedgerLinks(links)
      setIsLedgerLoading(false)
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
        if (next.size > 1) next.delete(type)
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

  // Navigation state
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

    for (const group of feedData.groups) {
      if (nodeIds.has(group.id)) continue
      nodeIds.add(group.id)
      nodes.push({
        id: group.id,
        label: group.name || "Unknown Group",
        type: NODE_TYPE.GROUP,
        href: `/groups/${group.id}`,
        modelUrl: group.modelUrl,
      })
    }

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

    for (const post of posts) {
      if (nodeIds.has(post.id)) continue
      nodeIds.add(post.id)
      nodes.push({
        id: post.id,
        label: post.title || post.content?.slice(0, 30) || "Post",
        type: NODE_TYPE.POST,
        href: `/posts/${post.id}`,
      })

      if (post.author?.id && nodeIds.has(post.author.id)) {
        const linkId = makeLinkId(post.id, post.author.id)
        links.push({ id: linkId, source: post.id, target: post.author.id })
      }
    }

    for (const listing of feedData.marketplace) {
      if (nodeIds.has(listing.id)) continue
      nodeIds.add(listing.id)
      nodes.push({
        id: listing.id,
        label: listing.title || "Offering",
        type: NODE_TYPE.OFFERING,
        href: `/marketplace/${listing.id}`,
      })

      if (listing.seller?.id && nodeIds.has(listing.seller.id)) {
        const linkId = makeLinkId(listing.id, listing.seller.id)
        links.push({ id: linkId, source: listing.id, target: listing.seller.id })
      }
    }

    return { baseNodes: nodes, baseLinks: links }
  }, [feedData, posts])

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
    for (const [, extraLinks] of expandedLinks) {
      for (const l of extraLinks) {
        if (!linkMap.has(l.id)) linkMap.set(l.id, l)
      }
    }

    const nodeIds = new Set(nodeMap.keys())
    const validLinks = Array.from(linkMap.values()).filter((l) => {
      const sId = getNodeId(l.source)
      const tId = getNodeId(l.target)
      return nodeIds.has(sId) && nodeIds.has(tId)
    })

    return { allNodes: Array.from(nodeMap.values()), allLinks: validLinks }
  }, [baseNodes, baseLinks, expandedNodes, expandedLinks])

  // Apply search + type filters
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
      const sId = getNodeId(l.source)
      const tId = getNodeId(l.target)
      return nodeIds.has(sId) && nodeIds.has(tId)
    })
    return { filteredNodes: filtered, filteredLinks: links }
  }, [allNodes, allLinks, ledgerNodes, ledgerLinks, isLedgerMode, visibleTypes, searchQuery])

  // Stable fingerprint so the graph effect only re-runs when data actually changes
  const graphFingerprint = useMemo(
    () => filteredNodes.map((n) => n.id).sort().join(",") + "|" + filteredLinks.map((l) => l.id).sort().join(","),
    [filteredNodes, filteredLinks]
  )

  // ─── Fetch connections on node click ─────────────────────────────────────

  const expandNode = useCallback(
    async (node: GraphNode) => {
      if (expandedNodes.has(node.id)) {
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
              newLinks.push({ id: makeLinkId(node.id, user.id), source: node.id, target: user.id })
            }
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
              newLinks.push({ id: makeLinkId(node.id, group.id), source: node.id, target: group.id })
            }
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
              newLinks.push({ id: makeLinkId(node.id, event.id), source: node.id, target: event.id })
            }
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
                newLinks.push({ id: makeLinkId(node.id, post.id), source: node.id, target: post.id })
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
                newLinks.push({ id: makeLinkId(node.id, listing.id), source: node.id, target: listing.id })
              }
            }
          }
        } else if (node.type === NODE_TYPE.PERSON) {
          const profile = await fetchProfileData(node.id)
          if (profile) {
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
                newLinks.push({ id: makeLinkId(node.id, post.id), source: node.id, target: post.id })
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
                newLinks.push({ id: makeLinkId(node.id, listing.id), source: node.id, target: listing.id })
              }
            }
            for (const activity of profile.recentActivity) {
              if (activity.objectId && existingIds.has(activity.objectId)) {
                newLinks.push({
                  id: makeLinkId(node.id, activity.objectId),
                  source: node.id,
                  target: activity.objectId,
                })
              }
            }
          }
        } else if (node.type === NODE_TYPE.POST || node.type === NODE_TYPE.OFFERING) {
          await fetchResourcesByOwner(node.id).catch(() => [])
          const matchingPost = posts.find((p) => p.id === node.id)
          if (matchingPost?.author?.id && existingIds.has(matchingPost.author.id)) {
            newLinks.push({
              id: makeLinkId(node.id, matchingPost.author.id),
              source: node.id,
              target: matchingPost.author.id,
            })
          }
          const matchingListing = feedData.marketplace.find((l) => l.id === node.id)
          if (matchingListing?.seller?.id && existingIds.has(matchingListing.seller.id)) {
            newLinks.push({
              id: makeLinkId(node.id, matchingListing.seller.id),
              source: node.id,
              target: matchingListing.seller.id,
            })
          }
        }
      } catch (err) {
        console.error("[ExploreGraph3D] Failed to expand node:", err)
      }

      setExpandedNodes((prev) => new Map(prev).set(node.id, newNodes))
      setExpandedLinks((prev) => new Map(prev).set(node.id, newLinks))
      setNavStack((prev) => [...prev, { centerId: node.id, label: node.label }])
      setIsExpanding(false)
    },
    [allNodes, expandedNodes, posts, feedData.marketplace]
  )

  // Keep ref in sync so graph click handler always calls latest version
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

  // ─── 3D Graph Initialization (once) ──────────────────────────────────────

  const graphInitialized = useRef(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container || filteredNodes.length === 0) return

    // Prevent duplicate builds from React strict-mode double-firing
    if (graphBuiltRef.current && graphRef.current && graphInitialized.current) {
      const simNodes = filteredNodes.map((n) => ({ ...n }))
      const simLinks = filteredLinks.map((l) => ({
        ...l,
        source: typeof l.source === "object" ? (l.source as GraphNode).id : l.source,
        target: typeof l.target === "object" ? (l.target as GraphNode).id : l.target,
      }))
      if (currentCenter) {
        const centerNode = simNodes.find((n) => n.id === currentCenter)
        if (centerNode) { centerNode.fx = 0; centerNode.fy = 0; centerNode.fz = 0 }
      }
      graphRef.current.graphData({ nodes: simNodes, links: simLinks })
      return
    }

    // First-time initialization
    let destroyed = false
    let graphInstance: ForceGraph3DInstance | null = null

    async function init() {
      const ForceGraph3D = (await import("3d-force-graph")).default

      if (destroyed || !container) return

      // Clear any existing content
      container.innerHTML = ""

      const width = container.clientWidth
      const height = Math.max(500, container.clientHeight)

      // Deep-clone nodes/links so 3d-force-graph mutation does not corrupt React state
      const simNodes = filteredNodes.map((n) => ({ ...n }))
      const simLinks = filteredLinks.map((l) => ({
        ...l,
        source: getNodeId(l.source),
        target: getNodeId(l.target),
      }))

      // Build connected-ids lookup for focus mode
      const connectedMap = new Map<string, Set<string>>()
      for (const link of simLinks) {
        const sId = typeof link.source === "string" ? link.source : (link.source as GraphNode).id
        const tId = typeof link.target === "string" ? link.target : (link.target as GraphNode).id
        if (!connectedMap.has(sId)) connectedMap.set(sId, new Set())
        if (!connectedMap.has(tId)) connectedMap.set(tId, new Set())
        connectedMap.get(sId)!.add(tId)
        connectedMap.get(tId)!.add(sId)
      }

      // Track hovered node for glow effect
      let hoveredNodeId: string | null = null

      const graph = new ForceGraph3D(container, {
        controlType: "orbit",
      })

      graphInstance = graph
      graphRef.current = graph
      graphInitialized.current = true
      graphBuiltRef.current = true

      graph
        .width(width)
        .height(height)
        .backgroundColor(SCENE_BG_COLOR)
        .showNavInfo(false)

        // Node styling
        .nodeVal((node: NodeObject) => {
          const n = node as unknown as GraphNode
          return NODE_RADII[n.type] * NODE_VAL_SCALE
        })
        .nodeColor((node: NodeObject) => {
          const n = node as unknown as GraphNode
          const focused = focusedNodeIdRef.current
          if (!focused) return NODE_COLORS[n.type]
          // Focus mode: dim unrelated
          const connected = connectedMap.get(focused) ?? new Set()
          if (n.id === focused || connected.has(n.id)) return NODE_COLORS[n.type]
          return "#222233"
        })
        .nodeOpacity(0.9)
        .nodeResolution(16)
        .nodeLabel((node: NodeObject) => {
          const n = node as unknown as GraphNode
          return `<div style="background:rgba(0,0,0,0.85);color:#fff;padding:4px 10px;border-radius:6px;font-size:12px;pointer-events:none;">
            <strong>${n.label}</strong><br/>
            <span style="color:${NODE_COLORS[n.type]};text-transform:capitalize;">${n.type}</span>
          </div>`
        })

        // Custom 3D node objects with text labels (and GLB models for groups)
        .nodeThreeObject((node: NodeObject) => {
          const n = node as unknown as GraphNode
          const radius = Math.cbrt(NODE_RADII[n.type] * NODE_VAL_SCALE) * 2
          const color = NODE_COLORS[n.type]

          const group = new THREE.Group()

          // ── Build text sprite (shared by all node types) ──
          function createLabelSprite(labelRadius: number): THREE.Sprite {
            const canvas = document.createElement("canvas")
            const ctx = canvas.getContext("2d")!
            const text = truncateLabel(n.label)
            const fontSize = 48
            ctx.font = `${fontSize}px Inter, system-ui, sans-serif`
            const textWidth = ctx.measureText(text).width
            canvas.width = Math.ceil(textWidth) + 20
            canvas.height = fontSize + 16
            ctx.font = `${fontSize}px Inter, system-ui, sans-serif`
            ctx.fillStyle = "#ffffff"
            ctx.textAlign = "center"
            ctx.textBaseline = "middle"
            ctx.fillText(text, canvas.width / 2, canvas.height / 2)

            const texture = new THREE.CanvasTexture(canvas)
            texture.minFilter = THREE.LinearFilter
            const spriteMaterial = new THREE.SpriteMaterial({
              map: texture,
              transparent: true,
              depthWrite: false,
            })
            const sprite = new THREE.Sprite(spriteMaterial)
            const spriteScale = canvas.width / canvas.height
            sprite.scale.set(labelRadius * 3 * spriteScale, labelRadius * 3, 1)
            sprite.position.set(0, labelRadius + labelRadius * 1.8, 0)
            return sprite
          }

          // ── If group node has a GLB model, try to load it ──
          if (n.type === NODE_TYPE.GROUP && n.modelUrl) {
            const cachedModel = glbCache.get(n.modelUrl)
            if (cachedModel) {
              const clone = cachedModel.clone()
              // Scale model to fit node radius
              const box = new THREE.Box3().setFromObject(clone)
              const size = new THREE.Vector3()
              box.getSize(size)
              const maxDim = Math.max(size.x, size.y, size.z) || 1
              const scale = (radius * 2) / maxDim
              clone.scale.setScalar(scale)
              // Center the model
              const center = new THREE.Vector3()
              box.getCenter(center)
              clone.position.sub(center.multiplyScalar(scale))
              group.add(clone)
              group.add(createLabelSprite(radius))
              return group
            }

            // Async load — add a placeholder sphere now, replace once loaded
            const geometry = new THREE.SphereGeometry(radius, 16, 12)
            const material = new THREE.MeshLambertMaterial({
              color: new THREE.Color(color),
              transparent: true,
              opacity: 0.9,
            })
            const placeholder = new THREE.Mesh(geometry, material)
            placeholder.name = "placeholder"
            group.add(placeholder)
            group.add(createLabelSprite(radius))

            // Glow ring
            const glowGeometry = new THREE.RingGeometry(radius * 1.2, radius * 1.6, 32)
            const glowMaterial = new THREE.MeshBasicMaterial({
              color: new THREE.Color(color),
              transparent: true,
              opacity: 0,
              side: THREE.DoubleSide,
            })
            const glowRing = new THREE.Mesh(glowGeometry, glowMaterial)
            glowRing.name = "glow"
            group.add(glowRing)

            glbLoader.load(
              n.modelUrl,
              (gltf) => {
                const model = gltf.scene
                glbCache.set(n.modelUrl!, model.clone())

                const box = new THREE.Box3().setFromObject(model)
                const size = new THREE.Vector3()
                box.getSize(size)
                const maxDim = Math.max(size.x, size.y, size.z) || 1
                const scale = (radius * 2) / maxDim
                model.scale.setScalar(scale)
                const center = new THREE.Vector3()
                box.getCenter(center)
                model.position.sub(center.multiplyScalar(scale))

                // Replace placeholder with loaded model
                const ph = group.getObjectByName("placeholder")
                if (ph) group.remove(ph)
                group.add(model)
              },
              undefined,
              (err) => {
                console.warn("[ExploreGraph3D] Failed to load GLB model:", n.modelUrl, err)
                // Keep the placeholder sphere as fallback
              }
            )

            return group
          }

          // ── Default: sphere node ──
          const geometry = new THREE.SphereGeometry(radius, 16, 12)
          const material = new THREE.MeshLambertMaterial({
            color: new THREE.Color(color),
            transparent: true,
            opacity: 0.9,
          })
          const sphere = new THREE.Mesh(geometry, material)
          group.add(sphere)

          // Glow ring (visible on hover)
          const glowGeometry = new THREE.RingGeometry(radius * 1.2, radius * 1.6, 32)
          const glowMaterial = new THREE.MeshBasicMaterial({
            color: new THREE.Color(color),
            transparent: true,
            opacity: 0,
            side: THREE.DoubleSide,
          })
          const glowRing = new THREE.Mesh(glowGeometry, glowMaterial)
          glowRing.name = "glow"
          group.add(glowRing)

          group.add(createLabelSprite(radius))

          return group
        })
        .nodeThreeObjectExtend(false)

        // Link styling
        .linkColor((link: LinkObject) => {
          const l = link as unknown as GraphLink
          const sId = getNodeId(l.source)
          const focused = focusedNodeIdRef.current
          // Dim unrelated links in focus mode
          if (focused) {
            const tId = getNodeId(l.target)
            if (sId !== focused && tId !== focused) return "rgba(30,30,50,0.15)"
          }
          const sourceNode = simNodes.find((n) => n.id === sId)
          return sourceNode ? NODE_COLORS[sourceNode.type] : "#444466"
        })
        .linkOpacity(0.4)
        .linkWidth(1.5)
        .linkLabel((link: LinkObject) => {
          const l = link as unknown as GraphLink
          return l.label ?? ""
        })
        .linkDirectionalParticles(1)
        .linkDirectionalParticleWidth(1.5)
        .linkDirectionalParticleSpeed(0.005)
        .linkDirectionalParticleColor((link: LinkObject) => {
          const l = link as unknown as GraphLink
          const sId = getNodeId(l.source)
          const sourceNode = simNodes.find((n) => n.id === sId)
          return sourceNode ? NODE_COLORS[sourceNode.type] : "#444466"
        })

        // Interactions
        .onNodeClick((node: NodeObject, event: MouseEvent) => {
          const n = node as unknown as GraphNode
          const currentFocused = focusedNodeIdRef.current

          if (currentFocused === n.id) {
            // Second click on same focused node -- expand/navigate
            expandNodeRef.current(n)
            setFocusedNodeId(null)
            return
          }

          // First click -- focus and fly camera to it
          setFocusedNodeId(n.id)

          // Fly camera to center on this node
          const distance = 120
          const nodePos = { x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 }
          graph.cameraPosition(
            { x: nodePos.x, y: nodePos.y, z: nodePos.z + distance },
            nodePos,
            CAMERA_FLY_DURATION
          )
        })

        .onNodeHover((node: NodeObject | null) => {
          const n = node as unknown as GraphNode | null
          container.style.cursor = n ? "pointer" : "default"

          // Update glow effect
          if (hoveredNodeId) {
            // Remove glow from previous
            const prevObj = graph.scene().getObjectByName?.("glow")
            // Walk all nodes to find and reset glow
            graph.scene().traverse((child: THREE.Object3D) => {
              if (child.name === "glow" && child instanceof THREE.Mesh) {
                const mat = child.material as THREE.MeshBasicMaterial
                mat.opacity = 0
              }
            })
          }

          hoveredNodeId = n?.id ?? null

          if (n) {
            // Find this node's 3D object and enable glow
            const nodeObj = (node as unknown as { __threeObj?: THREE.Group }).__threeObj
            if (nodeObj) {
              const glow = nodeObj.getObjectByName("glow")
              if (glow && glow instanceof THREE.Mesh) {
                const mat = glow.material as THREE.MeshBasicMaterial
                mat.opacity = 0.5
              }
            }
          }
        })

        .onBackgroundClick(() => {
          setFocusedNodeId(null)
          graph.zoomToFit(600, 50)
        })

        // Force engine configuration
        .warmupTicks(WARMUP_TICKS)
        .cooldownTicks(COOLDOWN_TICKS)
        .d3VelocityDecay(0.4)

        // Feed data
        .graphData({ nodes: simNodes, links: simLinks })

      // Configure forces after data is loaded
      const chargeForce = graph.d3Force("charge")
      if (chargeForce && typeof chargeForce.strength === "function") {
        chargeForce.strength(FORCE_CHARGE_STRENGTH)
      }
      const linkForce = graph.d3Force("link")
      if (linkForce && typeof linkForce.distance === "function") {
        linkForce.distance(FORCE_LINK_DISTANCE)
      }

      // After simulation settles, zoom to fit
      graph.onEngineStop(() => {
        if (!destroyed) {
          graph.zoomToFit(400, 60)
        }
      })

      // Add bloom-like ambient light for better aesthetics
      const scene = graph.scene()
      scene.add(new THREE.AmbientLight(0xcccccc, 0.8))
      scene.add(new THREE.DirectionalLight(0xffffff, 0.6))
    }

    init()

    // Resize handling
    const resizeObserver = new ResizeObserver(() => {
      if (graphInstance && container) {
        const w = container.clientWidth
        const h = Math.max(500, container.clientHeight)
        graphInstance.width(w).height(h)
      }
    })
    resizeObserver.observe(container)

    return () => {
      destroyed = true
      resizeObserver.disconnect()
      if (graphInstance) {
        graphInstance._destructor()
        graphInstance = null
      }
      graphRef.current = null
      graphInitialized.current = false
      graphBuiltRef.current = false
      if (container) container.innerHTML = ""
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphFingerprint, currentCenter])

  // ─── Reapply focus colors when focusedNodeId changes ────────────────────

  useEffect(() => {
    const graph = graphRef.current
    if (!graph) return
    // Trigger a visual refresh by re-rendering node/link colors
    // 3d-force-graph re-evaluates accessor functions on refresh
    graph.nodeColor(graph.nodeColor())
    graph.linkColor(graph.linkColor())
  }, [focusedNodeId])

  // ─── Escape key clears focus ────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFocusedNodeId(null)
        const graph = graphRef.current
        if (graph) graph.zoomToFit(400, 60)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
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

      {/* 3D Graph canvas */}
      <div
        ref={containerRef}
        className="relative w-full rounded-lg border overflow-hidden"
        style={{ minHeight: 400, maxHeight: 500, background: SCENE_BG_COLOR }}
      />

      <p className="text-xs text-muted-foreground text-center">
        Click a node to focus, click again to expand. Drag to orbit. Scroll to zoom. Press Escape to reset view.
      </p>
    </div>
  )
}
