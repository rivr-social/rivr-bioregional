/**
 * Admin user management page for `/admin/users`.
 *
 * Purpose:
 * - Lists all platform users with search, status toggling (active/inactive),
 *   and links to profile and badge management.
 *
 * Rendering: Server Component (fetches data) wrapping a client component for interactivity.
 * Data requirements:
 * - Fetches real agent records from the database via admin server actions.
 *
 * Auth: No explicit server-side auth gate; admin layout may enforce access.
 * Metadata: No `metadata` export; metadata is inherited from the layout.
 *
 * @module admin/users/page
 */
import { fetchAdminUsers } from "@/app/actions/admin"
import { AdminUsersClient } from "./admin-users-client"

export default async function AdminUsersPage() {
  const users = await fetchAdminUsers()
  return <AdminUsersClient initialUsers={users} />
}
