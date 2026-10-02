import { EntityGrid, type EntitySource, type EntityItem, type GridPosition } from "@/entities/entity"
import { Alert, AlertDescription } from "@/shared/ui/alert"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/shared/ui/empty"

export function TagEntityGrid({
  source,
  selectedId,
  position,
  onPosition,
  onSelect,
  onOpen,
  pending,
  established,
  error,
  retained,
}: {
  source: EntitySource
  selectedId?: string
  position?: GridPosition
  onPosition: (position: GridPosition) => void
  onSelect: (entity: EntityItem) => void
  onOpen: (entity: EntityItem) => void
  pending: boolean
  established: boolean
  error?: string
  retained?: string
}) {
  return (
    <section aria-label="Associated content" className="flex h-full min-h-0 min-w-0 flex-col">
      {(error || retained) && (
        <Alert variant={error ? "destructive" : "default"}>
          <AlertDescription>{error} {retained}</AlertDescription>
        </Alert>
      )}
      {source.sequence.length ? (
        <div className="min-h-0 flex-1">
          <EntityGrid
            source={source}
            selectedId={selectedId}
            position={position}
            onPosition={onPosition}
            onSelect={onSelect}
            onOpen={onOpen}
            componentFor={() => undefined}
            revealSelectionOnMount={!!position}
          />
        </div>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {!established
                ? pending ? "Finding tagged content…" : "Tag content unavailable"
                : "No tagged content"}
            </EmptyTitle>
            <EmptyDescription>
              {pending
                ? established ? "Refreshing; showing the previous empty result." : "Reading associated content."
                : error && !established
                  ? "Refresh to try again."
                  : "This tag has no matching items. Assign tags to content, then refresh."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </section>
  )
}
