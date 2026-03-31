"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TrendingUp } from "lucide-react"
import { TypeBadge } from "@/components/type-badge"
import { TypeIcon } from "@/components/type-icon"
import Link from "next/link"

export function TrendingTopics() {
  // Generate mock trending topics based on post content
  const trendingTopics = [
    {
      id: "t1",
      name: "Community Garden",
      postCount: 1243,
      category: "Local",
      type: "basic" as const,
    },
    {
      id: "t2",
      name: "Tech Workshop",
      postCount: 856,
      category: "Events",
      type: "org" as const,
    },
    {
      id: "t3",
      name: "Food Justice",
      postCount: 712,
      category: "Activism",
      type: "ring" as const,
    },
    {
      id: "t4",
      name: "Mutual Aid",
      postCount: 689,
      category: "Community",
      type: "family" as const,
    },
    {
      id: "t5",
      name: "Art Festival",
      postCount: 542,
      category: "Events",
      type: "basic" as const,
    },
  ]

  return (
    <Card className="border-2 border-gray-300 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-gray-500" />
          Trending in your area
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y">
          {trendingTopics.map((topic) => (
            <Link
              key={topic.id}
              href={`/explore?q=${encodeURIComponent(topic.name)}`}
              className="block px-4 py-3 transition-colors border-l-4 border-border hover:bg-muted"
            >
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-medium">{topic.name}</p>
                  <p className="text-sm text-muted-foreground">{topic.postCount.toLocaleString()} posts</p>
                </div>
                <div className="flex items-center">
                  <TypeIcon type={topic.type} size={16} className="mr-1" />
                  <TypeBadge type={topic.type} showIcon={false} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
