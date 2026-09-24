import type { BilibiliComponent } from "../model/bilibili-projection"
import { Detail, DetailSection } from "./detail-fields"
import { CapturedText, SourceLink } from "./twitter-fields"
export function BilibiliDetails({ component }: { component: BilibiliComponent }) {
  const r = component.record,
    s = r?.snapshot,
    a = component.view?.applicability,
    c = component.view?.cover
  if (!r || !s) return null
  return (
    <>
      <DetailSection title="Bilibili Source">
        <dl>
          <Detail label="Component">{component.id}</Detail>
          <Detail label="Revision">{r.revision}</Detail>
          <Detail label="BVID">{s.bvid ?? "Not captured"}</Detail>
          <Detail label="AV identifier">{s.aid ?? "Not captured"}</Detail>
          <Detail label="Title">
            <CapturedText value={s.title ?? undefined} />
          </Detail>
          <Detail label="Subject URL">
            <SourceLink url={s.page_url ?? undefined} />
          </Detail>
          <Detail label="Requested URL">
            <SourceLink url={s.requested_url ?? undefined} />
          </Detail>
          <Detail label="Observed time">{s.observed_at_unix_ms ?? "Not captured"}</Detail>
          <Detail label="Published time">{s.published_at_unix_ms ?? "Not captured"}</Detail>
        </dl>
      </DetailSection>
      <DetailSection title="Captured author">
        <dl>
          <Detail label="User ID">{s.author?.user_id ?? "Not captured"}</Detail>
          <Detail label="Display name">
            <CapturedText value={s.author?.display_name ?? undefined} />
          </Detail>
          <Detail label="Profile">
            <SourceLink url={s.author?.profile_url ?? undefined} />
          </Detail>
        </dl>
      </DetailSection>
      <DetailSection title="Selected part">
        <dl>
          <Detail label="CID">{s.part?.cid ?? "Not captured"}</Detail>
          <Detail label="Number">{s.part?.number ?? "Not captured"}</Detail>
          <Detail label="Title">
            <CapturedText value={s.part?.title ?? undefined} />
          </Detail>
          {Object.entries(s.part?.claims ?? {})
            .filter(([, v]) => v != null)
            .map(([key, value]) => (
              <Detail key={key} label={key.replaceAll("_", " ")}>
                {String(value)}
              </Detail>
            ))}
        </dl>
      </DetailSection>
      <DetailSection title="Local-item association">
        <dl>
          <Detail label="Accepted File">{r.basis ?? "Unassociated"}</Detail>
          <Detail label="Current state">
            {a?.status === "input" ? a.comparison.status : (a?.status ?? "Not observed")}
          </Detail>
          <Detail label="Actual host">{a?.status === "input" ? a.host : "Not observed"}</Detail>
        </dl>
      </DetailSection>
      <DetailSection title="Original-cover association">
        <dl>
          <Detail label="Target Entity">{r.original_cover?.entity_id ?? "No relation"}</Detail>
          <Detail label="Accepted File">{r.original_cover?.file_id ?? "No basis"}</Detail>
          <Detail label="Current state">
            {c?.status === "input" ? c.comparison.status : (c?.status ?? "Not observed")}
          </Detail>
          <Detail label="Image">{component.cover?.imageId ?? "Not observed"}</Detail>
          <Detail label="Representation">{component.cover?.state ?? "Not observed"}</Detail>
        </dl>
      </DetailSection>
      <DetailSection title="Selected representation">
        <dl>
          <Detail label="URL">
            <SourceLink url={s.representation?.url ?? undefined} />
          </Detail>
          {Object.entries(s.representation?.claims ?? {})
            .filter(([, v]) => v != null)
            .map(([key, value]) => (
              <Detail key={key} label={key.replaceAll("_", " ")}>
                {String(value)}
              </Detail>
            ))}
        </dl>
        <p className="text-xs text-muted-foreground">
          Source-reported claims; independent of local Video interpretation.
        </p>
      </DetailSection>
      <DetailSection title="Remote preview">
        <dl>
          <Detail label="URL">
            <SourceLink url={s.preview?.url ?? undefined} />
          </Detail>
          <Detail label="Description">
            <CapturedText value={s.preview?.description ?? undefined} />
          </Detail>
          {Object.entries(s.preview?.claims ?? {})
            .filter(([, v]) => v != null)
            .map(([key, value]) => (
              <Detail key={key} label={key.replaceAll("_", " ")}>
                {String(value)}
              </Detail>
            ))}
        </dl>
        <p className="text-xs text-muted-foreground">
          Descriptive capture only. This remote image is not fetched automatically.
        </p>
      </DetailSection>
    </>
  )
}
