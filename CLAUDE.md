# Rivr Bioregional (REGION) — Agent Notes

Standalone sovereign basin/region-scale Rivr distribution (Next.js app under
`src/`). Runtime identity is `INSTANCE_TYPE=region`; some data-layer concepts
still say `basin`. See `README.md` for deploy/foundation (PM Core) context.

## Canonical entity links (federated-projection routing, 2026-07-14)

Fixes the class where a link to a REMOTE-HOMED entity (a federated projection —
e.g. a "Spirit of the Front Range" membership aggregated from its sovereign
home) rendered a bare LOCAL path that resolves the wrong record, and where a
cross-origin link rendered as a Next `<Link>` caused an RSC-prefetch CSP flash.

**Region divergence from the single-person app:** this bioregional instance HAS
a local route for every entity class it links to (`/profile/[username]`,
`/groups/[id]`, `/rings/[id]`, `/families/[id]`, `/projects/[id]`; place-typed
groups redirect to `/basins`|`/locales` via the `/groups/[id]` route guard). So
`globalFallback` defaults to **false**: an entity with NO federated home stamp is
assumed locally-homed and keeps its local path, while a federated projection
(carrying a home stamp) routes to its true sovereign home. The person app used
`globalFallback: true` because it has no `/groups|/rings|/families|/projects`
route; do NOT copy that here.

- **`src/lib/federation/entity-link.ts`** — pure, client-safe resolver.
  `resolveRemoteHomeBaseUrl(metadata)` reads the home stamp
  (`homeBaseUrl` → `federatedHomeBaseUrl` → origin of `canonicalUrl`);
  `resolveEntityHref(metadata, localPath, {selfBaseUrl, globalFallback})` returns
  `{href, isRemote}` — a remote projection → absolute URL on its sovereign home;
  a locally-homed entity → the local path (self-host stamp treated as local, loop
  guard). Tests: `src/lib/federation/__tests__/entity-link.test.ts`.
- **`src/components/canonical-link.tsx`** — `CanonicalLink` renders an absolute
  href as a plain `<a target="_blank" rel="noopener noreferrer">` (NEVER a Next
  `<Link>` — cross-origin RSC prefetch is the CSP-flash class) and a local path
  as `<Link>`. `navigateToHref(router, href)` is the imperative analog
  (`window.location.assign` for cross-origin, `router.push` for local).
- **Stamps (in `src/lib/graph-adapters.ts`):** `agentToGroup`/`agentToRing`/
  `agentToFamily`/`agentToProject` stamp `homeHref`; `agentToUser` stamps
  `profileHref`; `resourceToMarketplaceListing` stamps `ownerPath`. All via
  `agentCanonicalHref` (globalFallback:false — every class renders locally here).
  The `Group`/`Ring`/`Family` types carry `homeHref?`; `User` carries
  `profileHref?`. Feed/search hooks (`useHomeFeed`/`useGroups`/`usePeople`) return
  these already stamped (they map through `agentToGroup`/`agentToUser`). Consumers
  render `obj.homeHref ?? <localPath>` / `obj.profileHref ?? /profile/...` through
  `CanonicalLink`, or `resolveEntityHref(agent.metadata, localPath, {globalFallback:false}).href`
  when they only hold a raw `SerializedAgent`/`SerializedResource` (its `metadata`).

- **Swept surfaces (route through the stamped href):**
  `ring-feed`, `family-feed`, `project-feed` (predecessor); `group-feed`,
  `profile-group-feed`, `group-affiliates`, `group-subgroups`, `nested-groups`,
  `group-relationships`, `group-relationship-manager` (group cards/links);
  `people-feed`, `user-connections`, `post-feed` (author/creator profileHref,
  organizer homeHref, group card + card-click via `navigateToHref`),
  `post-detail-client` (author byline); `marketplace-feed`,
  `group-marketplace-feed`, `marketplace-item-page-client` (`ownerPath`);
  `agent-graph` (subgroup node homeHref), `explore-graph-3d` &
  `explore-graph-canvas` (group node homeHref) + `map-card` (the shared node/map
  nav surface, now `CanonicalLink`); `search-bar`/`search-header` (`navigateToHref`);
  `app/(main)/profile/profile-client.tsx` (`getActivityObjectHref` → `resolveEntityHref`);
  `app/(main)/people/page.tsx`, `app/(main)/groups/page.tsx`,
  `app/(main)/explore/page.tsx`, `app/(main)/map/page.tsx`,
  `app/(main)/explore/suggested-follows.tsx`; `app/events/[id]/page.tsx`
  (organizer/creator), `app/projects/[id]/page.tsx` (owner/members),
  `app/rings/[id]/page.tsx` (joint-venture projects).

- **Not the bug class (left as local, correct here):** events/posts/jobs and
  local sub-routes render locally (routes exist). `notifications/page.tsx` keeps a
  bare local `/groups/<targetId>` — in region that resolves correctly for a
  locally-homed group (it is NOT the 404 class the person app had); it simply
  can't reach a federated projection's sovereign home yet (see gaps). Server
  `revalidatePath(...)` calls and SEO metadata `path:` builders are cache/canonical
  plumbing, not user links — leave them.

- **Follow-up gaps (need a home stamp plumbed into the data layer; no stamp in
  scope today, so these keep their bare local path — correct for a locally-homed
  entity, wrong for a federated projection):**
  `notifications/page.tsx` (bare `targetId`, no metadata);
  `comment-feed` (bare `authorId`); `receipt-card` (inline `seller`, no metadata);
  `app/marketplace/[id]/receipt/[receiptId]/receipt-detail-client.tsx`
  (`receipt.seller` shape has no metadata);
  `app/explore/suggested-follows.tsx` (uses `MemberInfo`, which has no metadata —
  distinct from the routed `(main)/explore/suggested-follows.tsx`, which has raw
  `SerializedAgent.metadata`); `event-detail-tabs` attendee list (`EventAttendee`
  has no home stamp); `event-card`/`calendar-event` (bare `groupId`/`projectId`
  props); `group-profile-header` lineage breadcrumb (`{id, name}` ancestors);
  `job-board-tab` (`ProjectDisplay`, local group children); `agent-graph`
  activity-object node and the `explore-graph-*` ledger-entry nodes /
  `hrefForNodeType` helper (bare IDs, no metadata); `admin/tasks` and `badges/[id]`
  job links (bare IDs). To close a gap, project the entity's home stamp
  (`homeBaseUrl`/`federatedHomeBaseUrl`/`canonicalUrl`) into that surface's
  fetcher/type, then route it through `resolveEntityHref`/`CanonicalLink`.
