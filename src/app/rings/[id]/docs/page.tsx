import { getDocumentsForGroup } from "@/lib/queries/resources"
import { RingDocsContent } from "./ring-docs-content"

interface RingDocsPageProps {
  params: Promise<{
    id: string
  }>
  searchParams: Promise<{
    doc?: string
  }>
}

export default async function RingDocsPage({ params, searchParams }: RingDocsPageProps) {
  const { id: ringId } = await params
  const { doc: initialDocId = null } = (await searchParams) ?? {}

  const documents = await getDocumentsForGroup(ringId)

  return (
    <RingDocsContent
      ringId={ringId}
      documents={documents}
      initialDocId={initialDocId ?? null}
    />
  )
}
