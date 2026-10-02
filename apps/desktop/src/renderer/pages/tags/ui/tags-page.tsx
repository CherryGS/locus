import { TagVocabulary, type TagCoordinator, type TagBrowsing } from "@/features/tags"
import type { FilterCoordinator } from "@/features/entity-filter"
export function TagsPage({
  tags,
  browsing,
  filter,
  onSelect,
  onContent,
  onActivate,
}: {
  tags: TagCoordinator
  browsing: TagBrowsing
  filter: FilterCoordinator
  onSelect: (id: string) => void
  onContent: () => void
  onActivate: (id: string) => void
}) {
  return (
    <TagVocabulary
      coordinator={tags}
      browsing={browsing}
      filter={filter}
      onSelect={onSelect}
      onContent={onContent}
      onActivate={onActivate}
    />
  )
}
