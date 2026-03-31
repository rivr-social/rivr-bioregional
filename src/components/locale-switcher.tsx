"use client"

/**
 * Locale selector dropdown used in locale-aware navigation and filtering areas.
 * Used in: views where users switch between "All Locales" and basin-grouped locales.
 * Key props: `selectedLocale` for active selection and `onLocaleChange` for parent state updates.
 */
import * as React from "react"
import { Check, ChevronDown, ChevronRight, Globe, Star } from "lucide-react"
import Link from "next/link"
import Image from "next/image"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useLocalesAndBasins } from "@/lib/hooks/use-graph-data"

interface LocaleSwitcherProps {
  onLocaleChange: (localeId: string) => void
  selectedLocale: string
}

/**
 * Renders a searchable locale picker grouped by basin, with links to locale/basin pages.
 * @param {LocaleSwitcherProps} props Props containing the current locale selection and change handler.
 */
export function LocaleSwitcher({ onLocaleChange, selectedLocale }: LocaleSwitcherProps) {
  // Local UI state for popover visibility and in-dropdown search query.
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  // Data-fetching hook for locale and basin metadata used to render options.
  const {
    data: { basins, locales },
  } = useLocalesAndBasins()

  // Memoize basin lookup by id for efficient filtering and grouping.
  const basinById = React.useMemo(() => {
    const map = new Map<string, { id: string; name: string }>()
    for (const basin of basins) map.set(basin.id, basin)
    return map
  }, [basins])

  // Filter locales by search text against locale name/description and basin name.
  const filteredLocales = React.useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return locales
    return locales.filter((locale) => {
      const basinName = basinById.get(locale.basinId)?.name || ""
      return (
        locale.name.toLowerCase().includes(normalized) ||
        (locale.description || "").toLowerCase().includes(normalized) ||
        basinName.toLowerCase().includes(normalized)
      )
    })
  }, [locales, query, basinById])

  // Group filtered locales by basin so the menu can render sectioned results.
  const localesByBasin = React.useMemo(() => {
    const grouped: Array<{ basinId: string; basinName: string; locales: typeof locales }> = []
    const index = new Map<string, number>()

    for (const locale of filteredLocales) {
      const basinId = locale.basinId || "unscoped"
      const basinName = basinById.get(basinId)?.name || "Other Locales"
      if (!index.has(basinId)) {
        index.set(basinId, grouped.length)
        grouped.push({ basinId, basinName, locales: [] as typeof locales })
      }
      grouped[index.get(basinId)!].locales.push(locale)
    }

    return grouped
  }, [filteredLocales, basinById, locales])

  const normalizedSelectedLocale = selectedLocale.trim().toLowerCase()
  const selectedLocaleObj = locales.find((locale) => {
    return (
      locale.id === selectedLocale ||
      locale.slug === selectedLocale ||
      locale.name.toLowerCase() === normalizedSelectedLocale
    )
  })
  // Conditional rendering flag for global mode vs. a specific locale.
  const isAll = !selectedLocaleObj || selectedLocale === "all"

  return (
    <div className="flex items-center gap-2">
      {!isAll && selectedLocaleObj ? (
        // Show current locale context and deep link when a specific locale is selected.
        <Link href={`/locales/${selectedLocaleObj.id}`} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          {selectedLocaleObj.image ? (
            <Image
              src={selectedLocaleObj.image}
              alt={selectedLocaleObj.name}
              width={32}
              height={32}
              className="h-8 w-8 rounded-full object-cover border"
            />
          ) : null}
          <span className="text-lg font-semibold text-foreground">{selectedLocaleObj.name}</span>
          {selectedLocaleObj.isCommons ? <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" /> : null}
        </Link>
      ) : null}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" role="combobox" aria-expanded={open} className="flex items-center gap-1 px-2 font-normal text-[#ddaa46]">
            {isAll ? (
              <>
                <Globe className="h-5 w-5 mr-1" />
                <span className="text-lg font-semibold">All Locales</span>
              </>
            ) : null}
            <ChevronDown className="h-4 w-4 opacity-70" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="z-[1200] w-[340px] border bg-popover opacity-100 p-0 shadow-2xl" align="start">
          <div className="border-b p-2">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search locales..." className="h-9" />
          </div>
          <div className="max-h-[360px] overflow-y-auto p-1">
            <button
              type="button"
              onClick={() => {
                // Event handler: reset selection to all locales and close the popover.
                onLocaleChange("all")
                setOpen(false)
              }}
              className={cn(
                "w-full rounded-md px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                isAll ? "bg-accent" : ""
              )}
            >
              <span className="inline-flex items-center gap-2">
                <Check className={cn("h-4 w-4", isAll ? "opacity-100" : "opacity-0")} />
                <Globe className="h-4 w-4 text-muted-foreground" />
                All Locales
              </span>
            </button>

            {localesByBasin.length === 0 ? <p className="p-3 text-sm text-muted-foreground">No locales found.</p> : null}

            {localesByBasin.map((entry) => (
              <div key={entry.basinId} className="mt-1">
                {entry.basinId !== "unscoped" ? (
                  <Link
                    href={`/basins/${entry.basinId}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-between px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    <span>{entry.basinName}</span>
                    <ChevronRight className="h-3 w-3" />
                  </Link>
                ) : (
                  <p className="px-2 py-1 text-xs font-medium text-muted-foreground">{entry.basinName}</p>
                )}

                {entry.locales.map((locale) => (
                  <button
                    key={locale.id}
                    type="button"
                    onClick={() => {
                      // Event handler: update parent-selected locale and close the menu.
                      onLocaleChange(locale.id)
                      setOpen(false)
                    }}
                    className={cn(
                      "w-full rounded-md px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                      selectedLocaleObj?.id === locale.id ? "bg-accent" : ""
                    )}
                  >
                    <span className="inline-flex w-full items-center gap-2">
                      <Check className={cn("h-4 w-4", selectedLocaleObj?.id === locale.id ? "opacity-100" : "opacity-0")} />
                      {locale.image ? (
                        <Image
                          src={locale.image}
                          alt={locale.name}
                          width={20}
                          height={20}
                          className="h-5 w-5 rounded-full object-cover"
                        />
                      ) : null}
                      <span className="flex-1 truncate">{locale.name}</span>
                      {locale.isCommons ? <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" /> : null}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
