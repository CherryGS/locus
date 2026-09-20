import { useState } from "react"
import { Link, Outlet } from "@tanstack/react-router"
import { HomeIcon, LayoutGridIcon, PanelRightIcon, SettingsIcon } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { Button, buttonVariants } from "@/shared/ui/button"
import { Empty, EmptyDescription, EmptyHeader } from "@/shared/ui/empty"
import { Separator } from "@/shared/ui/separator"

const navigation = [
  { to: "/", label: "Home", icon: HomeIcon },
  { to: "/entity", label: "Entity", icon: LayoutGridIcon },
  { to: "/setting", label: "Setting", icon: SettingsIcon },
] as const

export function DesktopShell() {
  const [activePanel, setActivePanel] = useState<"overview" | null>(null)
  const reduceMotion = useReducedMotion()

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <header className="title-bar shrink-0 bg-sidebar">
        <div className="title-bar-content flex items-center px-4 text-xs font-medium text-muted-foreground">
          Locus
        </div>
      </header>
      <Separator />
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Main navigation" className="flex w-48 shrink-0 flex-col gap-1 bg-sidebar p-2">
          {navigation.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: true }}
              className={buttonVariants({ variant: "ghost", className: "justify-start" })}
              activeProps={{ className: buttonVariants({ variant: "secondary", className: "justify-start" }) }}
            >
              <Icon data-icon="inline-start" />
              {label}
            </Link>
          ))}
        </nav>
        <Separator orientation="vertical" />
        <main className="min-w-0 flex-1 overflow-auto p-6">
          <Outlet />
        </main>
        {activePanel === "overview" && (
          <>
            <Separator orientation="vertical" />
            <motion.aside
              id="overview-panel"
              aria-labelledby="overview-heading"
              className="w-64 shrink-0 overflow-auto bg-sidebar"
              initial={{ opacity: reduceMotion ? 1 : 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.12 }}
            >
              <h2 id="overview-heading" className="px-4 py-4 text-sm font-medium">Overview</h2>
              <Empty className="p-4">
                <EmptyHeader>
                  <EmptyDescription>No entity selected.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            </motion.aside>
          </>
        )}
        <Separator orientation="vertical" />
        <aside aria-label="Auxiliary panels" className="flex w-12 shrink-0 flex-col items-center gap-2 bg-sidebar py-2">
          <Button
            variant={activePanel === "overview" ? "secondary" : "ghost"}
            className="h-auto w-10 flex-col gap-2 py-3"
            aria-label="Overview"
            title="Overview"
            aria-expanded={activePanel === "overview"}
            aria-controls={activePanel === "overview" ? "overview-panel" : undefined}
            onClick={() => setActivePanel((current) => current === "overview" ? null : "overview")}
          >
            <PanelRightIcon data-icon="inline-start" />
            <span className="[writing-mode:vertical-rl]">Overview</span>
          </Button>
        </aside>
      </div>
      <Separator />
      <footer aria-label="Application footer" className="h-6 shrink-0 bg-sidebar" />
    </div>
  )
}
