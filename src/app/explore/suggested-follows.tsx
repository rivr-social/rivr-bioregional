"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Users } from "lucide-react"
import { fetchPeopleMemberList, type MemberInfo } from "@/app/actions/graph"
import Link from "next/link"

export function SuggestedFollows() {
  const [suggestedUsers, setSuggestedUsers] = useState<MemberInfo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    fetchPeopleMemberList(3)
      .then((people) => {
        if (!cancelled) setSuggestedUsers(people.slice(0, 3))
      })
      .catch(() => {
        if (!cancelled) setSuggestedUsers([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <Card className="mt-6 border shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Users size={18} />
            Who to follow
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div>
                    <Skeleton className="h-4 w-24 mb-1" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
                <Skeleton className="h-8 w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="mt-6 border shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Users size={18} />
          Who to follow
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y">
          {suggestedUsers.map((user) => (
            <div
              key={user.id}
              className="flex items-center justify-between p-4 hover:bg-muted border-l-4 border-border"
            >
              <div className="flex items-center gap-3">
                <Avatar className="border-2 border-gray-200">
                  <AvatarImage src={user.avatar || "/placeholder.svg"} alt={user.name} />
                  <AvatarFallback>{user.name.substring(0, 2)}</AvatarFallback>
                </Avatar>
                <div>
                  <div className="flex items-center gap-2">
                    <Link href={`/profile/${user.username || user.id}`} className="font-medium hover:underline">
                      {user.name}
                    </Link>
                  </div>
                  <p className="text-sm text-muted-foreground">@{user.username}</p>
                </div>
              </div>
              <Button size="sm" variant="outline" className="border-border hover:bg-muted">
                Follow
              </Button>
            </div>
          ))}
          {suggestedUsers.length === 0 && (
            <div className="p-4 text-center text-muted-foreground text-sm">
              No suggested follows available
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
