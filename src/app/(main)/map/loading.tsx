/**
 * Instant loading skeleton for the map page.
 * Next.js serves this immediately while the actual page (with Cesium) compiles.
 */
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

export default function MapLoading() {
  return (
    <div className="h-[calc(100dvh-8rem)] overflow-hidden flex flex-col">
      <div className="p-3 border-b flex flex-col gap-2 shrink-0 bg-card">
        <h1 className="text-xl font-bold">Map</h1>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search locations..." className="pl-9" disabled />
          </div>
        </div>

        <Tabs defaultValue="all" className="w-full">
          <TabsList className="grid grid-cols-5">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="groups">Groups</TabsTrigger>
            <TabsTrigger value="posts">Posts</TabsTrigger>
            <TabsTrigger value="offerings">Offerings</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap gap-1 pt-1">
          <Button variant="outline" size="sm" className="h-7 px-3 text-xs" disabled>
            Terrain
          </Button>
          <Button variant="outline" size="sm" className="h-7 px-3 text-xs" disabled>
            Buildings
          </Button>
          <Button variant="outline" size="sm" className="h-7 px-3 text-xs" disabled>
            Item Labels
          </Button>
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        <div className="h-full w-full flex items-center justify-center bg-gray-100 dark:bg-zinc-900">
          <div className="animate-pulse flex flex-col items-center">
            <div className="h-10 w-10 bg-gray-300 dark:bg-zinc-700 rounded-full mb-3" />
            <div className="h-4 w-40 bg-gray-300 dark:bg-zinc-700 rounded mb-2" />
            <p className="text-sm text-muted-foreground">Loading map...</p>
          </div>
        </div>
      </div>
    </div>
  )
}
