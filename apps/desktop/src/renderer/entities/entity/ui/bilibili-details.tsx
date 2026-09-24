import { Separator } from "@/shared/ui/separator"
import { Detail, DetailSection, DetailTime } from "./detail-fields"
import { CapturedText, SourceLink } from "./source-fields"
import type { BilibiliComponent } from "./bilibili-post"
import type { Wire } from "@/shared/api"

const capturedTime = (value: string | null | undefined) =>
  value == null ? undefined : new Date(Number(value)).toISOString()

export function BilibiliDetails({ component }: { component: BilibiliComponent }) {
  const s = component.record?.snapshot
  if (!s) return null
  const published = capturedTime(s.published_at_unix_ms),
    observed = capturedTime(s.observed_at_unix_ms)
  return (
    <div className="flex min-w-0 flex-col pb-1">
      <DetailSection title="Submission">
        <dl>
          <Detail label="Title">
            <CapturedText value={s.title ?? undefined} />
          </Detail>
          <Detail label="Page">
            <SourceLink url={s.page_url ?? undefined}>Open selected part</SourceLink>
          </Detail>
          <Detail label="BVID">
            <CapturedText value={s.bvid ?? undefined} />
          </Detail>
          <Detail label="AID">
            <CapturedText value={s.aid ?? undefined} />
          </Detail>
        </dl>
        <p className="text-xs leading-5 select-text">
          <CapturedText value={s.description ?? undefined} empty="No description" />
        </p>
      </DetailSection>
      <Separator />
      <DetailSection title="Selected part">
        <dl>
          <Detail label="CID">
            <CapturedText value={s.part?.cid ?? undefined} />
          </Detail>
          <Detail label="Part number">{s.part?.index ?? "Not captured"}</Detail>
          <Detail label="Part title">
            <CapturedText value={s.part?.title ?? undefined} />
          </Detail>
          <Detail label="Duration (ms)">
            <CapturedText value={s.part?.duration_ms ?? undefined} />
          </Detail>
          <Detail label="Asset role">
            {s.asset_role === "cover"
              ? "Submission cover"
              : s.asset_role === "video"
                ? "Video"
                : "Not captured"}
          </Detail>
        </dl>
      </DetailSection>
      <Separator />
      <DetailSection title="Uploader">
        <dl>
          <Detail label="Name">
            <CapturedText value={s.uploader?.display_name ?? undefined} />
          </Detail>
          <Detail label="User ID">
            <CapturedText value={s.uploader?.user_id ?? undefined} />
          </Detail>
          <Detail label="Profile">
            <SourceLink url={s.uploader?.profile_url ?? undefined}>Open profile</SourceLink>
          </Detail>
        </dl>
      </DetailSection>
      <Separator />
      <DetailSection title="Dates">
        <dl>
          <Detail label="Published">{published ? <DetailTime value={published} /> : "Not captured"}</Detail>
          <Detail label="Observed">{observed ? <DetailTime value={observed} /> : "Not captured"}</Detail>
        </dl>
      </DetailSection>
      <Separator />
      <DetailSection title="Selected representation">
        <dl>
          <Detail label="URL">
            <SourceLink url={s.representation?.url ?? undefined} />
          </Detail>
          <Detail label="Assembled">
            {s.representation?.assembled == null ? "Not captured" : s.representation.assembled ? "Yes" : "No"}
          </Detail>
          <Claims value={s.representation?.claims} />
          <Detail label="Input resources">
            {s.representation?.source_urls == null ? (
              "Not captured"
            ) : s.representation.source_urls.length === 0 ? (
              "None"
            ) : (
              <div className="flex flex-col gap-2">
                {s.representation.source_urls.map((url, index) => (
                  <SourceLink key={`${index}:${url}`} url={url} />
                ))}
              </div>
            )}
          </Detail>
        </dl>
      </DetailSection>
      <Separator />
      <DetailSection title="Remote submission cover">
        <dl>
          <Detail label="URL">
            <SourceLink url={s.preview?.url ?? undefined} />
          </Detail>
          <Detail label="Description">
            <CapturedText value={s.preview?.description ?? undefined} />
          </Detail>
          <Claims value={s.preview?.claims} />
        </dl>
      </DetailSection>
      <Separator />
      <DetailSection title="Capture context">
        <dl>
          <Detail label="Requested URL">
            <SourceLink url={s.requested_url ?? undefined} />
          </Detail>
          <Detail label="Capture-local ID">
            <CapturedText value={s.capture_local_id ?? undefined} />
          </Detail>
        </dl>
      </DetailSection>
    </div>
  )
}

function Claims({ value }: { value: Wire<"BilibiliMediaClaims"> | null | undefined }) {
  return (
    <>
      <Detail label="Width">{value?.width ?? "Not captured"}</Detail>
      <Detail label="Height">{value?.height ?? "Not captured"}</Detail>
      <Detail label="Duration (ms)">
        <CapturedText value={value?.duration_ms ?? undefined} />
      </Detail>
      <Detail label="Quality">
        <CapturedText value={value?.quality ?? undefined} />
      </Detail>
      <Detail label="MIME">
        <CapturedText value={value?.mime_type ?? undefined} />
      </Detail>
      <Detail label="Container">
        <CapturedText value={value?.container ?? undefined} />
      </Detail>
      <Detail label="Video codec">
        <CapturedText value={value?.video_codec ?? undefined} />
      </Detail>
      <Detail label="Audio codec">
        <CapturedText value={value?.audio_codec ?? undefined} />
      </Detail>
      <Detail label="Audio present">
        {value?.audio_present == null ? "Not captured" : value.audio_present ? "Yes" : "No"}
      </Detail>
      <Detail label="Bitrate (bps)">
        <CapturedText value={value?.bitrate_bps ?? undefined} />
      </Detail>
    </>
  )
}
