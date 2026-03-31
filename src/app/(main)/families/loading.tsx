import { Skeleton } from "@/components/ui/skeleton"

export default function FamiliesLoading() {
  return (
    <div className="container max-w-4xl mx-auto px-4 py-6">
      <Skeleton className="h-8 w-36 mb-6" />
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[160px] w-full rounded-lg" />
        ))}
      </div>
    </div>
  )
}
