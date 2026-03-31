import { Skeleton } from "@/components/ui/skeleton"

export default function BasinDetailLoading() {
  return (
    <div className="container max-w-4xl mx-auto px-4 py-6">
      <div className="animate-pulse space-y-4">
        <Skeleton className="h-48 w-full rounded-lg" />
        <Skeleton className="h-8 w-1/3" />
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  )
}
