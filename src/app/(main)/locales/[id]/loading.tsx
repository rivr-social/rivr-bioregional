import { Skeleton } from "@/components/ui/skeleton"

export default function LocaleDetailLoading() {
  return (
    <div className="container mx-auto px-4 py-6">
      <div className="animate-pulse space-y-4">
        <Skeleton className="h-48 w-full rounded-lg" />
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-24 w-full rounded" />
      </div>
    </div>
  )
}
