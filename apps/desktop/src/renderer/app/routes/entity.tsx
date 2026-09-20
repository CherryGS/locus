import { createFileRoute } from "@tanstack/react-router"
import { EntityPage } from "@/pages/entity"

export const Route = createFileRoute("/entity")({ component: EntityPage })
