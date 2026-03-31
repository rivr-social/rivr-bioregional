import { redirect } from "next/navigation"

export default function ExploreNotFound() {
  redirect("/")
  return null
}
