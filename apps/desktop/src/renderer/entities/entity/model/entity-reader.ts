import { bilibiliProjection, bilibiliProblems, readBilibiliCover } from "./bilibili-projection"
import { ApiFailure, errorText, type BackendApi, type Wire } from "@/shared/api"
import type { EntityItem } from "./entity-item"
import {
  fileProjection,
  tagProjection,
  mediaProblems,
  mediaProjection,
  membershipProjection,
  twitterProjection,
  twitterProblems,
  modelProjection,
  modelProblems,
  civitaiProjection,
  civitaiProblems,
} from "./live-projection"
import type { ReadProblem } from "./read-problem"

type Entry = {
  item: EntityItem
  generation: number
  pending: boolean
  resources: Map<string, ReadProblem>
  resourceRevision: number
  playbackRevision: number
  playbackPending: boolean
  coverRetry?: boolean
  membershipObserved: boolean
  epoch: number
  tagVersion: number
  tagsDirty: boolean
}
type ReadApi = Pick<BackendApi, "memberships" | "file" | "media" | "twitter" | "model"> &
  Partial<Pick<BackendApi, "civitai" | "bilibili" | "tagSet" | "entityTags">> &
  Partial<Pick<BackendApi, "previewBytes" | "savedPreview">>

export class EntityReader {
  private contentEpoch = 0
  private previews = new Map<string, Wire<"PreviewMetadata">>()
  private previewUrls = new Map<string, { url: string; bytes: Blob; basis: string; revision: number }>()
  private entries = new Map<string, Entry>()
  private needed = new Set<string>()
  private listeners = new Set<() => void>()
  private revision = 0
  private resourceGeneration = 0
  private queued = false
  private active = 0
  private jobs: { id: string; entry: Entry; run: () => Promise<void> }[] = []
  private membershipBusy = false
  private tagReads = new Map<string, Promise<void>>()
  private nextRead?: {
    ids: string[]
    done: () => void
    explicit: Map<string, (() => void)[]>
  }
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
    const component = entry?.item.components.find(
      (c) => (c.kind === "image" || c.kind === "video") && `${c.id}:${c.inputFileId}` === basis,
    )
    if (
      !entry ||
      !component ||
      (component.kind === "video"
        ? entry.playbackPending || entry.playbackRevision !== generation
        : entry.resourceRevision !== generation)
    )
      return
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
  retryBilibiliCover(id: string) {
    const entry = this.entries.get(id)
    if (entry) {
      entry.coverRetry = true
      entry.resourceRevision = ++this.resourceGeneration
      void this.read([id], true)
    }
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
            (id) => !this.entries.has(id) || this.entries.get(id)!.epoch !== this.contentEpoch,
          ),
        )
        for (const id of this.needed) void this.refreshTags(id)
      })
    }
  }
  /** A successful complete main-result replacement invalidates bounded content.
   * Related/direct demand is independent of membership in that result. */
  resultReplaced() {
    this.contentEpoch++
    void this.read([...this.needed])
  }
  importEffects(items: Wire<"ImportItem">[]) {
    const visible: string[] = []
    for (const item of items) {
      this.knownEffects(
        item.current.civitai?.examples.flatMap((e) =>
          e.target_confirmed && e.target_candidate ? [e.target_candidate] : [],
        ) ?? [],
      )
      for (const kind of item.current.kinds)
        if (kind.component_id && kind.output) this.previews.set(kind.component_id, kind.output)
      const cover = item.current.bilibili?.cover
      if (cover?.confirmed_entity_id) this.knownEffects([cover.confirmed_entity_id])
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
  tagEffects(ids?: string[]) {
    const affected = ids ?? [...this.entries.keys()]
    if (!this.api.entityTags) {
      this.knownEffects(affected)
      return
    }
    for (const id of affected) {
      const entry = this.entries.get(id)
      if (entry) {
        entry.tagVersion++
        entry.tagsDirty = true
      }
    }
    return Promise.all(affected.filter((id) => this.needed.has(id)).map((id) => this.refreshTags(id))).then(() => {})
  }
  private async refreshTags(id: string): Promise<void> {
    if (!this.api.entityTags) return
    const active = this.tagReads.get(id)
    if (active) {
      await active
      return this.refreshTags(id)
    }
    if (!this.needed.has(id) || !this.entries.get(id)?.tagsDirty) return
    const work = Promise.resolve().then(async () => {
      for (;;) {
        const entry = this.entries.get(id)
        if (!entry?.tagsDirty || !this.needed.has(id)) return
        // A full observation owns its component list until settled. Never let
        // its older Tag result overwrite a later acknowledged assignment.
        if (entry.pending) {
          await new Promise<void>((resolve) => {
            const unsubscribe = this.subscribe(() => {
              if (this.entries.get(id)?.pending && this.needed.has(id)) return
              unsubscribe()
              resolve()
            })
          })
          continue
        }
        const version = entry.tagVersion
        const previous = entry.item.components.find((c) => c.kind === "tag")
        try {
          const result = await this.api.entityTags!(id)
          if (this.entries.get(id) !== entry || entry.tagVersion !== version) continue
          if (result.entity_id !== id) throw new Error("Tag observation belongs to another Entity.")
          const next = result.tag_set ? tagProjection(result.tag_set) : undefined
          // Preserve unrelated component objects, loading state and resource
          // lifetimes. A Tag update must not restart the inspector's other reads.
          entry.item = {
            ...entry.item,
            components: previous
              ? entry.item.components.flatMap((c) => c.kind === "tag" ? next ? [next] : [] : [c])
              : [...entry.item.components, ...(next ? [next] : [])],
          }
          this.replaceProblems(entry, "tags:read", [])
          if (previous) this.replaceProblems(entry, `${previous.id}:`, [])
        } catch (error) {
          if (this.entries.get(id) !== entry || entry.tagVersion !== version) continue
          this.replaceProblems(entry, "tags:read", [{
            key: "tags:read", subject: "Personal tags", message: errorText(error),
            previous: true, recovery: "entity",
          }])
        }
        entry.tagsDirty = false
        this.changed()
        return
      }
    })
    this.tagReads.set(id, work)
    try { await work } finally { this.tagReads.delete(id) }
  }
  knownEffects(ids: string[]) {
    const changed = new Set(ids)
    const affected = new Set(ids)
    // Invalidate cached dependents too; only active subjects are read immediately.
    // An inactive video's next demand must observe known cover changes.
    for (const [id, entry] of this.entries) {
      if (
        changed.has(id) ||
        entry.item.components.some(
          (c) =>
            c.kind === "bilibili" &&
            !!c.record?.original_cover &&
            changed.has(c.record.original_cover.entity_id),
        )
      ) {
        entry.epoch = -1
        affected.add(id)
      }
    }
    const visible = [...this.needed].filter((id) => affected.has(id))
    if (visible.length) void this.read([...new Set(visible)], true)
  }
  reread(id: string) {
    const entry = this.entries.get(id)
    if (entry?.resources.size) {
      entry.resourceRevision = ++this.resourceGeneration
      if (
        entry.item.components.some(
          (c) => c.kind === "video" && entry.resources.has(`${c.id}:${c.inputFileId}`),
        )
      )
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
          refreshing: !!old?.membershipObserved,
          membershipsStatus: old?.item.membershipsStatus === "present" ? "present" : "loading",
        },
        generation: (old?.generation ?? 0) + 1,
        pending: true,
        resources: old?.resources ?? new Map(),
        resourceRevision: old?.resourceRevision ?? ++this.resourceGeneration,
        playbackRevision: old?.playbackRevision ?? ++this.resourceGeneration,
        playbackPending: old?.playbackPending ?? false,
        membershipObserved: old?.membershipObserved ?? false,
        coverRetry: old?.coverRetry,
        epoch: this.contentEpoch,
        tagVersion: old?.tagVersion ?? 0,
        tagsDirty: old?.tagsDirty ?? false,
      }
      this.entries.set(id, entry)
      return { id, entry }
    })
    this.changed()
    try {
      const memberships = await this.api.memberships(ids)
      if (
        memberships.length !== ids.length ||
        memberships.some((value, index) => value.entity_id !== ids[index])
      )
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
          const previous = entry.item.components.find(
            (c) => c.id === m.component_id && c.kindId === m.kind_id,
          )
          return previous ? { ...previous, readStatus: "loading" as const } : membershipProjection(m)
        })
        if (!components.some((c) => c.kind === "video")) this.observeVideoInput?.(id)
        const present = new Set(components.map((c) => c.id))
        entry.membershipObserved = true
        for (const key of entry.resources.keys())
          if (
            !components.some(
              (c) => (c.kind === "image" || c.kind === "video") && key.startsWith(`${c.id}:`),
            )
          )
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
          refreshing: !!entry.item.refreshing && components.some((c) => c.kind !== "unknown"),
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
                component.kind === "tag"
                  ? ((await this.api.tagSet?.(component.id)) ??
                    (() => {
                      throw new Error("Tag reader unavailable")
                    })())
                  : component.kind === "bilibili"
                    ? ((await this.api.bilibili?.(component.id)) ??
                      (() => {
                        throw new Error("Bilibili reader unavailable")
                      })())
                    : component.kind === "civitai"
                      ? ((await this.api.civitai?.(component.id)) ??
                        (() => {
                          throw new Error("Civitai read capability unavailable")
                        })())
                      : component.kind === "file"
                        ? await this.api.file(component.id)
                        : component.kind === "model"
                          ? await this.api.model(component.id)
                          : component.kind === "twitter"
                            ? await this.api.twitter(component.id)
                            : await this.api.media(component.kind as "image" | "video", component.id)
              if (this.entries.get(id) !== entry) return
              let next =
                component.kind === "tag"
                  ? tagProjection(value as Wire<"TagSetRecord">)
                  : component.kind === "bilibili"
                    ? bilibiliProjection(value as Wire<"BilibiliView">)
                    : component.kind === "civitai"
                      ? civitaiProjection(value as Wire<"CivitaiView">)
                      : "file_id" in value
                        ? fileProjection(value)
                        : component.kind === "model"
                          ? modelProjection(value as Wire<"ModelView">)
                          : "record" in value && "snapshot" in value.record
                            ? twitterProjection(value as Wire<"TwitterView">)
                            : {
                                ...mediaProjection(value as Wire<"MediaView">),
                                kindId: component.kindId,
                              }
              if (
                next.id !== component.id ||
                next.kind !== component.kind ||
                (next.kindId && next.kindId !== component.kindId)
              )
                throw new Error("The record result did not match the requested Component.")
              let retainPreviewProblems = false
              if (
                (next.kind === "image" || next.kind === "video") &&
                component.kind === next.kind &&
                next.applicability?.status === "matching" &&
                component.applicability?.status === "matching" &&
                next.applicability.file_id === component.applicability.file_id &&
                (next.kind !== "video" ||
                  (component.kind === "video" && next.streamIndex === component.streamIndex))
              ) {
                next = { ...next, thumbnail: component.thumbnail }
                retainPreviewProblems = true
              }
              if (next.kind === "bilibili" && component.kind === "bilibili" && component.cover) {
                const relation = next.view?.record.original_cover
                const context = next.view?.cover
                const input = next.view?.applicability
                if (
                  relation &&
                  relation.entity_id === component.cover.entityId &&
                  relation.file_id === component.cover.fileId &&
                  context?.status === "input" &&
                  context.comparison.status === "matching" &&
                  !context.file_error
                )
                  next = {
                    ...next,
                    cover: {
                      ...component.cover,
                      forVideo: input?.status === "input" && input.host === id &&
                        input.comparison.status === "matching" && !input.file_error,
                    },
                  }
              }
              if (next.kind === "video") {
                if (next.applicability?.status === "error" && component.kind === "video")
                  next = {
                    ...next,
                    inputFileId: component.inputFileId,
                    inputPrevious: !!component.inputFileId,
                  }
                else {
                  this.observeVideoInput?.(id, next.inputFileId)
                  if (entry.playbackPending) entry.playbackRevision = ++this.resourceGeneration
                }
                entry.playbackPending = false
              }
              this.replaceProblems(entry, component.id + ":read", [])
              entry.item = {
                ...entry.item,
                components: entry.item.components.map((c) => (c.id === component.id ? next : c)),
              }
              this.replaceProblems(
                entry,
                component.kind === "bilibili" ? component.id + ":metadata:" : `${component.id}:`,
                [
                  ...(retainPreviewProblems
                    ? (entry.item.problems ?? []).filter((p) => p.key === `${component.id}:preview`)
                    : []),
                  ...(component.kind === "tag"
                    ? []
                    : component.kind === "bilibili"
                      ? bilibiliProblems(value as Wire<"BilibiliView">, id).map((p) => ({
                          ...p,
                          key: component.id + ":metadata:" + p.key,
                        }))
                      : component.kind === "civitai"
                        ? civitaiProblems(value as Wire<"CivitaiView">).map((p) => ({
                            ...p,
                            key: `${component.id}:${p.key}`,
                          }))
                        : "file_id" in value
                          ? []
                          : (component.kind === "model"
                              ? modelProblems(value as Wire<"ModelView">, id)
                              : "record" in value && "snapshot" in value.record
                                ? twitterProblems(value as Wire<"TwitterView">, id)
                                : mediaProblems(value as Wire<"MediaView">)
                            ).map((p) => ({ ...p, key: `${component.id}:${p.key}` }))),
                ],
              )
              if (next.kind === "bilibili" && next.view) {
                this.changed()
                const loaded = await readBilibiliCover(
                  this.api,
                  next.view,
                  id,
                  component.kind === "bilibili" ? component.cover : undefined,
                  !!entry.coverRetry,
                )
                if (this.entries.get(id) !== entry) return
                let thumbnail: string | undefined
                const key = id + ":" + next.id + ":cover"
                if (loaded.bytes) {
                  thumbnail = await this.previewUrl(
                    id, entry, key,
                    JSON.stringify([loaded.cover.entityId, loaded.cover.fileId, loaded.cover.imageId]),
                    loaded.bytes,
                  )
                  if (!thumbnail) return
                } else this.forgetPreview(key)
                entry.coverRetry = false
                next = { ...next, cover: { ...loaded.cover, thumbnail } }
                entry.item = {
                  ...entry.item,
                  components: entry.item.components.map((c) => (c.id === next.id ? next : c)),
                }
                this.replaceProblems(
                  entry,
                  next.id + ":cover-dependent",
                  loaded.problems.map((p) => ({ ...p, key: next.id + ":cover-dependent:" + p.key })),
                )
              }
              if (
                (next.kind === "image" || next.kind === "video") &&
                "applicability" in next &&
                next.applicability?.status === "matching"
              ) {
                let output = this.previews.get(next.id)
                if (
                  output &&
                  (output.file_id !== next.applicability.file_id ||
                    output.kind !== next.kind ||
                    (next.kind === "video" && output.stream_index !== next.streamIndex))
                ) {
                  this.previews.delete(next.id)
                  output = undefined
                }
                if (!output && this.api.savedPreview) {
                  try {
                    output = (await this.api.savedPreview(next.kind, next.id)) ?? undefined
                    if (output) this.previews.set(next.id, output)
                  } catch (error) {
                    if (this.entries.get(id) === entry)
                      this.replaceProblems(entry, `${next.id}:preview`, [
                        {
                          key: `${next.id}:preview`,
                          subject: `${next.kind} preview`,
                          message: errorText(error),
                          previous: !!next.thumbnail,
                          recovery: "entity",
                        },
                      ])
                  }
                }
                if (this.entries.get(id) !== entry) return
                if (
                  output &&
                  output.file_id === next.applicability.file_id &&
                  output.kind === next.kind &&
                  this.api.previewBytes
                ) {
                  try {
                    const bytes = await this.api.previewBytes(
                      output.locator,
                      new AbortController().signal,
                    )
                    if (this.entries.get(id) !== entry) return
                    const key = `${id}:${next.id}`
                    const url = await this.previewUrl(
                      id, entry, key,
                      JSON.stringify([output.kind, output.file_id, output.stream_index, output.edge]),
                      bytes,
                    )
                    if (!url) return
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
                        previous: !!next.thumbnail,
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
              if (component.kind === "bilibili") entry.coverRetry = false
              const current = entry.item.components.find((c) => c.id === component.id)!
              const absent =
                error instanceof ApiFailure &&
                (error.detail.code === "missing_file" ||
                  (component.kind === "civitai" && error.detail.code === "not_found") ||
                  (error.detail.diagnostic?.owner === "model" &&
                    error.detail.diagnostic.error.code === "missing_record") ||
                  (error.detail.diagnostic?.owner === "bilibili" &&
                    error.detail.diagnostic.error.code === "missing_record") ||
                  (error.detail.diagnostic?.owner === "twitter" &&
                    error.detail.diagnostic.error.code === "missing_record") ||
                  (error.detail.diagnostic?.owner === "media" &&
                    error.detail.diagnostic.error.code === "missing_record"))
              if (absent && component.kind === "video") this.observeVideoInput?.(id)
              const previous =
                !absent &&
                current.readStatus === "loading" &&
                (("record" in current && !!current.record) ||
                  ("bytes" in current && current.bytes !== undefined))
              entry.item = {
                ...entry.item,
                components: entry.item.components.map((c) =>
                  c.id === component.id
                    ? ({
                        ...(absent ? { id: c.id, kind: c.kind, kindId: c.kindId } : c),
                        ...(c.kind === "bilibili"
                          ? {
                              cover: {
                                ...c.cover,
                                state: "failed",
                                thumbnail: undefined,
                                message: c.cover?.resourceFailed
                                  ? c.cover.message
                                  : "Current cover qualification could not be read.",
                              },
                            }
                          : {}),
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
                entry.item = {
                  ...entry.item,
                  loading: entry.pending,
                  refreshing: entry.pending && !!entry.item.refreshing,
                }
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
        entry.item = {
          ...entry.item,
          membershipsStatus: "failed",
          loading: false,
          refreshing: false,
        }
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
  private async previewUrl(id: string, entry: Entry, key: string, basis: string, bytes: Blob) {
    const revision = entry.resourceRevision
    const previous = this.previewUrls.get(key)
    // Locators do not pin cache bytes: observe the resource again, then preserve
    // its display URL only when its qualified basis and actual bytes agree.
    let unchanged = false
    if (previous?.basis === basis && previous.revision === revision &&
      previous.bytes.size === bytes.size && previous.bytes.type === bytes.type) {
      const [oldBytes, newBytes] = await Promise.all([previous.bytes.arrayBuffer(), bytes.arrayBuffer()])
      const old = new Uint8Array(oldBytes)
      unchanged = new Uint8Array(newBytes).every((value, index) => value === old[index])
    }
    if (this.entries.get(id) !== entry || entry.resourceRevision !== revision) return undefined
    if (unchanged) return previous!.url
    const url = URL.createObjectURL(bytes)
    this.forgetPreview(key)
    this.previewUrls.set(key, { url, bytes, basis, revision })
    return url
  }
  private forgetPreview(key: string) {
    const previous = this.previewUrls.get(key)
    if (previous) URL.revokeObjectURL(previous.url)
    this.previewUrls.delete(key)
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
    let removed = false
    for (const [id, entry] of this.entries) {
      if (!this.needed.has(id) && (entry.pending || this.entries.size > this.capacity)) {
        this.entries.delete(id)
        removed = true
        for (const key of this.previewUrls.keys())
          if (key.startsWith(`${id}:`)) {
            this.forgetPreview(key)
          }
      }
    }
    this.jobs = this.jobs.filter((job) => this.entries.get(job.id) === job.entry)
    if (removed) this.changed()
  }
}
