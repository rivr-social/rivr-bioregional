/**
 * Admin dashboard page for `/admin`.
 *
 * Purpose:
 * - Displays platform-level statistics (pending approvals, completed tasks, total badges)
 *   and a recent activity feed. Provides quick-action links to badge, task, and user management.
 *
 * Rendering: Server Component (fetches data) wrapping a client component for interactivity.
 * Data requirements:
 * - Fetches shifts, badges, user count, and agent display info from the database.
 *
 * Auth: No explicit server-side auth gate; admin layout may enforce access.
 * Metadata: No `metadata` export; metadata is inherited from the layout.
 *
 * @module admin/page
 */
import { getShifts, getBadgeDefinitions } from "@/lib/queries/resources"
import { fetchTotalUserCount, fetchAgentDisplayMap } from "@/app/actions/admin"
import { AdminDashboard } from "./admin-dashboard"

export default async function AdminDashboardPage() {
  const [jobShifts, badges, totalUsers] = await Promise.all([
    getShifts(),
    getBadgeDefinitions(),
    fetchTotalUserCount(),
  ])

  // Collect all assignee IDs from tasks across all shifts
  const assigneeIds = new Set<string>()
  for (const shift of jobShifts) {
    for (const task of shift.tasks) {
      if (task.assignedTo) assigneeIds.add(task.assignedTo)
    }
  }

  const agentDisplayMap = await fetchAgentDisplayMap(Array.from(assigneeIds))

  return (
    <AdminDashboard
      jobShifts={jobShifts}
      badges={badges}
      totalUsers={totalUsers}
      agentDisplayMap={agentDisplayMap}
    />
  )
}
