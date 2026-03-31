"use client"

import { useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import { ArrowUpRight, TrendingUp } from "lucide-react"

interface TrendingTopic {
  id: string
  name: string
  count: number
  trend: "up" | "down" | "stable"
  chapterTags?: string[]
}

// Mock trending topics data
const mockTrendingTopics: TrendingTopic[] = [
  {
    id: "1",
    name: "Climate Action",
    count: 1243,
    trend: "up",
    chapterTags: ["sf", "oak", "berk", "nyc"],
  },
  {
    id: "2",
    name: "Housing Justice",
    count: 982,
    trend: "up",
    chapterTags: ["sf", "oak", "la", "chi"],
  },
  {
    id: "3",
    name: "Food Security",
    count: 756,
    trend: "stable",
    chapterTags: ["sf", "nyc", "chi", "sea"],
  },
  {
    id: "4",
    name: "Mutual Aid",
    count: 621,
    trend: "up",
    chapterTags: ["sf", "oak", "berk", "nyc", "la", "chi", "sea"],
  },
  {
    id: "5",
    name: "Community Gardens",
    count: 512,
    trend: "down",
    chapterTags: ["sf", "oak", "berk", "sea"],
  },
]

interface TrendingTopicsProps {
  chapterId?: string
}

export function TrendingTopics({ chapterId = "all" }: TrendingTopicsProps) {
  const trendingTopics = useMemo(() => {
    // Filter topics by chapter if specified
    if (chapterId && chapterId !== "all") {
      return mockTrendingTopics.filter((topic) => topic.chapterTags?.includes(chapterId))
    }
    return mockTrendingTopics
  }, [chapterId])

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-semibold flex items-center">
          <TrendingUp className="h-5 w-5 mr-2 text-primary" />
          Trending Topics
        </CardTitle>
      </CardHeader>
      <CardContent>
        {trendingTopics.length > 0 ? (
          <div className="space-y-4">
            {trendingTopics.map((topic) => (
              <div key={topic.id} className="flex items-center justify-between">
                <div className="flex items-center">
                  <Badge
                    variant="outline"
                    className={`mr-2 ${topic.trend === "up" ? "bg-green-50 text-green-700 border-green-200" : topic.trend === "down" ? "bg-red-50 text-red-700 border-red-200" : "bg-gray-50 text-gray-700 border-gray-200"}`}
                  >
                    {topic.count}
                  </Badge>
                  <span className="font-medium">{topic.name}</span>
                </div>
                <Link href={`/search?q=${encodeURIComponent(topic.name)}`} className="text-primary hover:underline">
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-center text-muted-foreground py-2">No trending topics in this chapter</p>
        )}
      </CardContent>
    </Card>
  )
}
