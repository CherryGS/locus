import { ApiFailure, errorText, type BackendApi, type Wire } from "@/shared/api"
import type { EntityItem } from "./entity-item"
import type { IdentitySequence } from "./identity-sequence"
import { fileProjection, mediaProblems, mediaProjection, membershipProjection } from "./live-projection"
import type { ReadProblem } from "./read-problem"

type Entry = {
  item: EntityItem
  generation: number
  pending: boolean
  resources: Map<string, ReadProblem>
  resourceRevision: number
  playbackRevision: number
  playbackPending: boolean
  membershipObserved: boolean
  epoch: number
}
type ReadApi = Pick<BackendApi, "identities" | "memberships" | "file" | "media"> &
  Partial<Pick<BackendApi, "previewBytes">>

export class EntityReader {
  sequence?: IdentitySequence
  listPending = false
  listError?: string
  listRevision = 0
  private previews = new Map<string, Wire<"PreviewMetadata">>()
  private previewUrls = new Map<string, string>()
  private listGeneration = 0
  private entries = new Map<string, Entry>()
  private needed = new Set<string>()
  private listeners = new Set<() => void>()
  private revision = 0
  private resourceGeneration = 0
  private queued = false
  private active = 0
  private jobs: { id: string; entry: Entry; run: () => Promise<void> }[] = []
  private membershipBusy = false
  private nextRead?: { ids: string[]; done: () => void; explicit: Map<string, (() => void)[]> }
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  readonly snapshot = () => this.revision
  constructor(
    private readonly api: ReadApi,
    readonly capacity = 256,
    private readonly observeVideoInput?: (entityId: string, fileId?: string) => void,
  ) {}
  private changed() {
    this.revision++
    for (const listener of this.listeners) listener()
  }
  get cacheSize() {
    return this.entries.size
  }
  get pendingCount() {
    return this.active + this.jobs.length
  }
  get(id: string): EntityItem {
    return (
      this.entries.get(id)?.item ?? {
        id,
        live: true,
        components: [],
        loading: true,
        membershipsStatus: "unread",
        problems: [],
      }
    )
  }
  resourceRevision(id: string) {
    return this.entries.get(id)?.resourceRevision ?? 0
  }
  playbackRevision(id: string) {
    return this.entries.get(id)?.playbackRevision ?? 0
  }
  playbackPending(id: string) {
    return this.entries.get(id)?.playbackPending ?? false
  }
  resourceResult(id: string, basis: string, generation: number, message?: string) {
    const entry = this.entries.get(id)
    const component = entry?.item.components.find((c) =>
      (c.kind === "image" || c.kind === "video") && `${c.id}:${c.inputFileId}` === basis)
    if (!entry || !component ||
      (component.kind === "video"
        ? entry.playbackPending || entry.playbackRevision !== generation
        : entry.resourceRevision !== generation)) return
    if (message)
      entry.resources.set(basis, {
        key: `resource:${basis}`,
        subject: `${component.kind === "video" ? "Video" : "Image"} resource ${basis}`,
        message,
        recovery: "resource",
      })
    else entry.resources.delete(basis)
    entry.item = {
      ...entry.item,
      problems: [
        ...(entry.item.problems ?? []).filter((p) => !p.key.startsWith("resource:")),
        ...entry.resources.values(),
      ],
    }
    this.changed()
  }
  retryResource(id: string, basis?: string) {
    const entry = this.entries.get(id)
    if (entry) {
      entry.resourceRevision = ++this.resourceGeneration
      if (entry.item.components.some((c) => c.kind === "video" && (!basis || basis.startsWith(`${c.id}:`)))) {
        entry.playbackPending = true
        void this.read([id], true)
      }
      this.changed()
    }
  }
  demand(ids: string[]) {
    this.needed = new Set(ids)
    // Touch only the bounded visible range; an ID result is never expanded here.
    for (const id of ids) {
      const entry = this.entries.get(id)
      if (entry) {
        this.entries.delete(id)
        this.entries.set(id, entry)
      }
    }
    if (!this.queued) {
      this.queued = true
      queueMicrotask(() => {
        this.queued = false
        this.prune()
        void this.read(
          [...this.needed].filter(
            (id) => !this.entries.has(id) || this.entries.get(id)!.epoch !== this.listRevision,
          ),
        )
      })
    }
  }
  async refresh() {
    const generation = ++this.listGeneration
    this.listPending = true
    this.changed()
    try {
      const sequence = await this.api.identities()
      if (generation !== this.listGeneration) return false
      this.sequence = sequence
      this.listError = undefined
      this.listRevision++
      this.listPending = false
      this.changed()
      void this.read([...this.needed].filter((id) => sequence.indexOf(id) >= 0))
      return true
    } catch (error) {
      if (generation === this.listGeneration) {
        this.listError = errorText(error)
        this.listPending = false
        this.changed()
      }
      return false
    }
  }
  importEffects(items: Wire<"ImportItem">[]) {
    const visible: string[] = []
    for (const item of items) {
      for (const kind of item.current.kinds)
        if (kind.component_id && kind.output) this.previews.set(kind.component_id, kind.output)
      const id = item.current.entity_id
      if (!id) continue
      const entry = this.entries.get(id)
      if (entry) {
        entry.epoch = -1
        entry.resourceRevision = ++this.resourceGeneration
      }
      if (this.needed.has(id)) visible.push(id)
    }
    // A single bounded membership request, never a full identity-list refresh.
    if (visible.length) void this.read([...new Set(visible)], true)
  }
  reread(id: string) {
    const entry = this.entries.get(id)
    if (entry?.resources.size) {
      entry.resourceRevision = ++this.resourceGeneration
      if (entry.item.components.some((c) => c.kind === "video" && entry.resources.has(`${c.id}:${c.inputFileId}`)))
        entry.playbackPending = true
    }
    return this.read([id], true)
  }
  private async read(ids: string[], explicit = false) {
    if (!ids.length) return
    if (this.membershipBusy) {
      // Only one membership observation and the latest requested range wait at
      // this boundary. Scrolling cannot accumulate all prior range closures.
      const old = this.nextRead
      old?.done()
      const obligations = old?.explicit ?? new Map<string, (() => void)[]>()
      for (const [id, completions] of obligations)
        if (!this.needed.has(id)) {
          completions.forEach((done) => done())
          obligations.delete(id)
        }
      await new Promise<void>((done) => {
        if (explicit) for (const id of ids) obligations.set(id, [...(obligations.get(id) ?? []), done])
        this.nextRead = {
          ids: [...new Set([...obligations.keys(), ...ids])],
          done: explicit ? () => {} : done,
          explicit: obligations,
        }
      })
      return
    }
    this.membershipBusy = true
    const tickets = ids.map((id) => {
      const old = this.entries.get(id)
      const entry: Entry = {
        item: {
          ...this.get(id),
          loading: true,
          membershipsStatus: old?.item.membershipsStatus === "present" ? "present" : "loading",
        },
        generation: (old?.generation ?? 0) + 1,
        pending: true,
        resources: old?.resources ?? new Map(),
        resourceRevision: old?.resourceRevision ?? ++this.resourceGeneration,
        playbackRevision: old?.playbackRevision ?? ++this.resourceGeneration,
        playbackPending: old?.playbackPending ?? false,
        membershipObserved: old?.membershipObserved ?? false,
        epoch: this.listRevision,
      }
      this.entries.set(id, entry)
      return { id, entry }
    })
    this.changed()
    try {
      const memberships = await this.api.memberships(ids)
      if (memberships.length !== ids.length || memberships.some((value, index) => value.entity_id !== ids[index]))
        throw new Error("Membership results did not match the requested identities.")
      for (const [index, membership] of memberships.entries()) {
        const { id, entry } = tickets[index]
        if (this.entries.get(id) !== entry) continue
        if (membership.status === "missing") {
          this.observeVideoInput?.(id)
          entry.item = {
            id,
            live: true,
            components: [],
            membershipsStatus: "missing",
            problems: [
              {
                key: "membership",
                subject: `Entity ${id}`,
                message:
                  "This Entity is no longer available. Refresh the list to establish its current membership.",
                recovery: "entity",
              },
            ],
          }
          entry.resources.clear()
          entry.membershipObserved = true
          entry.pending = false
          this.changed()
          continue
        }
        const components = membership.memberships.map((m) => {
          const previous = entry.item.components.find((c) => c.id === m.component_id && c.kindId === m.kind_id)
          return previous ? { ...previous, readStatus: "loading" as const } : membershipProjection(m)
        })
        if (!components.some((c) => c.kind === "video")) this.observeVideoInput?.(id)
        const present = new Set(components.map((c) => c.id))
        entry.membershipObserved = true
        for (const key of entry.resources.keys())
          if (!components.some((c) => (c.kind === "image" || c.kind === "video") && key.startsWith(`${c.id}:`)))
            entry.resources.delete(key)
        const problems = (entry.item.problems ?? []).filter(
          (problem) =>
            problem.key !== "membership" &&
            [...present].some((component) => problem.key.startsWith(`${component}:`)),
        )
        entry.item = {
          id,
          live: true,
          components,
          membershipsStatus: "present",
          loading: components.some((c) => c.kind !== "unknown"),
          problems: [...problems, ...entry.resources.values()],
        }
        let pending = components.filter((c) => c.kind !== "unknown").length
        entry.pending = pending > 0
        for (const component of components) {
          if (component.kind === "unknown") {
            this.replaceProblems(entry, `${component.id}:`, [
              {
                key: `${component.id}:unsupported`,
                subject: `Component ${component.id}`,
                message: `This UI has no reader for kind ${component.kindId}. The membership is retained.`,
                recovery: "entity",
              },
            ])
            continue
          }
          this.enqueue(id, entry, async () => {
            if (this.entries.get(id) !== entry) return
            try {
              const value =
                component.kind === "file"
                  ? await this.api.file(component.id)
                  : await this.api.media(component.kind as "image" | "video", component.id)
              if (this.entries.get(id) !== entry) return
              let next =
                "file_id" in value
                  ? fileProjection(value)
                  : { ...mediaProjection(value), kindId: component.kindId }
              if (next.id !== component.id || next.kind !== component.kind)
                throw new Error("The record result did not match the requested Component.")
              if (next.kind === "video") {
                if (next.applicability?.status === "error" && component.kind === "video")
                  next = { ...next, inputFileId: component.inputFileId, inputPrevious: !!component.inputFileId }
                else {
                  this.observeVideoInput?.(id, next.inputFileId)
                  if (entry.playbackPending) entry.playbackRevision = ++this.resourceGeneration
                }
                entry.playbackPending = false
              }
              entry.item = {
                ...entry.item,
                components: entry.item.components.map((c) => (c.id === component.id ? next : c)),
              }
              this.replaceProblems(
                entry,
                `${component.id}:`,
                "file_id" in value
                  ? []
                  : mediaProblems(value).map((p) => ({ ...p, key: `${component.id}:${p.key}` })),
              )
              if (
                (next.kind === "image" || next.kind === "video") &&
                "applicability" in next &&
                next.applicability?.status === "matching"
              ) {
                const output = this.previews.get(next.id)
                if (
                  output &&
                  output.file_id === next.applicability.file_id &&
                  output.kind === next.kind &&
                  this.api.previewBytes
                ) {
                  try {
                    const bytes = await this.api.previewBytes(output.locator, new AbortController().signal)
                    if (this.entries.get(id) !== entry) return
                    const url = URL.createObjectURL(bytes)
                    const key = `${id}:${next.id}`
                    const old = this.previewUrls.get(key)
                    if (old) URL.revokeObjectURL(old)
                    this.previewUrls.set(key, url)
                    entry.item = {
                      ...entry.item,
                      components: entry.item.components.map((c) =>
                        c.id === next.id ? { ...next, thumbnail: url } : c,
                      ),
                    }
                    this.replaceProblems(entry, `${next.id}:preview`, [])
                  } catch (error) {
                    if (this.entries.get(id) !== entry) return
                    this.replaceProblems(entry, `${next.id}:preview`, [
                      {
                        key: `${next.id}:preview`,
                        subject: `${next.kind} preview`,
                        message: errorText(error),
                        recovery: "entity",
                      },
                    ])
                  }
                }
              }
              if (next.kind === "image" || next.kind === "video") {
                const basis = `${next.id}:${next.inputFileId}`
                for (const key of entry.resources.keys())
                  if (key.startsWith(`${next.id}:`) && key !== basis) entry.resources.delete(key)
                entry.item = {
                  ...entry.item,
                  problems: [
                    ...(entry.item.problems ?? []).filter((p) => !p.key.startsWith("resource:")),
                    ...entry.resources.values(),
                  ],
                }
              }
            } catch (error) {
              if (this.entries.get(id) !== entry) return
              if (component.kind === "video") entry.playbackPending = false
              const current = entry.item.components.find((c) => c.id === component.id)!
              const absent =
                error instanceof ApiFailure &&
                (error.detail.code === "missing_file" ||
                  (error.detail.diagnostic?.owner === "media" &&
                    error.detail.diagnostic.error.code === "missing_record"))
              if (absent && component.kind === "video") this.observeVideoInput?.(id)
              const previous =
                !absent &&
                current.readStatus === "loading" &&
                (("record" in current && !!current.record) || ("bytes" in current && current.bytes !== undefined))
              entry.item = {
                ...entry.item,
                components: entry.item.components.map((c) =>
                  c.id === component.id
                    ? ({
                        ...(absent ? { id: c.id, kind: c.kind, kindId: c.kindId } : c),
                        readStatus: "failed",
                        previous,
                      } as typeof c)
                    : c,
                ),
              }
              this.replaceProblems(entry, `${component.id}:read`, [
                {
                  key: `${component.id}:read`,
                  subject: `${component.kind} ${component.id}`,
                  message: errorText(error),
                  previous,
                  recovery: "entity",
                },
              ])
            } finally {
              if (this.entries.get(id) === entry) {
                pending--
                entry.pending = pending > 0
                entry.item = { ...entry.item, loading: entry.pending }
                this.changed()
                this.prune()
              }
            }
          })
        }
        this.changed()
      }
    } catch (error) {
      for (const { id, entry } of tickets) {
        if (this.entries.get(id) !== entry) continue
        const previous = entry.membershipObserved
        entry.item = { ...entry.item, membershipsStatus: "failed", loading: false }
        this.replaceProblems(entry, "membership", [
          {
            key: "membership",
            subject: `Entity ${id} memberships`,
            message: errorText(error),
            previous,
            recovery: "entity",
          },
        ])
        entry.pending = false
        entry.playbackPending = false
      }
      this.changed()
    } finally {
      this.membershipBusy = false
      const next = this.nextRead
      this.nextRead = undefined
      if (next)
        void this.read(next.ids.filter((id) => this.needed.has(id))).finally(() => {
          next.done()
          for (const completions of next.explicit.values()) completions.forEach((done) => done())
        })
    }
    this.prune()
  }
  private replaceProblems(entry: Entry, prefix: string, problems: ReadProblem[]) {
    entry.item = {
      ...entry.item,
      problems: [...(entry.item.problems ?? []).filter((p) => !p.key.startsWith(prefix)), ...problems],
    }
  }
  private enqueue(id: string, entry: Entry, run: () => Promise<void>) {
    this.jobs.push({ id, entry, run })
    this.pump()
  }
  private pump() {
    while (this.active < 8 && this.jobs.length) {
      const job = this.jobs.shift()!
      if (this.entries.get(job.id) !== job.entry) continue
      this.active++
      void job.run().finally(() => {
        this.active--
        this.pump()
      })
    }
  }
  private prune() {
    for (const [id, entry] of this.entries) {
      if (!this.needed.has(id) && (entry.pending || this.entries.size > this.capacity)) {
        this.entries.delete(id)
        for (const [key, url] of this.previewUrls)
          if (key.startsWith(`${id}:`)) {
            URL.revokeObjectURL(url)
            this.previewUrls.delete(key)
          }
      }
    }
    this.jobs = this.jobs.filter((job) => this.entries.get(job.id) === job.entry)
  }
}
