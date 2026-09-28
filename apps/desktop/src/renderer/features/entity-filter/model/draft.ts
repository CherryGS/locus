import type { Wire } from "@/shared/api"
export type FieldDefinition = Wire<"Search_FieldDefinition">
export type FilterDraft = { name: string; source: Wire<"FilterSource"> }
export const emptyDraft = (): FilterDraft => ({
  name: "",
  source: { format: "", version: 0, text: "" },
})
export const humanize = (value: string) => value.replaceAll("_", " ").replaceAll(".", " · ")
