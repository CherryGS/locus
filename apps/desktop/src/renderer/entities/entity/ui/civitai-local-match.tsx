import type { EntityComponent } from "../model/entity-item"
import { Detail, DetailSection } from "./detail-fields"

export function CivitaiLocalMatch({ component }: { component: Extract<EntityComponent, { kind: "civitai" }> }) {
  const record = component.record
  const version = record?.model.versions.find(version => version.id === record.matched_version)
  const file = version?.files.find(file => file.id === record?.matched_file)
  return <DetailSection title="Local match">
    <dl>
      <Detail label="Model">
        {record?.model.name ?? "Not observed"}
        {record && <span className="block text-xs text-muted-foreground"><code>{record.model.id}</code> · {record.model.kind}</span>}
      </Detail>
      <Detail label="Version">{version ? `${version.name} · ${record?.matched_version}` : record?.matched_version ?? "Not observed"}</Detail>
      <Detail label="File">
        {file && <span className="block text-xs">{file.name}</span>}
        <code className="text-xs text-muted-foreground">{record?.matched_file ?? "Not observed"}</code>
      </Detail>
      <Detail label="Status">{component.view?.input ? component.view.input.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase()) : "Not observed"}</Detail>
      {component.view?.problem && <Detail label="Problem">{component.view.problem}</Detail>}
    </dl>
  </DetailSection>
}
