"use client"

import { useState, useTransition } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Search, User, Mail, Shield, CheckCircle } from "lucide-react"
import { toast } from "@/components/ui/use-toast"
import { toggleUserActiveStatus } from "@/app/actions/admin"
import type { AdminUser } from "@/app/actions/admin"

interface AdminUsersClientProps {
  initialUsers: AdminUser[]
}

/**
 * Client-rendered user management page with search and status toggle.
 *
 * @returns Searchable user list with activation controls.
 */
export function AdminUsersClient({ initialUsers }: AdminUsersClientProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [users, setUsers] = useState<AdminUser[]>(initialUsers)
  const [isPending, startTransition] = useTransition()

  const filteredUsers = users.filter(user =>
    user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (user.email ?? "").toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.type.toLowerCase().includes(searchQuery.toLowerCase())
  )

  /** Toggles a user between active and inactive status via server action. */
  const handleStatusToggle = (userId: string) => {
    const user = users.find(u => u.id === userId)
    if (!user) return

    const newStatus = user.status === "active" ? "inactive" : "active"

    // Optimistic update
    setUsers(prev => prev.map(u =>
      u.id === userId ? { ...u, status: newStatus } : u
    ))

    startTransition(async () => {
      const result = await toggleUserActiveStatus(userId)
      if (result.success) {
        toast({
          title: `User ${newStatus === "active" ? "activated" : "deactivated"}`,
          description: `${user.name} has been ${newStatus === "active" ? "activated" : "deactivated"}.`,
        })
      } else {
        // Revert optimistic update on failure
        setUsers(prev => prev.map(u =>
          u.id === userId ? { ...u, status: user.status } : u
        ))
        toast({
          title: "Error",
          description: result.message,
          variant: "destructive",
        })
      }
    })
  }

  return (
    <div className="container max-w-6xl mx-auto p-4 pb-20">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">User Management</h1>
          <p className="text-gray-600">View and manage community members</p>
        </div>
      </div>

      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 h-4 w-4" />
            <Input
              placeholder="Search users by name, email, or type..."
              className="pl-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {filteredUsers.map((user) => (
          <Card key={user.id}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Avatar className="h-12 w-12">
                    <AvatarImage src={user.image ?? undefined} alt={user.name} />
                    <AvatarFallback>{user.name.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <h3 className="font-medium">{user.name}</h3>
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Mail className="h-3 w-3" />
                      <span>{user.email ?? "No email"}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <Badge className={user.status === "active" ? "bg-green-100 text-green-800" : "bg-muted text-foreground"}>
                    {user.status === "active" ? (
                      <CheckCircle className="h-3 w-3 mr-1" />
                    ) : null}
                    {user.status.charAt(0).toUpperCase() + user.status.slice(1)}
                  </Badge>
                  <Button
                    variant={user.status === "active" ? "destructive" : "default"}
                    size="sm"
                    disabled={isPending}
                    onClick={() => handleStatusToggle(user.id)}
                  >
                    {user.status === "active" ? "Deactivate" : "Activate"}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 text-sm">
                <div>
                  <p className="text-gray-500">Type</p>
                  <p>{user.type.charAt(0).toUpperCase() + user.type.slice(1)}</p>
                </div>
                <div>
                  <p className="text-gray-500">Joined</p>
                  <p>{user.joinDate}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-blue-500" />
                  <span>{user.badgeCount} Badges</span>
                </div>
              </div>

              <div className="flex justify-end mt-4 gap-2">
                <Button variant="outline" size="sm">
                  <User className="h-4 w-4 mr-1" />
                  View Profile
                </Button>
                <Button variant="outline" size="sm">
                  <Shield className="h-4 w-4 mr-1" />
                  Manage Badges
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}

        {filteredUsers.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center">
              <p className="text-gray-600">No users found matching your search criteria.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
