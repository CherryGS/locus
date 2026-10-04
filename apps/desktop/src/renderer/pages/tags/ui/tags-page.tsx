import { TagVocabulary, type TagCoordinator, type TagBrowsing } from "@/features/tags"
import type { GeneratedDraftReceiver } from "@/features/tags"
export function TagsPage({
  tags,
  browsing,
  generatedDraftReceiver,
  onSelect,
  onContent,
  onActivate,
}: {
  tags: TagCoordinator
  browsing: TagBrowsing
  generatedDraftReceiver: GeneratedDraftReceiver
  onSelect: (id: string) => void
  onContent: () => void
  onActivate: (id: string) => void
}) {
  return (
    <TagVocabulary
      coordinator={tags}
      browsing={browsing}
      generatedDraftReceiver={generatedDraftReceiver}
      onSelect={onSelect}
      onContent={onContent}
      onActivate={onActivate}
    />
  )
}
