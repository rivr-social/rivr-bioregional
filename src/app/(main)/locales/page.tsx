/**
 * Locales index page.
 *
 * Route: `/locales`
 * Purpose: Lists locales grouped by basin, with client-side search filtering.
 * Data requirements: `useLocalesAndBasins()` must provide `locales` and `basins` to build
 * basin groupings and labels.
 * Rendering: Client-rendered (`"use client"`); this file does not export route metadata.
 */
// app/(main)/locales/page.tsx
"use client"
import { useState } from "react"
import { useLocalesAndBasins } from "@/lib/hooks/use-graph-data"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Search, MapPin, Users, Plus, Star, ChevronRight } from "lucide-react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import Link from "next/link"

/**
 * Renders searchable locale cards organized under basin headings.
 *
 * @returns Grouped locale listing UI and a no-results empty state.
 */
export default function LocalesPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const _router = useRouter()
  // Client-side hook fetches all locales and basins used by grouping/filtering logic.
  const { data: { basins, locales } } = useLocalesAndBasins()

  // Build a basin-indexed map so locales render under their parent basin section.
  const localesByBasin = locales.reduce((acc, locale) => {
    const basinId = locale.basinId;
    if (!acc[basinId]) {
      const basin = basins.find(b => b.id === basinId);
      acc[basinId] = { basinName: basin?.name || 'Unknown Basin', locales: [] };
    }
    acc[basinId].locales.push(locale);
    return acc;
  }, {} as Record<string, { basinName: string; locales: typeof locales }>);

  // Apply client-side search filtering while preserving basin group structure.
  const filteredLocalesByBasin = Object.entries(localesByBasin).reduce((acc, [basinId, { basinName, locales }]) => {
    const filteredLocales = locales.filter(locale => 
      locale.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      locale.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );
    if (filteredLocales.length > 0) {
      acc[basinId] = { basinName, locales: filteredLocales };
    }
    return acc;
  }, {} as Record<string, { basinName: string; locales: typeof locales }>);
  
  return (
    <div className="container mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Locales & Commons</h1>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Request New Locale
        </Button>
      </div>
      
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search locales..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {Object.entries(filteredLocalesByBasin).map(([basinId, { basinName, locales }]) => (
        <div key={basinId} className="mb-8">
          {/* Basin heading links to the parent basin detail page via client navigation. */}
          <Link href={`/basins/${basinId}`} className="group">
            <h2 className="text-2xl font-semibold mb-4 border-b pb-2 flex items-center gap-2 group-hover:text-primary transition-colors">
              <MapPin className="h-5 w-5 text-primary" />
              {basinName}
              <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </h2>
          </Link>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {locales.map((locale) => (
              // Each locale card links to its detail page under `/locales/[id]`.
              <Link href={`/locales/${locale.id}`} key={locale.id}>
                <Card className="h-full hover:shadow-lg transition-shadow cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-lg">{locale.name}</h3>
                        {/* Conditional rendering for commons indicator. */}
                        {locale.isCommons && <Star className="h-4 w-4 text-yellow-400 fill-yellow-400" />}
                      </div>
                      <div className="flex items-center text-sm text-muted-foreground">
                        <Users className="h-4 w-4 mr-1" />
                        {locale.memberCount}
                      </div>
                    </div>
                    {/* Render locale cover image only when an image URL is present. */}
                    {locale.image && (
                      <div className="mb-3 rounded-lg overflow-hidden">
                        <Image
                          src={locale.image}
                          alt={locale.name}
                          width={300}
                          height={150}
                          className="w-full h-32 object-cover"
                        />
                      </div>
                    )}
                    <p className="text-sm text-muted-foreground mb-2">{locale.description}</p>
                    <p className="text-xs text-muted-foreground">{locale.location}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      ))}
      
      {/* Empty-state conditional rendering for searches that produce no locale matches. */}
      {Object.keys(filteredLocalesByBasin).length === 0 && (
        <div className="text-center py-12">
          <h3 className="text-lg font-semibold mb-2">No locales found</h3>
          <p className="text-muted-foreground">Try adjusting your search terms.</p>
        </div>
      )}
    </div>
  )
}
