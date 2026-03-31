import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import GraphTemplateInspector from "@/components/admin/graph-template-inspector";

type Hit = {
  file: string;
  line: number;
  snippet: string;
};

type FlowCheck = {
  file: string;
  contains: string;
};

type Flow = {
  id: string;
  category: string;
  label: string;
  description: string;
  objectRows: string[];
  endpoints: string[];
  functions: string[];
  pages: string[];
  checks: FlowCheck[];
};

const ROOT = process.cwd();
const SRC_ROOT = path.join(ROOT, "src");
const EXTENSIONS = new Set([".ts", ".tsx"]);

// ─── COMPLETE SYSTEM FLOWS ──────────────────────────────────────────────────

const FLOWS: Flow[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // CORE INFRASTRUCTURE — foundational layers everything depends on
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "core-schema",
    category: "Core Infrastructure",
    label: "Graph schema definitions",
    description: "PostgreSQL tables: agents (nodes), resources (data), ledger (edges). All entity types, enums, indexes, and relations.",
    objectRows: ["agents", "resources", "ledger", "enums"],
    endpoints: [],
    functions: ["db/schema.ts"],
    pages: [],
    checks: [
      { file: "src/db/schema.ts", contains: "export const agents = pgTable" },
      { file: "src/db/schema.ts", contains: "export const resources = pgTable" },
      { file: "src/db/schema.ts", contains: "export const ledger = pgTable" },
    ],
  },
  {
    id: "supporting-schema",
    category: "Core Infrastructure",
    label: "Supporting schema (auth, billing, federation)",
    description: "Sessions, accounts, subscriptions, wallets, email tokens, federation tables.",
    objectRows: ["sessions", "accounts", "subscriptions", "wallets", "walletTransactions", "emailVerificationTokens", "emailLog"],
    endpoints: [],
    functions: ["db/schema.ts"],
    pages: [],
    checks: [
      { file: "src/db/schema.ts", contains: "subscriptions" },
      { file: "src/db/schema.ts", contains: "wallets" },
      { file: "src/db/schema.ts", contains: "emailVerificationTokens" },
    ],
  },
  {
    id: "permissions",
    category: "Core Infrastructure",
    label: "Permission evaluation (ABAC)",
    description: "Policy engine: owner/self checks → direct ledger grants → verb implications → visibility levels → group membership → ABAC policies.",
    objectRows: ["ledger predicates", "agents membership"],
    endpoints: ["/api/groups/access"],
    functions: ["permissions.ts: check, canView, canManage, grantPermission"],
    pages: [],
    checks: [
      { file: "src/lib/permissions.ts", contains: "export async function" },
      { file: "src/app/actions/group-access.ts", contains: "challengeGroupAccess" },
    ],
  },
  {
    id: "local-db",
    category: "Core Infrastructure",
    label: "Offline cache layer (IndexedDB / Dexie)",
    description: "Client-side tables mirror server graph. Cache-first reads with background sync. Staleness checks via syncMeta timestamps.",
    objectRows: ["local:agents", "local:resources", "local:ledger", "local:syncMeta"],
    endpoints: [],
    functions: ["local-db.ts: upsertAgents, upsertResources, isStale, markSynced"],
    pages: ["hooks/use-graph-data.ts"],
    checks: [
      { file: "src/lib/local-db.ts", contains: "class RivrLocalDB extends Dexie" },
      { file: "src/lib/local-db.ts", contains: "export async function upsertAgents" },
      { file: "src/lib/hooks/use-graph-data.ts", contains: "getLocalAgentsByType" },
    ],
  },
  {
    id: "graph-adapters",
    category: "Core Infrastructure",
    label: "Graph adapter transforms",
    description: "SerializedAgent/Resource → UI domain models (User, Group, Event, Place, Post, MarketplaceListing, Basin, Locale).",
    objectRows: ["SerializedAgent", "SerializedResource"],
    endpoints: [],
    functions: ["graph-adapters.ts: agentToUser, agentToGroup, resourceToPost, resourceToMarketplaceListing"],
    pages: ["hooks/use-graph-data.ts"],
    checks: [
      { file: "src/lib/graph-adapters.ts", contains: "export function agentToUser" },
      { file: "src/lib/graph-adapters.ts", contains: "export function resourceToPost" },
      { file: "src/lib/graph-adapters.ts", contains: "export function resourceToMarketplaceListing" },
    ],
  },
  {
    id: "graph-hooks",
    category: "Core Infrastructure",
    label: "React data hooks",
    description: "Cache-first pattern: IndexedDB instant read → sessionStorage fallback → server action fetch → persist to IndexedDB + sessionStorage. Cross-tab sync via BroadcastChannel.",
    objectRows: [],
    endpoints: [],
    functions: ["use-graph-data.ts: usePeople, useGroups, useEvents, usePlaces, useHomeFeed, useMarketplace, usePosts, useAgentSearch, useAgent, useLocalesAndBasins"],
    pages: ["all client pages"],
    checks: [
      { file: "src/lib/hooks/use-graph-data.ts", contains: "export function usePeople" },
      { file: "src/lib/hooks/use-graph-data.ts", contains: "export function useHomeFeed" },
      { file: "src/lib/hooks/use-graph-data.ts", contains: "export function useMarketplace" },
      { file: "src/lib/hooks/use-graph-data.ts", contains: "export function useLocalesAndBasins" },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // READ FLOWS — data out from server to client
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "home-feed",
    category: "Read Flows",
    label: "Home feed aggregation",
    description: "Fetches people, groups, events, places, projects, marketplace in one bundle. Supports global and scoped (locale/basin) modes.",
    objectRows: ["agents (all types)", "resources (listings)"],
    endpoints: ["action:fetchHomeFeed", "action:fetchScopedHomeFeed"],
    functions: ["fetchHomeFeed", "fetchScopedHomeFeed"],
    pages: ["/(main)/page"],
    checks: [
      { file: "src/app/actions/graph.ts", contains: "export async function fetchHomeFeed" },
      { file: "src/app/actions/graph.ts", contains: "export async function fetchScopedHomeFeed" },
    ],
  },
  {
    id: "scoped-feed",
    category: "Read Flows",
    label: "Locale & basin hierarchy",
    description: "Basins (regions) → Locales (cities) → Chapters. Agents filtered by pathIds hierarchy. Scoped search within boundaries.",
    objectRows: ["agents (basin/locale)", "agents.pathIds"],
    endpoints: ["action:fetchBasins", "action:fetchLocales", "action:searchInScope"],
    functions: ["fetchBasins", "fetchLocales", "fetchChapters", "searchInScope"],
    pages: ["/(main)/page (scope selector)"],
    checks: [
      { file: "src/app/actions/graph.ts", contains: "export async function fetchBasins" },
      { file: "src/app/actions/graph.ts", contains: "export async function fetchLocales" },
      { file: "src/app/actions/graph.ts", contains: "export async function searchInScope" },
    ],
  },
  {
    id: "group-detail",
    category: "Read Flows",
    label: "Group detail bundle",
    description: "Full group view: members (via ledger join edges), subgroups (children), events, resources, inter-group relationships.",
    objectRows: ["agents", "resources", "ledger (join/belong)"],
    endpoints: ["action:fetchGroupDetail", "action:fetchGroupMemberList"],
    functions: ["fetchGroupDetail", "fetchGroupMemberList", "fetchGroupRelationships"],
    pages: ["/groups/[id]"],
    checks: [
      { file: "src/app/actions/graph.ts", contains: "export async function fetchGroupDetail" },
      { file: "src/app/actions/graph.ts", contains: "export async function fetchGroupMemberList" },
      { file: "src/app/actions/graph.ts", contains: "export async function fetchGroupRelationships" },
    ],
  },
  {
    id: "profile-data",
    category: "Read Flows",
    label: "User profile bundle",
    description: "Agent details + owned resources + activity feed for a user. Supports lookup by ID or username.",
    objectRows: ["agents", "resources (owned)", "ledger (activity)"],
    endpoints: ["action:fetchProfileData", "action:fetchAgentByUsername"],
    functions: ["fetchProfileData", "fetchAgentByUsername", "fetchResourcesByOwner"],
    pages: ["/profile/[username]"],
    checks: [
      { file: "src/app/actions/graph.ts", contains: "export async function fetchProfileData" },
      { file: "src/app/actions/graph.ts", contains: "export async function fetchAgentByUsername" },
    ],
  },
  {
    id: "marketplace",
    category: "Read Flows",
    label: "Mart listings",
    description: "Product/service listings filtered by metadata.listingType. Includes owner name/image join. Saved listing tracking via ledger.",
    objectRows: ["resources (listing)", "agents (owner)", "ledger (save)"],
    endpoints: ["action:fetchMarketplaceListings", "action:fetchMySavedListingIds"],
    functions: ["fetchMarketplaceListings", "fetchMarketplaceListingById", "fetchMySavedListingIds"],
    pages: ["/marketplace", "/marketplace/[id]"],
    checks: [
      { file: "src/app/actions/graph.ts", contains: "export async function fetchMarketplaceListings" },
      { file: "src/app/actions/graph.ts", contains: "export async function fetchMarketplaceListingById" },
      { file: "src/app/actions/graph.ts", contains: "export async function fetchMySavedListingIds" },
    ],
  },
  {
    id: "map-discovery",
    category: "Read Flows",
    label: "Map discovery + geospatial",
    description: "CesiumJS 3D globe. PostGIS proximity queries (ST_DWithin). Cached tile proxy. Type-coded markers (events=purple, groups=blue, posts=green, offerings=amber).",
    objectRows: ["agents (location geometry)", "resources", "tile caches"],
    endpoints: ["/api/map-style", "/api/map-tilesets", "/api/map-diagnostics"],
    functions: ["fetchAgentsNearby", "fetchPublicResources"],
    pages: ["/(main)/map/page"],
    checks: [
      { file: "src/app/actions/graph.ts", contains: "export async function fetchAgentsNearby" },
    ],
  },
  {
    id: "search",
    category: "Read Flows",
    label: "Agent / entity search",
    description: "Name-based search with local IndexedDB instant results, then server authoritative results. Scoped search filters by pathIds.",
    objectRows: ["agents (name index)"],
    endpoints: ["action:searchAgentsByName", "action:fetchExploreFeed"],
    functions: ["searchAgentsByName", "fetchExploreFeed", "searchLocalAgents"],
    pages: ["/(main)/explore"],
    checks: [
      { file: "src/app/actions/graph.ts", contains: "export async function searchAgentsByName" },
      { file: "src/app/actions/graph.ts", contains: "export async function fetchExploreFeed" },
      { file: "src/lib/local-db.ts", contains: "export async function searchLocalAgents" },
    ],
  },
  {
    id: "event-detail",
    category: "Read Flows",
    label: "Event detail + RSVP count",
    description: "Single event agent with metadata (date, time, location). RSVP count aggregated from ledger entries.",
    objectRows: ["agents (event)", "ledger (rsvp count)"],
    endpoints: ["action:fetchEventDetail"],
    functions: ["fetchEventDetail", "fetchEventRsvpCount"],
    pages: ["/events/[id]"],
    checks: [
      { file: "src/app/actions/graph.ts", contains: "export async function fetchEventDetail" },
      { file: "src/app/actions/interactions.ts", contains: "fetchEventRsvpCount" },
    ],
  },
  {
    id: "post-detail",
    category: "Read Flows",
    label: "Post detail + comments",
    description: "Single post resource with author data, comments (ledger comment edges), reaction counts.",
    objectRows: ["resources (post)", "ledger (react/comment)", "agents (author)"],
    endpoints: ["action:fetchPostDetail"],
    functions: ["fetchPostDetail"],
    pages: ["/posts/[id]"],
    checks: [
      { file: "src/app/actions/graph.ts", contains: "export async function fetchPostDetail" },
    ],
  },
  {
    id: "badges-vouchers",
    category: "Read Flows",
    label: "Badges & vouchers",
    description: "Badge definitions (resources type=badge). User assignments via ledger earn/assign edges. Group voucher pools with claim tracking.",
    objectRows: ["resources (badge/voucher)", "ledger (earn/assign/claim)"],
    endpoints: ["action:fetchGroupBadges", "action:fetchVouchersForGroup"],
    functions: ["fetchGroupBadges", "fetchUserBadges", "fetchVouchersForGroup", "fetchVoucherClaims"],
    pages: ["/badges", "/groups/[id] (badges tab)"],
    checks: [
      { file: "src/app/actions/graph.ts", contains: "export async function fetchGroupBadges" },
      { file: "src/app/actions/graph.ts", contains: "export async function fetchUserBadges" },
      { file: "src/app/actions/graph.ts", contains: "export async function fetchVouchersForGroup" },
    ],
  },
  {
    id: "inbox",
    category: "Read Flows",
    label: "Notifications",
    description: "Notification feed with read/unread state tracking. DMs migrated to Matrix/Synapse.",
    objectRows: ["ledger (notifications)"],
    endpoints: ["action:fetchNotifications"],
    functions: ["fetchNotifications", "markAllNotificationsAsRead"],
    pages: ["/notifications"],
    checks: [
      { file: "src/app/actions/inbox.ts", contains: "fetchNotifications" },
    ],
  },
  {
    id: "wallet-read",
    category: "Read Flows",
    label: "Wallet balance & history",
    description: "Personal and group wallet balances (cents). Transaction history. Ticket purchase records.",
    objectRows: ["wallets", "walletTransactions", "ledger (purchase)"],
    endpoints: ["action:getMyWalletAction"],
    functions: ["getMyWalletAction", "getMyWalletsAction", "getTransactionHistoryAction", "getMyTicketPurchasesAction"],
    pages: ["/wallet", "/profile"],
    checks: [
      { file: "src/app/actions/wallet.ts", contains: "getMyWalletAction" },
      { file: "src/app/actions/wallet.ts", contains: "getTransactionHistoryAction" },
    ],
  },
  {
    id: "member-stakes",
    category: "Read Flows",
    label: "Member stake aggregation",
    description: "Contribution-weighted member stakes for governance. Aggregated from ledger activity.",
    objectRows: ["ledger (contributions)", "agents (members)"],
    endpoints: [],
    functions: ["getMemberStakesForGroup", "calculateTotalStakes"],
    pages: ["/groups/[id] (stakes tab)"],
    checks: [
      { file: "src/lib/queries/stakes.ts", contains: "getMemberStakesForGroup" },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // WRITE FLOWS — data mutations from client to server
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "create-entities",
    category: "Write Flows",
    label: "NLP entity creation",
    description: "Natural language → entity scaffold → agent/resource inserts with hierarchy (parentId, depth, pathIds) + ledger create edges.",
    objectRows: ["agents inserts", "resources inserts", "ledger create edges"],
    endpoints: ["action:createEntitiesFromScaffold"],
    functions: ["createEntitiesFromScaffold", "findExistingEntitiesByNames"],
    pages: ["/(main)/create"],
    checks: [
      { file: "src/app/actions/create-entities.ts", contains: "createEntitiesFromScaffold" },
      { file: "src/app/actions/find-entities.ts", contains: "findExistingEntitiesByNames" },
    ],
  },
  {
    id: "create-resources",
    category: "Write Flows",
    label: "Resource creation (posts, events, projects, listings)",
    description: "Typed resource inserts with rate limiting. Creates ledger 'create' edge. Nested job/task creation for projects. Path revalidation.",
    objectRows: ["resources inserts", "ledger create edges"],
    endpoints: ["action:createPostResource", "action:createEventResource", "action:createProjectResource"],
    functions: ["createPostResource", "createEventResource", "createProjectResource", "createMarketplaceListingResource"],
    pages: ["/(main)/create"],
    checks: [
      { file: "src/app/actions/create-resources.ts", contains: "createPostResource" },
      { file: "src/app/actions/create-resources.ts", contains: "createEventResource" },
      { file: "src/app/actions/create-resources.ts", contains: "createMarketplaceListingResource" },
    ],
  },
  {
    id: "create-groups",
    category: "Write Flows",
    label: "Group creation & management",
    description: "Organization agent creation with join settings, password protection, and soft-delete support.",
    objectRows: ["agents inserts/updates", "ledger create edges"],
    endpoints: ["action:createGroupResource", "action:updateGroupResource"],
    functions: ["createGroupResource", "updateGroupResource", "deleteGroupResource"],
    pages: ["/(main)/create", "/groups/[id]/settings"],
    checks: [
      { file: "src/app/actions/create-resources.ts", contains: "createGroupResource" },
      { file: "src/app/actions/create-resources.ts", contains: "updateGroupResource" },
    ],
  },
  {
    id: "social-interactions",
    category: "Write Flows",
    label: "Social interactions (like / follow / join / save)",
    description: "Toggleable ledger entries: if active entry exists → deactivate; else → create. Supports like, thank, follow, join, save verbs.",
    objectRows: ["ledger toggles (react/follow/join/save)"],
    endpoints: ["action:toggleLikeOnTarget", "action:toggleFollowAgent", "action:toggleJoinGroup"],
    functions: ["toggleLikeOnTarget", "toggleThankOnTarget", "toggleFollowAgent", "toggleJoinGroup", "toggleSaveListing"],
    pages: ["all feed/detail pages"],
    checks: [
      { file: "src/app/actions/interactions.ts", contains: "toggleLikeOnTarget" },
      { file: "src/app/actions/interactions.ts", contains: "toggleFollowAgent" },
      { file: "src/app/actions/interactions.ts", contains: "toggleJoinGroup" },
      { file: "src/app/actions/interactions.ts", contains: "toggleSaveListing" },
    ],
  },
  {
    id: "group-access",
    category: "Write Flows",
    label: "Group membership lifecycle",
    description: "Password-based join challenge (bcrypt). Membership join/revoke/renew via ledger. Expiration-based access control.",
    objectRows: ["agents (group_password_hash)", "ledger (join entries with expiresAt)"],
    endpoints: ["/api/groups/access"],
    functions: ["challengeGroupAccess", "checkGroupMembership", "revokeGroupMembership", "renewGroupMembership"],
    pages: ["/groups/[id]"],
    checks: [
      { file: "src/app/actions/group-access.ts", contains: "challengeGroupAccess" },
      { file: "src/app/actions/group-access.ts", contains: "revokeGroupMembership" },
    ],
  },
  {
    id: "group-admin",
    category: "Write Flows",
    label: "Group admin settings",
    description: "Password set/remove, join mode configuration, membership plan definitions. Stored in agent metadata.",
    objectRows: ["agents (metadata, group_password_hash)"],
    endpoints: ["action:setGroupPassword", "action:updateGroupJoinSettings"],
    functions: ["setGroupPassword", "removeGroupPassword", "fetchGroupAdminSettings", "updateGroupJoinSettings", "updateGroupMembershipPlans"],
    pages: ["/groups/[id]/settings"],
    checks: [
      { file: "src/app/actions/group-admin.ts", contains: "setGroupPassword" },
      { file: "src/app/actions/group-admin.ts", contains: "fetchGroupAdminSettings" },
    ],
  },
  {
    id: "messaging",
    category: "Write Flows",
    label: "Matrix messaging",
    description: "Real-time DMs via Matrix/Synapse. User provisioning on signup. matrix-js-sdk browser client with sync.",
    objectRows: ["agents (matrixUserId, matrixAccessToken)", "group_matrix_rooms"],
    endpoints: ["action:getMatrixCredentials", "action:getDmRoomForUser"],
    functions: ["getMatrixCredentials", "getDmRoomForUser", "provisionMatrixUser"],
    pages: ["/messages"],
    checks: [
      { file: "src/app/actions/matrix.ts", contains: "getMatrixCredentials" },
      { file: "src/lib/matrix-admin.ts", contains: "provisionMatrixUser" },
    ],
  },
  {
    id: "wallet-write",
    category: "Write Flows",
    label: "Wallet transactions",
    description: "P2P transfers, marketplace purchases, event ticket purchases. Stripe deposit webhook. Balance validation before transfer.",
    objectRows: ["wallets (balance)", "walletTransactions", "ledger (transfer/purchase)"],
    endpoints: ["action:sendMoneyAction", "/api/wallet/deposit"],
    functions: ["sendMoneyAction", "purchaseWithWalletAction", "purchaseEventTicketsWithWalletAction", "createDepositIntentAction"],
    pages: ["/wallet", "/marketplace/[id]", "/events/[id]"],
    checks: [
      { file: "src/app/actions/wallet.ts", contains: "sendMoneyAction" },
      { file: "src/app/actions/wallet.ts", contains: "purchaseWithWalletAction" },
    ],
  },
  {
    id: "event-rsvp-tickets",
    category: "Write Flows",
    label: "Event RSVP & ticketing",
    description: "RSVP status updates (ledger). Ticket checkout via Stripe or wallet balance. Ticket product auto-creation.",
    objectRows: ["ledger (rsvp)", "resources (ticket product)", "wallets"],
    endpoints: ["action:setEventRsvp", "/api/stripe/checkout"],
    functions: ["setEventRsvp", "createEventTicketCheckoutAction", "purchaseEventTicketsWithWalletAction"],
    pages: ["/events/[id]"],
    checks: [
      { file: "src/app/actions/interactions.ts", contains: "setEventRsvp" },
      { file: "src/app/actions/wallet.ts", contains: "createEventTicketCheckoutAction" },
    ],
  },
  {
    id: "profile-update",
    category: "Write Flows",
    label: "Profile & settings updates",
    description: "Name, username, email, bio, phone updates. Email changes trigger re-verification token + email. Eth address binding.",
    objectRows: ["agents updates", "emailVerificationTokens", "emailLog"],
    endpoints: ["action:updateProfileAction", "action:updateMyProfile"],
    functions: ["updateProfileAction", "updateMyProfile", "setEthAddressAction"],
    pages: ["/settings"],
    checks: [
      { file: "src/app/actions/settings.ts", contains: "updateProfileAction" },
      { file: "src/app/actions/interactions.ts", contains: "updateMyProfile" },
    ],
  },
  {
    id: "resource-update-delete",
    category: "Write Flows",
    label: "Resource update & soft-delete",
    description: "Generic resource update (any field). Soft-delete sets deletedAt. Group-specific update/delete variants.",
    objectRows: ["resources updates", "agents updates (groups)"],
    endpoints: ["action:updateResource", "action:deleteResource"],
    functions: ["updateResource", "deleteResource", "updateGroupResource", "deleteGroupResource"],
    pages: ["edit pages"],
    checks: [
      { file: "src/app/actions/create-resources.ts", contains: "updateResource" },
      { file: "src/app/actions/create-resources.ts", contains: "deleteResource" },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTH & ACCOUNT — identity and subscription management
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "auth-flow",
    category: "Auth & Account",
    label: "Authentication (login / signup / logout)",
    description: "Credentials-based auth with NextAuth v5. Signup creates agent record. Login validates password. Session management.",
    objectRows: ["agents", "sessions", "accounts"],
    endpoints: ["/api/auth/[...nextauth]"],
    functions: ["loginAction", "signupAction", "logoutAction"],
    pages: ["/auth/login", "/auth/signup"],
    checks: [
      { file: "src/app/actions/auth.ts", contains: "loginAction" },
      { file: "src/app/actions/auth.ts", contains: "signupAction" },
    ],
  },
  {
    id: "email-verification",
    category: "Auth & Account",
    label: "Email verification & password reset",
    description: "Token-based email verification (GET /api/auth/verify-email?token=X). Password reset with expiring tokens. Email delivery audit trail.",
    objectRows: ["emailVerificationTokens", "agents (emailVerified)", "emailLog"],
    endpoints: ["/api/auth/verify-email"],
    functions: ["resendVerificationAction", "requestPasswordResetAction", "resetPasswordWithTokenAction"],
    pages: ["/auth/verify", "/auth/password-reset"],
    checks: [
      { file: "src/app/actions/auth.ts", contains: "resendVerificationAction" },
      { file: "src/app/actions/password-reset.ts", contains: "requestPasswordResetAction" },
    ],
  },
  {
    id: "billing",
    category: "Auth & Account",
    label: "Stripe subscriptions & billing",
    description: "Membership tiers: host, seller, organizer, steward. Stripe checkout sessions, webhook processing, free trial support.",
    objectRows: ["subscriptions (stripeCustomerId, tier, status)", "agents"],
    endpoints: ["/api/stripe/webhook"],
    functions: ["createCheckoutAction", "getSubscriptionStatusAction", "startFreeTrialAction"],
    pages: ["/settings (billing tab)"],
    checks: [
      { file: "src/app/actions/billing.ts", contains: "createCheckoutAction" },
      { file: "src/app/actions/billing.ts", contains: "getSubscriptionStatusAction" },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // EXTERNAL INTEGRATIONS — third-party services and inter-node communication
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "file-upload",
    category: "External Integrations",
    label: "File upload (S3 / Minio)",
    description: "Multipart upload handler. Stores in object storage. Updates resource metadata (fileSize, storageKey, storageProvider, contentType).",
    objectRows: ["resources (fileSize, storageKey, contentType)"],
    endpoints: ["/api/upload"],
    functions: [],
    pages: ["create pages", "/settings"],
    checks: [
      { file: "src/app/api/upload/route.ts", contains: "export async function POST" },
    ],
  },
  {
    id: "federation",
    category: "External Integrations",
    label: "Federation (cross-node sync)",
    description: "Event export/import between federated instances. Entity ID mapping prevents namespace collisions. Trust relationships via nodePeers.",
    objectRows: ["federationEvents", "federationEntityMap", "federationAuditLog", "nodes", "nodePeers"],
    endpoints: ["/api/federation/events/export", "/api/federation/events/import"],
    functions: [],
    pages: [],
    checks: [
      { file: "src/db/schema.ts", contains: "federationEvents" },
      { file: "src/db/schema.ts", contains: "federationEntityMap" },
    ],
  },
  {
    id: "email-broadcast",
    category: "External Integrations",
    label: "Group email broadcasting",
    description: "Sends bulk email to all group members. Looks up members via ledger join edges. Tracks delivery in emailLog.",
    objectRows: ["ledger (group member lookup)", "emailLog (delivery audit)"],
    endpoints: ["action:sendGroupBroadcastAction"],
    functions: ["sendGroupBroadcastAction"],
    pages: ["/groups/[id] (admin)"],
    checks: [
      { file: "src/app/actions/email.ts", contains: "sendGroupBroadcastAction" },
    ],
  },
  {
    id: "nlp-commands",
    category: "External Integrations",
    label: "Natural language commands",
    description: "Free-text command parsing → structured entity/resource creation pipeline. Leverages NLP module for intent extraction.",
    objectRows: ["agents", "resources", "ledger"],
    endpoints: ["action:executeCommand"],
    functions: ["executeCommand"],
    pages: ["/(main)/create"],
    checks: [
      { file: "src/app/actions/commands.ts", contains: "executeCommand" },
    ],
  },
];

// ─── ENTITY TEMPLATE LIBRARY ────────────────────────────────────────────────

const TEMPLATE_LIBRARY: Record<string, Record<string, Record<string, unknown>>> = {
  agents: {
    person: {
      name: "Jane Doe",
      type: "person",
      description: "Individual member profile",
      email: "jane@example.com",
      visibility: "locale",
      metadata: { localeId: "locale_uuid", chapterTags: ["boulder"], interests: ["mutual aid", "food"] },
      location: { lat: 40.015, lng: -105.2705 },
    },
    organization: {
      name: "Boulder Mutual Aid",
      type: "organization",
      description: "Neighborhood support group",
      visibility: "members",
      parentId: "basin_or_locale_uuid",
      metadata: { groupType: "community", chapterTags: ["boulder"], joinMode: "password" },
    },
    event: {
      name: "Community Clean Up",
      type: "event",
      description: "Volunteer street cleanup event",
      visibility: "public",
      metadata: { date: "2026-03-01", time: "10:00", location: "Downtown Boulder", ticketPrice: 0, maxAttendees: 50 },
      location: { lat: 40.017, lng: -105.279 },
    },
    place: {
      name: "Pearl Street Mall",
      type: "place",
      description: "Public gathering space",
      visibility: "public",
      metadata: { placeType: "park", address: "Pearl St, Boulder, CO", hours: "6am-11pm" },
      location: { lat: 40.018, lng: -105.277 },
    },
    project: {
      name: "Community Garden Phase 2",
      type: "project",
      description: "Expanding the raised bed garden",
      visibility: "members",
      metadata: { status: "active", budget: 5000, jobs: ["job_uuid_1"], milestones: [] },
    },
    basin: {
      name: "Colorado Front Range",
      type: "basin",
      description: "Regional governance basin",
      visibility: "public",
      metadata: { basinCode: "front-range" },
    },
    locale: {
      name: "Boulder",
      type: "locale",
      description: "City-level locale node",
      visibility: "public",
      parentId: "basin_uuid",
      metadata: { localeCode: "boulder", chapterTags: ["boulder"] },
    },
  },
  resources: {
    post: {
      name: "Need volunteers for pantry shift",
      type: "post",
      description: "Urgent volunteer request",
      ownerId: "agent_uuid",
      visibility: "public",
      metadata: { entityType: "post", chapterTags: ["boulder"] },
      tags: ["volunteer", "food"],
    },
    badge: {
      name: "Plant Steward",
      type: "badge",
      description: "Completed plant care certification",
      ownerId: "group_uuid",
      visibility: "public",
      metadata: { icon: "🌱", category: "environmental", level: "beginner", requirements: ["Complete module 1", "Pass quiz"] },
    },
    voucher: {
      name: "Community Bucks - March 2026",
      type: "voucher",
      description: "Monthly community currency allocation",
      ownerId: "group_uuid",
      visibility: "members",
      metadata: { denomination: 10, maxClaims: 100, currentClaims: 23, expiresAt: "2026-04-01" },
    },
    job: {
      name: "Garden Coordinator",
      type: "job",
      description: "Oversee weekly garden maintenance",
      ownerId: "project_uuid",
      metadata: { shiftId: "shift_uuid", points: 50, estimatedTime: "2 hours", status: "open" },
    },
    listing: {
      name: "Handmade Soap Bundle",
      type: "listing",
      description: "Organic lavender soap, pack of 3",
      ownerId: "agent_uuid",
      visibility: "public",
      metadata: { listingType: "product", price: 1200, currency: "cents", condition: "new" },
      tags: ["handmade", "soap", "organic"],
    },
    document: {
      name: "Mutual aid onboarding guide",
      type: "document",
      description: "Guide for new members",
      ownerId: "group_uuid",
      visibility: "members",
      metadata: { resourceKind: "document", contentType: "text/markdown" },
    },
  },
  ledger: {
    join: {
      verb: "join",
      subjectId: "person_agent_uuid",
      objectId: "group_agent_uuid",
      objectType: "agent",
      isActive: true,
      metadata: { reason: "membership approved", membershipPlan: "free" },
      expiresAt: "2027-01-01T00:00:00Z",
    },
    grant: {
      verb: "grant",
      subjectId: "admin_agent_uuid",
      objectId: "target_uuid",
      objectType: "agent",
      isActive: true,
      role: "admin",
      metadata: { policy: "group_admin" },
    },
    react: {
      verb: "react",
      subjectId: "person_agent_uuid",
      objectId: "post_resource_uuid",
      objectType: "resource",
      isActive: true,
      metadata: { interactionType: "like" },
    },
    follow: {
      verb: "follow",
      subjectId: "person_agent_uuid",
      objectId: "other_person_uuid",
      objectType: "agent",
      isActive: true,
      metadata: {},
    },
    earn: {
      verb: "earn",
      subjectId: "person_agent_uuid",
      objectId: "badge_resource_uuid",
      objectType: "resource",
      isActive: true,
      metadata: { earnedAt: "2026-02-24" },
    },
    purchase: {
      verb: "purchase",
      subjectId: "person_agent_uuid",
      objectId: "listing_resource_uuid",
      objectType: "resource",
      isActive: true,
      metadata: { quantity: 1, totalCents: 1200, paymentMethod: "wallet" },
    },
    transfer: {
      verb: "transfer",
      subjectId: "sender_agent_uuid",
      objectId: "recipient_agent_uuid",
      objectType: "agent",
      isActive: true,
      metadata: { centAmount: 500, note: "Thanks for the help" },
    },
    comment: {
      verb: "comment",
      subjectId: "person_agent_uuid",
      objectId: "recipient_agent_uuid",
      objectType: "agent",
      isActive: true,
      metadata: { kind: "direct-message", text: "Hey, are you coming to the event?", conversationId: "conv_uuid" },
    },
    rsvp: {
      verb: "react",
      subjectId: "person_agent_uuid",
      objectId: "event_agent_uuid",
      objectType: "agent",
      isActive: true,
      metadata: { interactionType: "rsvp", rsvpStatus: "going" },
    },
  },
};

// ─── INFRASTRUCTURE ─────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  "Core Infrastructure": { bg: "bg-slate-50", text: "text-slate-700", border: "border-slate-300" },
  "Read Flows": { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-300" },
  "Write Flows": { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-300" },
  "Auth & Account": { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-300" },
  "External Integrations": { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-300" },
};

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      out.push(...(await walk(full)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!EXTENSIONS.has(path.extname(entry.name))) continue;
    out.push(full);
  }
  return out;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(path.join(ROOT, filePath));
    return true;
  } catch {
    return false;
  }
}

async function scanKeyword(keyword: RegExp): Promise<Hit[]> {
  const files = await walk(SRC_ROOT);
  const hits: Hit[] = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const content = await readFile(file, "utf8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      if (!keyword.test(lines[i])) continue;
      hits.push({ file: rel, line: i + 1, snippet: lines[i].trim() });
      if (hits.length >= 400) return hits;
    }
  }
  return hits;
}

function classify(file: string): "api" | "actions" | "permissions" | "cache" | "hooks" | "transforms" | "renders" | "other" {
  if (file.includes("src/app/api/")) return "api";
  if (file.includes("src/app/actions/") || file.includes("src/lib/queries/")) return "actions";
  if (file.includes("permission") || file.includes("access") || file.includes("auth")) return "permissions";
  if (file.includes("local-db") || file.includes("local-storage")) return "cache";
  if (file.includes("hooks/") || file.includes("use-graph-data")) return "hooks";
  if (file.includes("adapter") || file.includes("serialize") || file.includes("normalize") || file.includes("mapper")) return "transforms";
  if (file.includes("/components/") || file.endsWith("/page.tsx")) return "renders";
  return "other";
}

async function flowStatus(flow: Flow): Promise<{ ok: number; total: number; missing: FlowCheck[] }> {
  const missing: FlowCheck[] = [];
  let ok = 0;
  for (const check of flow.checks) {
    const fileOk = await exists(check.file);
    if (!fileOk) {
      missing.push(check);
      continue;
    }
    const content = await readFile(path.join(ROOT, check.file), "utf8");
    if (content.includes(check.contains)) {
      ok += 1;
    } else {
      missing.push(check);
    }
  }
  return { ok, total: flow.checks.length, missing };
}

// ─── PAGE RENDER ────────────────────────────────────────────────────────────

export default async function GraphDevPanelPage() {
  const [agentsHits, resourcesHits, ledgerHits] = await Promise.all([
    scanKeyword(/\bagents\b/),
    scanKeyword(/\bresources\b/),
    scanKeyword(/\bledger\b/),
  ]);

  const allHits = [...agentsHits, ...resourcesHits, ...ledgerHits];
  const buckets: Record<string, number> = {
    api: 0,
    actions: 0,
    permissions: 0,
    cache: 0,
    hooks: 0,
    transforms: 0,
    renders: 0,
    other: 0,
  };

  for (const hit of allHits) {
    buckets[classify(hit.file)] += 1;
  }

  const evaluatedFlows = await Promise.all(
    FLOWS.map(async (flow) => ({ flow, status: await flowStatus(flow) }))
  );

  const categories = [...new Set(FLOWS.map((f) => f.category))];

  const totalChecks = evaluatedFlows.reduce((sum, { status }) => sum + status.total, 0);
  const passedChecks = evaluatedFlows.reduce((sum, { status }) => sum + status.ok, 0);

  const sampleHits = allHits.slice(0, 160);

  return (
    <div className="container max-w-7xl mx-auto p-4 pb-20 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Graph Trace Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          End-to-end trace of every data path: schema → endpoints → functions → pages. {FLOWS.length} flows tracked, {totalChecks} wiring checks.
        </p>
      </div>

      {/* ── Summary Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold">{FLOWS.length}</p>
            <p className="text-xs text-muted-foreground">Total Flows</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-emerald-600">{passedChecks}/{totalChecks}</p>
            <p className="text-xs text-muted-foreground">Checks Passing</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold">{allHits.length}</p>
            <p className="text-xs text-muted-foreground">Graph Touchpoints</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold">{categories.length}</p>
            <p className="text-xs text-muted-foreground">Flow Categories</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Coverage Snapshot ── */}
      <Card>
        <CardHeader>
          <CardTitle>Coverage by Layer</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge variant="outline">API routes: {buckets.api}</Badge>
          <Badge variant="outline">Actions / queries: {buckets.actions}</Badge>
          <Badge variant="outline">Permissions / auth: {buckets.permissions}</Badge>
          <Badge variant="outline">Cache / local DB: {buckets.cache}</Badge>
          <Badge variant="outline">Hooks: {buckets.hooks}</Badge>
          <Badge variant="outline">Transforms: {buckets.transforms}</Badge>
          <Badge variant="outline">Renders: {buckets.renders}</Badge>
          <Badge variant="outline">Other: {buckets.other}</Badge>
        </CardContent>
      </Card>

      {/* ── Template Inspector ── */}
      <GraphTemplateInspector templates={TEMPLATE_LIBRARY} />

      {/* ── System Flow Map ── */}
      <Card>
        <CardHeader>
          <CardTitle>System Flow Map</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Each row traces one data path from database tables → API endpoints → server functions → rendered pages.
            <span className="ml-2 inline-flex items-center gap-1"><span className="inline-block w-3 h-1.5 bg-emerald-500 rounded" /> = all checks pass</span>
            <span className="ml-2 inline-flex items-center gap-1"><span className="inline-block w-3 h-1.5 bg-red-500 rounded" /> = missing wiring</span>
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <div className="min-w-[1120px] space-y-2">
              {/* Column headers */}
              <div className="grid grid-cols-[230px_40px_230px_40px_230px_40px_230px] items-center gap-2 text-[11px] font-medium text-muted-foreground px-1 pb-2 border-b">
                <div>
                  <span className="font-semibold">Schema / Tables</span>
                  <br />
                  <span className="text-[10px] font-normal">Which DB tables are read or written</span>
                </div>
                <div className="text-center">→</div>
                <div>
                  <span className="font-semibold">API / Endpoint</span>
                  <br />
                  <span className="text-[10px] font-normal">REST routes or server action names</span>
                </div>
                <div className="text-center">→</div>
                <div>
                  <span className="font-semibold">Function / Query</span>
                  <br />
                  <span className="text-[10px] font-normal">Server-side functions that execute the logic</span>
                </div>
                <div className="text-center">→</div>
                <div>
                  <span className="font-semibold">Page / Render</span>
                  <br />
                  <span className="text-[10px] font-normal">Client pages or components that display data</span>
                </div>
              </div>

              {/* Flows grouped by category */}
              {categories.map((cat) => {
                const catFlows = evaluatedFlows.filter(({ flow }) => flow.category === cat);
                const catColors = CATEGORY_COLORS[cat] ?? { bg: "bg-muted", text: "text-foreground", border: "border-border" };
                const catPassed = catFlows.reduce((s, { status }) => s + status.ok, 0);
                const catTotal = catFlows.reduce((s, { status }) => s + status.total, 0);

                return (
                  <div key={cat}>
                    {/* Category header */}
                    <div className={`flex items-center justify-between rounded-t px-3 py-2 mt-4 border ${catColors.border} ${catColors.bg}`}>
                      <span className={`text-sm font-semibold ${catColors.text}`}>{cat}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{catFlows.length} flows</span>
                        <Badge variant={catPassed === catTotal ? "default" : "destructive"} className="text-[10px]">
                          {catPassed}/{catTotal}
                        </Badge>
                      </div>
                    </div>

                    {/* Flows in this category */}
                    <div className="border-x border-b rounded-b divide-y">
                      {catFlows.map(({ flow, status }) => {
                        const complete = status.ok === status.total;
                        const lineTone = complete ? "bg-emerald-500" : "bg-red-500";
                        const nodeTone = complete ? "border-emerald-200 bg-emerald-50/50" : "border-red-200 bg-red-50/50";
                        return (
                          <div key={`map-${flow.id}`} className="p-3">
                            <div className="mb-1.5 flex items-center justify-between gap-2">
                              <div>
                                <span className="text-sm font-medium">{flow.label}</span>
                                <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">{flow.description}</p>
                              </div>
                              <Badge variant={complete ? "default" : "destructive"} className="shrink-0">
                                {status.ok}/{status.total}
                              </Badge>
                            </div>
                            <div className="grid grid-cols-[230px_40px_230px_40px_230px_40px_230px] items-center gap-2">
                              <div className={`rounded border p-2 text-[11px] leading-tight ${nodeTone}`}>
                                {flow.objectRows.length > 0 ? flow.objectRows.join(" · ") : "—"}
                              </div>
                              <div className={`h-0.5 w-full ${lineTone}`} />
                              <div className={`rounded border p-2 text-[11px] leading-tight ${nodeTone}`}>
                                {flow.endpoints.length > 0 ? flow.endpoints.join(" · ") : "—"}
                              </div>
                              <div className={`h-0.5 w-full ${lineTone}`} />
                              <div className={`rounded border p-2 text-[11px] leading-tight ${nodeTone}`}>
                                {flow.functions.length > 0 ? flow.functions.join(" · ") : "—"}
                              </div>
                              <div className={`h-0.5 w-full ${lineTone}`} />
                              <div className={`rounded border p-2 text-[11px] leading-tight ${nodeTone}`}>
                                {flow.pages.length > 0 ? flow.pages.join(" · ") : "—"}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Flow Wiring Status (detailed) ── */}
      <Card>
        <CardHeader>
          <CardTitle>Flow Wiring Status</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Each check verifies a specific string exists in a specific file. Red = file missing or string not found.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {categories.map((cat) => {
            const catFlows = evaluatedFlows.filter(({ flow }) => flow.category === cat);
            const catColors = CATEGORY_COLORS[cat] ?? { bg: "bg-muted", text: "text-foreground", border: "border-border" };
            return (
              <div key={`wiring-${cat}`}>
                <div className={`px-3 py-1.5 rounded-t border ${catColors.border} ${catColors.bg} mt-3`}>
                  <span className={`text-xs font-semibold ${catColors.text}`}>{cat}</span>
                </div>
                <div className="border-x border-b rounded-b divide-y">
                  {catFlows.map(({ flow, status }) => {
                    const complete = status.ok === status.total;
                    return (
                      <div key={flow.id} className="px-3 py-2 space-y-1">
                        <div className="flex items-center justify-between gap-4">
                          <div className="font-medium text-sm">{flow.label}</div>
                          <Badge variant={complete ? "default" : "destructive"} className="text-[10px]">
                            {status.ok}/{status.total} checks
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
                          <span>Tables: {flow.objectRows.length > 0 ? flow.objectRows.join(", ") : "—"}</span>
                          <span>Endpoints: {flow.endpoints.length > 0 ? flow.endpoints.join(", ") : "—"}</span>
                          <span>Functions: {flow.functions.length > 0 ? flow.functions.join(", ") : "—"}</span>
                          <span>Pages: {flow.pages.length > 0 ? flow.pages.join(", ") : "—"}</span>
                        </div>
                        {!complete && (
                          <div className="text-[11px] text-red-600 mt-1">
                            Missing: {status.missing.map((m) => `${m.file} → "${m.contains}"`).join(" | ")}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* ── Discovered Graph Touchpoints ── */}
      <Card>
        <CardHeader>
          <CardTitle>Discovered Graph Touchpoints</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Source code scan for &quot;agents&quot;, &quot;resources&quot;, and &quot;ledger&quot; keywords across all .ts/.tsx files. Showing {sampleHits.length} of {allHits.length} hits.
          </p>
        </CardHeader>
        <CardContent>
          <div className="max-h-[560px] overflow-auto rounded border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th className="text-left p-2">Layer</th>
                  <th className="text-left p-2">File</th>
                  <th className="text-left p-2">Line</th>
                  <th className="text-left p-2">Snippet</th>
                </tr>
              </thead>
              <tbody>
                {sampleHits.map((hit, idx) => (
                  <tr key={`${hit.file}-${hit.line}-${idx}`} className="border-t align-top">
                    <td className="p-2">
                      <Badge variant="outline" className="text-[10px]">{classify(hit.file)}</Badge>
                    </td>
                    <td className="p-2 font-mono">{hit.file}</td>
                    <td className="p-2">{hit.line}</td>
                    <td className="p-2 font-mono max-w-md truncate">{hit.snippet}</td>
                  </tr>
                ))}
                {sampleHits.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-4 text-center text-muted-foreground">No touchpoints found</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
