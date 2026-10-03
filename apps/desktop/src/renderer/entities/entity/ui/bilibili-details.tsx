import type { BilibiliComponent } from "../model/bilibili-projection"
import { diagnosticText, type Wire } from "@/shared/api"
import {
  Detail,
  DetailDurationMilliseconds,
  DetailIdentifier,
  DetailSection,
  DetailUnixTime,
} from "./detail-fields"
import { CapturedText, SourceLink } from "./twitter-fields"
import { Separator } from "@/shared/ui/separator"
export function BilibiliDetails({
  component,
  showIdentity = true,
}: {
  component: BilibiliComponent
  showIdentity?: boolean
}) {
  const r = component.record,
    s = r?.snapshot,
    a = component.view?.applicability,
    c = component.view?.cover
  if (!r || !s) return null
  return (
    <>
      <DetailSection title="Bilibili Source">
        <dl>
          <Detail label="BVID">{s.bvid ?? "Not captured"}</Detail>
          <Detail label="Title">
            <CapturedText value={s.title ?? undefined} />
          </Detail>
          <Detail label="Subject URL">
            <SourceLink url={s.page_url ?? undefined} />
          </Detail>
          <Detail label="Published">
            <DetailUnixTime value={s.published_at_unix_ms} />
          </Detail>
          <Detail label="Observed">
            <DetailUnixTime value={s.observed_at_unix_ms} />
          </Detail>
        </dl>
      </DetailSection>
      <Separator />
      <DetailSection title="Author">
        <dl>
          <Detail label="Display name">
            <CapturedText value={s.author?.display_name ?? undefined} />
          </Detail>
          <Detail label="Profile">
            <SourceLink url={s.author?.profile_url ?? undefined} />
          </Detail>
        </dl>
      </DetailSection>
      <Separator />
      <DetailSection title="Selected part">
        <dl>
          <Detail label="Number">{s.part?.number ?? "Not captured"}</Detail>
          <Detail label="Title">
            <CapturedText value={s.part?.title ?? undefined} />
          </Detail>
          {s.part?.claims?.duration_ms != null && (
            <Detail label="Source duration">
              <DetailDurationMilliseconds value={s.part.claims.duration_ms} />
            </Detail>
          )}
        </dl>
      </DetailSection>
      <Separator />
      <DetailSection title="Local association">
        <dl>
          <Detail label="Current state">
            {a?.status === "input" ? a.comparison.status : (a?.status ?? "Not observed")}
          </Detail>
          {a?.status === "input" && a.file_error && (
            <Detail label="File problem">{a.file_error.message}</Detail>
          )}
          {a?.status === "error" && (
            <Detail label="Problem">{diagnosticText({ owner: "bilibili", error: a.error })}</Detail>
          )}
        </dl>
      </DetailSection>
      <Separator />
      <DetailSection title="Original-cover association">
        <dl>
          <Detail label="Current state">
            {c?.status === "input" ? c.comparison.status : (c?.status ?? "Not observed")}
          </Detail>
          <Detail label="Representation">{component.cover?.state ?? "Not observed"}</Detail>
          {c?.status === "input" && c.file_error && (
            <Detail label="File problem">{c.file_error.message}</Detail>
          )}
          {c?.status === "error" && <Detail label="Problem">{c.diagnostic.message}</Detail>}
          {component.cover?.message && <Detail label="Cover problem">{component.cover.message}</Detail>}
        </dl>
      </DetailSection>
      <Separator />
      <DetailSection title="Capture details">
        <dl>
          {showIdentity && (
            <Detail label="Component">
              <DetailIdentifier label="Component ID" value={component.id} />
            </Detail>
          )}
          <Detail label="Revision">{r.revision}</Detail>
          <Detail label="AV identifier">
            {s.aid != null ? <DetailIdentifier label="AV identifier" value={s.aid} /> : "Not captured"}
          </Detail>
          <Detail label="User ID">
            {s.author?.user_id != null ? (
              <DetailIdentifier label="User ID" value={s.author.user_id} />
            ) : (
              "Not captured"
            )}
          </Detail>
          <Detail label="CID">
            {s.part?.cid != null ? <DetailIdentifier label="CID" value={s.part.cid} /> : "Not captured"}
          </Detail>
          <Detail label="Requested URL">
            <SourceLink url={s.requested_url ?? undefined} />
          </Detail>
          <CapturedClaims claims={s.part?.claims} />
        </dl>
        <p className="text-xs text-muted-foreground">Part claims were reported by the source.</p>
      </DetailSection>
      <Separator />
      <DetailSection title="Association identifiers">
        <dl>
          <Detail label="Accepted File">
            {r.basis ? <DetailIdentifier label="Accepted File" value={r.basis} /> : "Unassociated"}
          </Detail>
          <Detail label="Actual host">
            {a?.status === "input" ? (
              <DetailIdentifier label="Actual host" value={a.host} />
            ) : (
              "Not observed"
            )}
          </Detail>
          <Detail label="Cover Entity">
            {r.original_cover ? (
              <DetailIdentifier label="Cover Entity" value={r.original_cover.entity_id} />
            ) : (
              "No relation"
            )}
          </Detail>
          <Detail label="Cover File">
            {r.original_cover ? (
              <DetailIdentifier label="Cover File" value={r.original_cover.file_id} />
            ) : (
              "No basis"
            )}
          </Detail>
          <Detail label="Cover Image">
            {component.cover?.imageId ? (
              <DetailIdentifier label="Cover Image" value={component.cover.imageId} />
            ) : (
              "Not observed"
            )}
          </Detail>
        </dl>
      </DetailSection>
      <Separator />
      <DetailSection
        title="Selected representation"
      >
        <dl>
          <Detail label="URL">
            <SourceLink url={s.representation?.url ?? undefined} />
          </Detail>
          <CapturedClaims claims={s.representation?.claims} />
        </dl>
        <p className="text-xs text-muted-foreground">
          Source-reported claims; independent of local Video interpretation.
        </p>
      </DetailSection>
      <Separator />
      <DetailSection
        title="Remote preview"
      >
        <dl>
          <Detail label="URL">
            <SourceLink url={s.preview?.url ?? undefined} />
          </Detail>
          <Detail label="Description">
            <CapturedText value={s.preview?.description ?? undefined} />
          </Detail>
          <CapturedClaims claims={s.preview?.claims} />
        </dl>
        <p className="text-xs text-muted-foreground">
          Descriptive capture only. This remote image is not fetched automatically.
        </p>
      </DetailSection>
    </>
  )
}

function CapturedClaims({ claims }: { claims: Wire<"BilibiliMediaClaims"> | null | undefined }) {
  if (claims == null) return <Detail label="Claims">Not captured</Detail>
  const observed = Object.entries(claims).filter(([, value]) => value != null)
  if (!observed.length) return <Detail label="Claims">No claims supplied</Detail>
  return observed.map(([key, value]) => (
    <Detail key={key} label={key.replaceAll("_", " ")}>
      {key === "duration_ms" ? <DetailDurationMilliseconds value={value} /> : String(value)}
    </Detail>
  ))
}
