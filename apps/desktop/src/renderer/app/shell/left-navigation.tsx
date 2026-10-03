import { useEffect, useRef, useState, useSyncExternalStore, type FocusEvent } from "react"
import { Link } from "@tanstack/react-router"
import { HomeIcon, LayoutGridIcon, SettingsIcon, TagsIcon } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { cn } from "@/shared/lib/utils"
import { Button, buttonVariants } from "@/shared/ui/button"
import { useSettingsWorkspace } from "./settings-navigation"
import { Separator } from "@/shared/ui/separator"
import { actionRailWidth } from "@/shared/ui/action-rail-layout"

const expandedWidth = 224
const revealDelay = 300
const concealDelay = 150
const linkLayout = "w-full justify-start gap-2 overflow-hidden pl-0 pr-3 has-data-[icon=inline-start]:pl-0"
const navigation = [
  { to: "/", label: "Home", icon: HomeIcon },
  { to: "/entity", label: "Entity", icon: LayoutGridIcon },
] as const

export function LeftNavigation() {
  const { session, external, media } = useSettingsWorkspace()
  useSyncExternalStore(session?.tags.subscribe ?? (() => () => {}), session?.tags.snapshot ?? (() => 0))
  const settingsStatus = [
    external && `External connection: ${external}`,
    media && `Media tools: ${media}`,
  ]
    .filter(Boolean)
    .join("; ")
  const [revealed, setRevealed] = useState(false)
  const nav = useRef<HTMLElement>(null)
  const pointerInside = useRef(false)
  const keyboardFocus = useRef(false)
  const revealTimer = useRef<number | undefined>(undefined)
  const concealTimer = useRef<number | undefined>(undefined)
  const reduceMotion = useReducedMotion()
  const transition = {
    duration: reduceMotion ? 0 : 0.18,
    ease: [0.2, 0.8, 0.2, 1] as const,
  }

  function cancelTimers() {
    window.clearTimeout(revealTimer.current)
    window.clearTimeout(concealTimer.current)
  }

  useEffect(() => cancelTimers, [])

  function concealAfterLeave() {
    window.clearTimeout(revealTimer.current)
    window.clearTimeout(concealTimer.current)
    concealTimer.current = window.setTimeout(() => {
      const focusedByKeyboard = keyboardFocus.current && nav.current?.contains(document.activeElement)
      if (!pointerInside.current && !focusedByKeyboard) setRevealed(false)
    }, concealDelay)
  }

  function enter() {
    pointerInside.current = true
    cancelTimers()
    if (!revealed) {
      revealTimer.current = window.setTimeout(() => setRevealed(true), revealDelay)
    }
  }

  function leave() {
    pointerInside.current = false
    concealAfterLeave()
  }

  function focus(event: FocusEvent<HTMLElement>) {
    if (event.target instanceof HTMLElement && event.target.matches(":focus-visible")) {
      keyboardFocus.current = true
      cancelTimers()
      setRevealed(true)
    }
  }

  function blur(event: FocusEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      keyboardFocus.current = false
      if (!pointerInside.current) concealAfterLeave()
    }
  }

  return (
    // Keep the global rail mounted on every page; revealing labels overlays
    // the content without changing its width.
    <div className="relative z-10 shrink-0" style={{ width: actionRailWidth }}>
      <motion.nav
        ref={nav}
        id="primary-navigation"
        aria-label="Main navigation"
        className="absolute inset-y-0 left-0 flex flex-col gap-1 overflow-hidden bg-sidebar px-1 py-2"
        initial={false}
        animate={{ width: revealed ? expandedWidth : actionRailWidth }}
        transition={transition}
        onPointerEnter={enter}
        onPointerLeave={leave}
        onPointerDownCapture={() => {
          keyboardFocus.current = false
        }}
        onFocusCapture={focus}
        onBlurCapture={blur}
      >
        {navigation.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            search={to === "/entity" ? { ...session?.mainDestination, mode: "grid", collectionId: "library", restoreMain: true } : undefined}
            onClick={() => {
              cancelTimers()
              setRevealed(false)
            }}
            aria-label={label}
            title={label}
            activeOptions={{ exact: true }}
            activeProps={{ className: cn(buttonVariants({ variant: "secondary" }), linkLayout) }}
            inactiveProps={{ className: cn(buttonVariants({ variant: "ghost" }), linkLayout) }}
          >
            <span className="flex size-8 shrink-0 items-center justify-center">
              <Icon data-icon="inline-start" />
            </span>
            <motion.span
              aria-hidden="true"
              className="shrink-0 whitespace-nowrap"
              initial={false}
              animate={{ opacity: revealed ? 1 : 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.12 }}
            >
              {label}
            </motion.span>
          </Link>
        ))}
        <Link
          to="/tags"
          search={{}}
          activeOptions={{ exact: true }}
          activeProps={{ className: cn(buttonVariants({ variant: "secondary" }), linkLayout) }}
          inactiveProps={{ className: cn(buttonVariants({ variant: "ghost" }), linkLayout) }}
          aria-label={
            session?.tags.unresolved.length
              ? `Tags · ${session.tags.unresolved.length} unresolved`
              : "Tags"
          }
          title="Tags"
          onClick={() => {
            cancelTimers()
            setRevealed(false)
          }}
        >
          <span className="flex size-8 shrink-0 items-center justify-center">
            <TagsIcon data-icon="inline-start" />
          </span>
          <span className="shrink-0 whitespace-nowrap">
            Tags
            {session?.tags.unresolved.length ? ` · ${session.tags.unresolved.length} unresolved` : ""}
          </span>
        </Link>
        <Button
          id="settings-trigger"
          variant={session?.settingsNavigation.opened ? "secondary" : "ghost"}
          className={linkLayout}
          aria-label="Setting"
          aria-haspopup="dialog"
          aria-expanded={session?.settingsNavigation.opened ?? false}
          aria-describedby={settingsStatus ? "settings-navigation-status" : undefined}
          title={settingsStatus || "Setting"}
          onClick={() => {
            cancelTimers()
            setRevealed(false)
            session?.playback.pause()
            session?.settingsNavigation.setOpen(true)
          }}
        >
          <span className="flex size-8 shrink-0 items-center justify-center">
            <SettingsIcon data-icon="inline-start" />
            {settingsStatus && (
              <span aria-hidden="true" className="absolute ml-5 mt-5 size-1.5 rounded-full bg-primary" />
            )}
          </span>
          <motion.span
            aria-hidden="true"
            className="shrink-0 whitespace-nowrap"
            animate={{ opacity: revealed ? 1 : 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.12 }}
          >
            Setting
          </motion.span>
        </Button>
        {settingsStatus && (
          <span id="settings-navigation-status" className="sr-only">
            {settingsStatus}
          </span>
        )}
        <Separator orientation="vertical" className="absolute inset-y-0 right-0" />
      </motion.nav>
    </div>
  )
}
