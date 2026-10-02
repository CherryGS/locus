import { TagVocabulary, type TagCoordinator, type TagBrowsing } from "@/features/tags"
import type { FilterCoordinator } from "@/features/entity-filter"
export function TagsPage({
  tags,
  browsing,
  filter,
  onSelect,
  onContent,
}: {
  tags: TagCoordinator
  browsing: TagBrowsing
  filter: FilterCoordinator
  onSelect: (id: string) => void
  onContent: () => void
}) {
  return (
    <TagVocabulary
      coordinator={tags}
      browsing={browsing}
      filter={filter}
      onSelect={onSelect}
      onContent={onContent}
    />
  )
}
