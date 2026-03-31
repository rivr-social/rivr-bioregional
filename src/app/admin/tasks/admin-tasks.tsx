"use client"

import { useState, useMemo, useTransition } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { CheckCircle, XCircle, AlertCircle, Clock, Star } from "lucide-react"
import Link from "next/link"
import { toast } from "@/components/ui/use-toast"
import { approveTaskAction, rejectTaskAction } from "@/app/actions/admin"
import type { JobShift, ProjectRecord } from "@/types/domain"

interface TaskWithDetails {
  id: string
  name: string
  description: string
  points: number
  completed: boolean
  status: string
  assignedTo?: string
  estimatedTime: string
  jobId: string
  jobTitle: string
  assigneeName: string
  assigneeAvatar: string | null
  projectId: string | null
  projectTitle: string
}

interface AdminTasksProps {
  jobShifts: JobShift[]
  projects: ProjectRecord[]
  agentDisplayMap: Record<string, { name: string; image: string | null }>
}

export function AdminTasks({ jobShifts, projects, agentDisplayMap }: AdminTasksProps) {
  const [activeTab, setActiveTab] = useState("awaiting")
  const [isPending, startTransition] = useTransition()

  /** Resolves an agent ID to a display name using real DB data. */
  const getAssigneeName = (userId: string) => {
    return agentDisplayMap[userId]?.name ?? "Unknown User"
  }

  /** Resolves an agent ID to an avatar URL using real DB data. */
  const getAssigneeAvatar = (userId: string) => {
    return agentDisplayMap[userId]?.image ?? null
  }

  // Pre-compute categorized tasks
  const computeTaskCategories = useMemo(() => {
    const getProjectIdForJob = (jobId: string) => {
      const project = projects.find(p => p.jobs && p.jobs.includes(jobId))
      return project ? project.id : null
    }

    const getProjectTitleForJob = (jobId: string) => {
      const project = projects.find(p => p.jobs && p.jobs.includes(jobId))
      return project ? project.title : "No Project"
    }

    const awaitingTasks: TaskWithDetails[] = []
    const approvedTasks: TaskWithDetails[] = []
    const rejectedTasks: TaskWithDetails[] = []

    jobShifts.forEach(job => {
      job.tasks.forEach(task => {
        if (task.assignedTo) {
          const taskWithDetails = {
            ...task,
            jobId: job.id,
            jobTitle: job.title,
            assigneeName: getAssigneeName(task.assignedTo),
            assigneeAvatar: getAssigneeAvatar(task.assignedTo),
            projectId: getProjectIdForJob(job.id),
            projectTitle: getProjectTitleForJob(job.id)
          }

          if (task.status === "awaiting_approval") {
            awaitingTasks.push(taskWithDetails)
          } else if (task.status === "completed" && task.assignedTo) {
            approvedTasks.push(taskWithDetails)
          } else if (task.status === "rejected" && task.assignedTo) {
            rejectedTasks.push(taskWithDetails)
          }
        }
      })
    })

    return { awaitingTasks, approvedTasks, rejectedTasks }
  }, [jobShifts, projects, agentDisplayMap])

  // Initialize tasks (computed once)
  const [tasksAwaitingApproval, setTasksAwaitingApproval] = useState<TaskWithDetails[]>(() => computeTaskCategories.awaitingTasks)

  // Derived read-only task lists
  const recentlyApproved = useMemo(() => computeTaskCategories.approvedTasks.slice(0, 10), [computeTaskCategories])
  const recentlyRejected = useMemo(() => computeTaskCategories.rejectedTasks.slice(0, 10), [computeTaskCategories])

  const handleApproveTask = (taskId: string, jobId: string) => {
    // Optimistic removal
    setTasksAwaitingApproval(prev => prev.filter(task => !(task.id === taskId && task.jobId === jobId)))

    startTransition(async () => {
      const result = await approveTaskAction(taskId, jobId)
      if (result.success) {
        toast({
          title: "Task approved",
          description: "The task has been marked as completed",
        })
      } else {
        toast({
          title: "Error approving task",
          description: result.message,
          variant: "destructive",
        })
      }
    })
  }

  const handleRejectTask = (taskId: string, jobId: string) => {
    // Optimistic removal
    setTasksAwaitingApproval(prev => prev.filter(task => !(task.id === taskId && task.jobId === jobId)))

    startTransition(async () => {
      const result = await rejectTaskAction(taskId, jobId)
      if (result.success) {
        toast({
          title: "Task rejected",
          description: "The task has been rejected and returned to the assignee",
        })
      } else {
        toast({
          title: "Error rejecting task",
          description: result.message,
          variant: "destructive",
        })
      }
    })
  }

  const renderTaskCard = (task: TaskWithDetails, showActions: boolean = false) => {
    return (
      <Card key={`${task.jobId}-${task.id}`} className="mb-4">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10">
                <AvatarImage src={task.assigneeAvatar ?? undefined} alt={task.assigneeName} />
                <AvatarFallback>{task.assigneeName.charAt(0)}</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-medium">{task.assigneeName}</p>
                <p className="text-xs text-gray-600">Submitted for approval</p>
              </div>
            </div>
            <Badge className="bg-yellow-100 text-yellow-800">
              <AlertCircle className="h-3 w-3 mr-1" />
              Awaiting Approval
            </Badge>
          </div>

          <div className="mb-3">
            <h3 className="font-medium text-lg">{task.name}</h3>
            <p className="text-sm text-gray-600">{task.description}</p>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-4">
            <div>
              <p className="text-xs text-gray-500">Job</p>
              <Link href={`/jobs/${task.jobId}`} className="text-sm text-blue-600 hover:underline">
                {task.jobTitle}
              </Link>
            </div>
            <div>
              <p className="text-xs text-gray-500">Project</p>
              {task.projectId ? (
                <Link href={`/projects/${task.projectId}`} className="text-sm text-blue-600 hover:underline">
                  {task.projectTitle}
                </Link>
              ) : (
                <span className="text-sm">No Project</span>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1">
                <Star className="h-4 w-4 text-yellow-500" />
                <span className="text-sm">{task.points} points</span>
              </div>
              <div className="flex items-center gap-1">
                <Clock className="h-4 w-4 text-gray-500" />
                <span className="text-sm text-gray-600">{task.estimatedTime}</span>
              </div>
            </div>

            {showActions && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600 border-red-200 hover:bg-red-50"
                  disabled={isPending}
                  onClick={() => handleRejectTask(task.id, task.jobId)}
                >
                  <XCircle className="h-4 w-4 mr-1" />
                  Reject
                </Button>
                <Button
                  size="sm"
                  className="bg-green-600 hover:bg-green-700"
                  disabled={isPending}
                  onClick={() => handleApproveTask(task.id, task.jobId)}
                >
                  <CheckCircle className="h-4 w-4 mr-1" />
                  Approve
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="container max-w-4xl mx-auto p-4 pb-20">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Task Approval Dashboard</h1>
          <p className="text-gray-600">Review and manage tasks awaiting approval</p>
        </div>
        <div className="flex items-center gap-2 bg-yellow-50 text-yellow-800 px-3 py-2 rounded-md">
          <AlertCircle className="h-5 w-5" />
          <span className="font-medium">{tasksAwaitingApproval.length} Tasks Awaiting Approval</span>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="awaiting">Awaiting Approval</TabsTrigger>
          <TabsTrigger value="approved">Recently Approved</TabsTrigger>
          <TabsTrigger value="rejected">Recently Rejected</TabsTrigger>
        </TabsList>

        <TabsContent value="awaiting" className="space-y-4">
          {tasksAwaitingApproval.length > 0 ? (
            tasksAwaitingApproval.map(task => renderTaskCard(task, true))
          ) : (
            <Card>
              <CardContent className="p-6 text-center">
                <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-2" />
                <p className="text-gray-600">No tasks awaiting approval</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="approved" className="space-y-4">
          {recentlyApproved.length > 0 ? (
            recentlyApproved.map(task => (
              <Card key={`${task.jobId}-${task.id}`} className="mb-4">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={task.assigneeAvatar ?? undefined} alt={task.assigneeName} />
                        <AvatarFallback>{task.assigneeName.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{task.assigneeName}</p>
                        <p className="text-xs text-gray-600">Task completed</p>
                      </div>
                    </div>
                    <Badge className="bg-green-100 text-green-800">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Approved
                    </Badge>
                  </div>

                  <div className="mb-3">
                    <h3 className="font-medium text-lg">{task.name}</h3>
                    <p className="text-sm text-gray-600">{task.description}</p>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1">
                      <Star className="h-4 w-4 text-yellow-500" />
                      <span className="text-sm">{task.points} points</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4 text-gray-500" />
                      <span className="text-sm text-gray-600">{task.estimatedTime}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : (
            <Card>
              <CardContent className="p-6 text-center">
                <p className="text-gray-600">No recently approved tasks</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="rejected" className="space-y-4">
          {recentlyRejected.length > 0 ? (
            recentlyRejected.map(task => (
              <Card key={`${task.jobId}-${task.id}`} className="mb-4">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={task.assigneeAvatar ?? undefined} alt={task.assigneeName} />
                        <AvatarFallback>{task.assigneeName.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{task.assigneeName}</p>
                        <p className="text-xs text-gray-600">Task rejected</p>
                      </div>
                    </div>
                    <Badge className="bg-red-100 text-red-800">
                      <XCircle className="h-3 w-3 mr-1" />
                      Rejected
                    </Badge>
                  </div>

                  <div className="mb-3">
                    <h3 className="font-medium text-lg">{task.name}</h3>
                    <p className="text-sm text-gray-600">{task.description}</p>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1">
                      <Star className="h-4 w-4 text-yellow-500" />
                      <span className="text-sm">{task.points} points</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4 text-gray-500" />
                      <span className="text-sm text-gray-600">{task.estimatedTime}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : (
            <Card>
              <CardContent className="p-6 text-center">
                <p className="text-gray-600">No recently rejected tasks</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
