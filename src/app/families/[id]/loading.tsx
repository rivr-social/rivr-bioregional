import { Skeleton } from "@/components/ui/skeleton"

export default function FamilyLoading() {
  return (
    <div className="container max-w-5xl mx-auto px-4 py-6 space-y-4">
      <Skeleton className="h-5 w-32" />

      {/* Family header card */}
      <div className="rounded-lg border">
        <div className="p-6 space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="p-6 pt-0 space-y-4">
          <Skeleton className="h-10 w-full" />
          <div className="flex flex-wrap gap-4">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />

      {/* Tab content */}
      <div className="rounded-lg border p-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4 mt-2" />
      </div>
    </div>
  )
}
