import { createFileRoute } from "@tanstack/react-router"
import { SettingPage } from "@/pages/setting"

export const Route = createFileRoute("/setting")({ component: SettingPage })
