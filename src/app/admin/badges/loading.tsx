import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader } from "@/components/ui/card"

export default function AdminBadgesLoading() {
  return (
    <div className="container max-w-6xl mx-auto p-4 pb-20">
      {/* Header with button */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <Skeleton className="h-9 w-52 mb-2" />
          <Skeleton className="h-5 w-56" />
        </div>
        <Skeleton className="h-10 w-32 rounded-md" />
      </div>

      {/* Tabs */}
      <div className="space-y-4">
        <Skeleton className="h-10 w-full rounded-md" />

        {/* Manage tab content: Users list + Badge panel */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Users sidebar */}
          <div className="md:col-span-1">
            <Card>
              <CardHeader>
                <Skeleton className="h-6 w-16" />
              </CardHeader>
              <CardContent className="space-y-2 p-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-2">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div>
                      <Skeleton className="h-4 w-24 mb-1" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Badge panel placeholder */}
          <div className="md:col-span-2">
            <Card>
              <CardContent className="p-6 text-center">
                <Skeleton className="h-12 w-12 mx-auto rounded-full mb-2" />
                <Skeleton className="h-4 w-52 mx-auto" />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
