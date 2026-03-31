/**
 * Basins index page.
 *
 * Route: `/basins`
 * Purpose: Displays all river basins, supports client-side search, and surfaces per-basin
 * community/member aggregates computed from locale data.
 * Data requirements: `useLocalesAndBasins()` must provide `basins` and `locales`.
 * Rendering: Client-rendered (`"use client"`), so no server metadata export is defined here.
 */
// app/(main)/basins/page.tsx
"use client"
import { useState } from "react"
import { useLocalesAndBasins } from "@/lib/hooks/use-graph-data"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Search, Waves, Users, Building2, Plus, ChevronRight } from "lucide-react"
import Link from "next/link"
import Image from "next/image"

/**
 * Renders the basin listing page with search and computed basin statistics.
 *
 * @returns Basin cards grouped in a responsive grid, plus an empty-state when no results match.
 */
export default function BasinsPage() {
  const [searchQuery, setSearchQuery] = useState("")
  // Client-side hook fetches the graph-backed basin/locale datasets for rendering.
  const { data: { basins, locales } } = useLocalesAndBasins()

  // Compute locale counts and total members per basin
  const basinStats = basins.reduce((acc, basin) => {
    const basinLocales = locales.filter(l => l.basinId === basin.id)
    const totalMembers = basinLocales.reduce((sum, l) => sum + (l.memberCount || 0), 0)
    acc[basin.id] = { localeCount: basinLocales.length, totalMembers }
    return acc
  }, {} as Record<string, { localeCount: number; totalMembers: number }>)

  // Client-side filtering updates immediately as the user types in the search input.
  const filteredBasins = basins.filter(basin =>
    basin.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    basin.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    basin.huc6Code.includes(searchQuery)
  )

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">River Basins</h1>
          <p className="text-muted-foreground mt-1">
            Bioregional watersheds organizing communities across the network
          </p>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Request New Basin
        </Button>
      </div>

      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search basins by name or HUC code..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredBasins.map((basin) => {
          const stats = basinStats[basin.id] || { localeCount: 0, totalMembers: 0 }

          return (
            // Navigation to a specific basin is handled via client-side Next.js routing.
            <Link href={`/basins/${basin.id}`} key={basin.id}>
              <Card className="h-full hover:shadow-lg transition-shadow cursor-pointer overflow-hidden">
                {/* Conditionally render basin imagery and HUC badge only when media exists. */}
                {basin.image && (
                  <div className="relative h-40 w-full">
                    <Image
                      src={basin.image}
                      alt={basin.name}
                      fill
                      className="object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                    <div className="absolute bottom-3 left-3">
                      <Badge variant="secondary" className="bg-blue-500/20 text-white border-blue-300 backdrop-blur-sm">
                        HUC-6: {basin.huc6Code}
                      </Badge>
                    </div>
                  </div>
                )}
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Waves className="h-5 w-5 text-blue-500" />
                    <h3 className="font-semibold text-lg">{basin.name}</h3>
                    <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto" />
                  </div>
                  {/* Conditionally show descriptions to avoid rendering empty text blocks. */}
                  {basin.description && (
                    <p className="text-sm text-muted-foreground mb-3">{basin.description}</p>
                  )}
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Building2 className="h-4 w-4" />
                      {stats.localeCount} {stats.localeCount === 1 ? "community" : "communities"}
                    </div>
                    <div className="flex items-center gap-1">
                      <Users className="h-4 w-4" />
                      {stats.totalMembers.toLocaleString()} members
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>

      {/* Empty-state conditional rendering when no basin matches the search query. */}
      {filteredBasins.length === 0 && (
        <div className="text-center py-12">
          <Waves className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold mb-2">No basins found</h3>
          <p className="text-muted-foreground">Try adjusting your search terms.</p>
        </div>
      )}
    </div>
  )
}
