import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent } from "@/components/ui/card"

export default function AdminTasksLoading() {
  return (
    <div className="container max-w-4xl mx-auto p-4 pb-20">
      {/* Header with badge */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <Skeleton className="h-9 w-64 mb-2" />
          <Skeleton className="h-5 w-72" />
        </div>
        <Skeleton className="h-10 w-56 rounded-md" />
      </div>

      {/* Tabs */}
      <div className="space-y-4">
        <Skeleton className="h-10 w-full rounded-md" />

        {/* Task cards */}
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="mb-4">
            <CardContent className="p-4">
              {/* User row + badge */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div>
                    <Skeleton className="h-4 w-28 mb-1" />
                    <Skeleton className="h-3 w-36" />
                  </div>
                </div>
                <Skeleton className="h-6 w-32 rounded-full" />
              </div>

              {/* Task title + description */}
              <div className="mb-3">
                <Skeleton className="h-5 w-48 mb-2" />
                <Skeleton className="h-4 w-full" />
              </div>

              {/* Job + Project grid */}
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div>
                  <Skeleton className="h-3 w-8 mb-1" />
                  <Skeleton className="h-4 w-32" />
                </div>
                <div>
                  <Skeleton className="h-3 w-14 mb-1" />
                  <Skeleton className="h-4 w-28" />
                </div>
              </div>

              {/* Points + time + actions */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-20" />
                </div>
                <div className="flex gap-2">
                  <Skeleton className="h-8 w-20 rounded-md" />
                  <Skeleton className="h-8 w-24 rounded-md" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
