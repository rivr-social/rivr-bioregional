"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Shield, CheckSquare, Users, AlertCircle, CheckCircle, Clock } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"
import type { JobShift, UserBadge } from "@/types/domain"

interface AdminDashboardProps {
  jobShifts: JobShift[]
  badges: UserBadge[]
  totalUsers: number
  agentDisplayMap: Record<string, { name: string; image: string | null }>
}

/**
 * Client-rendered admin dashboard component.
 *
 * @returns Dashboard with stat cards, recent activity, and quick-action links.
 */
export function AdminDashboard({ jobShifts, badges, totalUsers, agentDisplayMap }: AdminDashboardProps) {
  const [stats, setStats] = useState({
    tasksAwaitingApproval: 0,
    completedTasks: 0,
    totalUsers,
    totalBadges: 0,
    recentActivity: [] as { type: string; taskName: string; userName: string; timestamp: Date }[]
  })

  useEffect(() => {
    // Calculate dashboard statistics
    let awaitingApproval = 0
    let completed = 0
    const recentActivity: { type: string; taskName: string; userName: string; timestamp: Date }[] = []

    jobShifts.forEach(job => {
      job.tasks.forEach(task => {
        if (task.status === "awaiting_approval") {
          awaitingApproval++

          // Add to recent activity
          if (task.assignedTo) {
            recentActivity.push({
              type: "task_awaiting",
              taskName: task.name,
              userName: getAssigneeName(task.assignedTo),
              timestamp: new Date(Date.now() - Math.random() * 86400000 * 3) // Random time in the last 3 days
            })
          }
        }
        if (task.status === "completed") {
          completed++

          // Add some completed tasks to recent activity
          if (task.assignedTo && Math.random() > 0.7) {
            recentActivity.push({
              type: "task_completed",
              taskName: task.name,
              userName: getAssigneeName(task.assignedTo),
              timestamp: new Date(Date.now() - Math.random() * 86400000 * 2) // Random time in the last 2 days
            })
          }
        }
      })
    })

    // Sort activity by timestamp (newest first)
    recentActivity.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

    setStats({
      tasksAwaitingApproval: awaitingApproval,
      completedTasks: completed,
      totalUsers,
      totalBadges: badges.length,
      recentActivity: recentActivity.slice(0, 5) // Show only the 5 most recent activities
    })
  }, [jobShifts, badges, totalUsers])

  /** Resolves a user ID to a display name using the agent display map from the DB. */
  const getAssigneeName = (userId: string) => {
    return agentDisplayMap[userId]?.name ?? "Unknown User"
  }

  /** Formats a Date into a human-readable relative time string (e.g., "3 hours ago"). */
  const formatTimeAgo = (date: Date) => {
    const now = new Date()
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)

    if (diffInSeconds < 60) return `${diffInSeconds} seconds ago`
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} minutes ago`
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hours ago`
    return `${Math.floor(diffInSeconds / 86400)} days ago`
  }

  /** Returns the appropriate icon component for a given activity type. */
  const getActivityIcon = (type: string) => {
    switch (type) {
      case "task_awaiting":
        return <AlertCircle className="h-5 w-5 text-yellow-500" />
      case "task_completed":
        return <CheckCircle className="h-5 w-5 text-green-500" />
      default:
        return <Clock className="h-5 w-5 text-gray-500" />
    }
  }

  /** Renders a descriptive text node for an activity entry in the feed. */
  const getActivityText = (activity: { type: string; taskName: string; userName: string; timestamp: Date }) => {
    switch (activity.type) {
      case "task_awaiting":
        return (
          <span>
            <span className="font-medium">{activity.userName}</span> submitted task{" "}
            <span className="font-medium">&quot;{activity.taskName}&quot;</span> for approval
          </span>
        )
      case "task_completed":
        return (
          <span>
            <span className="font-medium">{activity.userName}</span> completed task{" "}
            <span className="font-medium">&quot;{activity.taskName}&quot;</span>
          </span>
        )
      default:
        return <span>Unknown activity</span>
    }
  }

  return (
    <div className="container max-w-6xl mx-auto p-4 pb-20">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Admin Dashboard</h1>
        <p className="text-gray-600">Manage your community platform</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Link href="/admin/tasks">
          <Card className="hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold">{stats.tasksAwaitingApproval}</p>
                  <p className="text-sm text-gray-600">Tasks Awaiting Approval</p>
                </div>
                <div className="p-3 bg-yellow-100 rounded-full">
                  <AlertCircle className="h-6 w-6 text-yellow-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{stats.completedTasks}</p>
                <p className="text-sm text-gray-600">Completed Tasks</p>
              </div>
              <div className="p-3 bg-green-100 rounded-full">
                <CheckCircle className="h-6 w-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Link href="/admin/badges">
          <Card className="hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold">{stats.totalBadges}</p>
                  <p className="text-sm text-gray-600">Total Badges</p>
                </div>
                <div className="p-3 bg-blue-100 rounded-full">
                  <Shield className="h-6 w-6 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>Latest actions requiring your attention</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {stats.recentActivity.map((activity, index) => (
                  <div key={index} className="flex items-start gap-3">
                    <div className="mt-0.5">
                      {getActivityIcon(activity.type)}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm">{getActivityText(activity)}</p>
                      <p className="text-xs text-gray-500">{formatTimeAgo(activity.timestamp)}</p>
                    </div>
                  </div>
                ))}
                {stats.recentActivity.length === 0 && (
                  <p className="text-sm text-gray-500">No recent activity</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>Common administrative tasks</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link href="/admin/badges">
                <div className="flex items-center gap-3 p-3 rounded-md hover:bg-muted cursor-pointer">
                  <Shield className="h-5 w-5 text-blue-500" />
                  <div>
                    <p className="font-medium">Manage Badges</p>
                    <p className="text-xs text-gray-600">Assign badges to users</p>
                  </div>
                </div>
              </Link>
              <Link href="/admin/tasks">
                <div className="flex items-center gap-3 p-3 rounded-md hover:bg-muted cursor-pointer">
                  <CheckSquare className="h-5 w-5 text-green-500" />
                  <div>
                    <p className="font-medium">Review Tasks</p>
                    <p className="text-xs text-gray-600">Approve or reject completed tasks</p>
                  </div>
                </div>
              </Link>
              <Link href="/admin/users">
                <div className="flex items-center gap-3 p-3 rounded-md hover:bg-muted cursor-pointer">
                  <Users className="h-5 w-5 text-purple-500" />
                  <div>
                    <p className="font-medium">User Management</p>
                    <p className="text-xs text-gray-600">View and manage users</p>
                  </div>
                </div>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
