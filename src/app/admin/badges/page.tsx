/**
 * Admin badge management page for `/admin/badges`.
 *
 * Purpose:
 * - Allows admins to assign/remove badges from users, view all available badges,
 *   and create new badge definitions.
 *
 * Rendering: Server Component (fetches data) wrapping a client component for interactivity.
 * Data requirements:
 * - Fetches badge definitions, real user agents, and user badge assignments from the database.
 *
 * Auth: No explicit server-side auth gate; admin layout may enforce access.
 * Metadata: No `metadata` export; metadata is inherited from the layout.
 *
 * @module admin/badges/page
 */
import { getBadgeDefinitions, getUserBadgeIds } from "@/lib/queries/resources"
import { fetchAdminUsers } from "@/app/actions/admin"
import { AdminBadges } from "./admin-badges"

export default async function AdminBadgesPage() {
  const [allBadges, adminUsers] = await Promise.all([
    getBadgeDefinitions(),
    fetchAdminUsers(),
  ])

  // Build user list for badge management from real agents
  const badgeUsers = adminUsers
    .filter((u) => u.status === "active")
    .slice(0, 50)
    .map((u) => ({
      id: u.id,
      name: u.name,
      image: u.image,
      type: u.type,
    }))

  // Fetch badge assignments for each user
  const userBadgeEntries = await Promise.all(
    badgeUsers.map(async (user) => {
      const badgeIds = await getUserBadgeIds(user.id)
      return [user.id, badgeIds] as const
    })
  )
  const userBadgeMap = Object.fromEntries(userBadgeEntries)

  return (
    <AdminBadges
      allBadges={allBadges}
      userBadgeMap={userBadgeMap}
      users={badgeUsers}
    />
  )
}
