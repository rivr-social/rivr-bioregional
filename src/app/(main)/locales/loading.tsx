import { Skeleton } from "@/components/ui/skeleton"

export default function LocalesLoading() {
  return (
    <div className="container mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <Skeleton className="h-9 w-52" />
        <Skeleton className="h-10 w-44" />
      </div>

      <div className="mb-6">
        <Skeleton className="h-10 w-full" />
      </div>

      {/* Basin group */}
      <div className="mb-8">
        <Skeleton className="h-8 w-48 mb-4 border-b pb-2" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-12" />
              </div>
              <Skeleton className="h-32 w-full rounded-lg" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-40" />
            </div>
          ))}
        </div>
      </div>

      {/* Second basin group */}
      <div className="mb-8">
        <Skeleton className="h-8 w-56 mb-4 border-b pb-2" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-12" />
              </div>
              <Skeleton className="h-32 w-full rounded-lg" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-40" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
