import { getShifts, getProjects } from "@/lib/queries/resources"
import { fetchAgentDisplayMap } from "@/app/actions/admin"
import { AdminTasks } from "./admin-tasks"

export default async function AdminTasksPage() {
  const [jobShifts, projects] = await Promise.all([
    getShifts(),
    getProjects(),
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
    <AdminTasks
      jobShifts={jobShifts}
      projects={projects}
      agentDisplayMap={agentDisplayMap}
    />
  )
}
