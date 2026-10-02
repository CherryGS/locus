import type { ReactElement } from "react"
import { PlusIcon, PencilIcon, CornerDownRightIcon, Trash2Icon } from "lucide-react"
import type { Wire } from "@/shared/api"
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuLabel,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/shared/ui/context-menu"

export type TagEditAction = "create" | "rename" | "move" | "delete"

export function TagContextMenu({
  tag,
  children,
  blocked,
  onEdit,
}: {
  tag: Wire<"TagRecord">
  children: ReactElement
  blocked: boolean
  onEdit: (action: TagEditAction, tag: Wire<"TagRecord">) => void
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={children}
        onKeyDown={(event) => {
          if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return
          event.preventDefault()
          const box = event.currentTarget.getBoundingClientRect()
          event.currentTarget.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              clientX: box.left + 12,
              clientY: box.bottom,
            }),
          )
        }}
      />
      <ContextMenuContent>
        <ContextMenuGroup>
          <ContextMenuLabel className="max-w-56 truncate">{tag.name}</ContextMenuLabel>
          <ContextMenuItem disabled={blocked} onClick={() => onEdit("create", tag)}>
            <PlusIcon />
            New child
          </ContextMenuItem>
          <ContextMenuItem disabled={blocked} onClick={() => onEdit("rename", tag)}>
            <PencilIcon />
            Rename
          </ContextMenuItem>
          <ContextMenuItem disabled={blocked} onClick={() => onEdit("move", tag)}>
            <CornerDownRightIcon />
            Move branch
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem
            variant="destructive"
            disabled={blocked}
            onClick={() => onEdit("delete", tag)}
          >
            <Trash2Icon />
            Delete tag
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  )
}
