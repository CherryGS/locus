export type ReadProblem = {
  key: string
  subject: string
  message: string
  previous?: boolean
  recovery: "entity" | "resource" | "preference-read" | "preference-save" | "preference-check"
}
