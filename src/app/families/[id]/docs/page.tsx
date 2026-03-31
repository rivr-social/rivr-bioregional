import { getDocumentsForGroup } from "@/lib/queries/resources"
import { FamilyDocsContent } from "./family-docs-content"

interface FamilyDocsPageProps {
  params: Promise<{
    id: string
  }>
  searchParams: Promise<{
    doc?: string
  }>
}

export default async function FamilyDocsPage({ params, searchParams }: FamilyDocsPageProps) {
  const { id: familyId } = await params
  const { doc: initialDocId = null } = (await searchParams) ?? {}

  const documents = await getDocumentsForGroup(familyId)

  return (
    <FamilyDocsContent
      familyId={familyId}
      documents={documents}
      initialDocId={initialDocId ?? null}
    />
  )
}
