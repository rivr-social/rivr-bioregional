/**
 * Static navigation manifest for the sovereign region /docs site.
 *
 * This is the region-instance port of global's docs nav. The WIKI side-nav is
 * authored here (prose pages, human-curated order) and leads with the
 * bioregional place surfaces a region/basin commons is built around — the
 * bioregion/basin directory, its place-scoped feed and events, and the groups
 * that organise within it. The API side-nav is a STATIC hand-authored list
 * (overview / auth / federation): unlike global, this sovereign build does not
 * ship the machine-generated per-registry MCP / per-endpoint REST reference, so
 * there is no `_generated/*` manifest to assemble from.
 */

export type NavLink = { href: string; label: string };
export type NavSection = { title: string; links: NavLink[] };

/** WIKI surfaces — one page per user-facing surface, ported from global. */
export const WIKI_SECTIONS: NavSection[] = [
  {
    title: "Overview",
    links: [{ href: "/docs/wiki", label: "Wiki index" }],
  },
  {
    title: "Bioregion & community",
    links: [
      { href: "/docs/wiki/locales-regions", label: "Regions & bioregions" },
      { href: "/docs/wiki/groups", label: "Groups & subgroups" },
    ],
  },
  {
    title: "Core surfaces",
    links: [
      { href: "/docs/wiki/feeds-posts", label: "Feeds & posts" },
      { href: "/docs/wiki/explore-search", label: "Explore & search" },
      { href: "/docs/wiki/calendar-events", label: "Calendar & events" },
      { href: "/docs/wiki/messages", label: "Messages" },
      { href: "/docs/wiki/marketplace", label: "Marketplace & gifts" },
      { href: "/docs/wiki/wallet-treasury", label: "Wallet & treasury" },
    ],
  },
  {
    title: "Coordination & docs",
    links: [
      { href: "/docs/wiki/badges-stake", label: "Badges & stake" },
      { href: "/docs/wiki/docs-vault", label: "Docs, filesystem & vault" },
    ],
  },
  {
    title: "Identity & extension",
    links: [
      { href: "/docs/wiki/federation-identity", label: "Federation & SSO identity" },
      { href: "/docs/wiki/autobot-agents", label: "Autobot & agents" },
      { href: "/docs/wiki/builder", label: "Builder" },
    ],
  },
  {
    title: "Account & operator",
    links: [
      { href: "/docs/wiki/account-settings", label: "Account & settings" },
      { href: "/docs/wiki/admin", label: "Admin" },
    ],
  },
];

/** Every wiki slug (for validation / completeness checks). */
export const WIKI_SLUGS = WIKI_SECTIONS.flatMap((s) => s.links)
  .map((l) => l.href.replace("/docs/wiki/", ""))
  .filter((slug) => slug !== "/docs/wiki" && !slug.startsWith("/docs/wiki"));

/** Top-of-tab links for the API side-nav. */
export const API_TOP_LINKS: NavLink[] = [
  { href: "/docs/api", label: "API overview" },
  { href: "/docs/api/auth", label: "Auth models" },
  { href: "/docs/api/federation", label: "Federation protocol" },
];

/** Static API side-nav sections (no generated manifests on this sovereign build). */
export const API_SECTIONS: NavSection[] = [{ title: "Developer docs", links: API_TOP_LINKS }];

export const DOCS_TABS: NavLink[] = [
  { href: "/docs/wiki", label: "Wiki" },
  { href: "/docs/api", label: "API" },
];
