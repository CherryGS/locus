import type { CloseAction, CloseCommit, CloseState, Preparation } from "../shared/desktop-bridge.ts"

/** Renderer seals its intent before commit; return invalidates the attempt. */
export class CloseGate {
  state: CloseState = { phase: "idle" }
  begin(attemptId: string) {
    if (this.state.phase !== "idle") return false
    this.state = { phase: "preparing", attemptId }
    return true
  }
  prepared(result: Preparation) {
    if (this.state.phase === "idle" || this.state.phase === "draining" || result.attemptId !== this.state.attemptId)
      return false
    if ("revision" in this.state && result.revision < this.state.revision) return false
    if (
      this.state.phase === "unconfirmed" &&
      this.state.revision === result.revision &&
      JSON.stringify(this.state.items) === JSON.stringify(result.items)
    )
      return false
    this.state = result.items.length
      ? { phase: "unconfirmed", ...result }
      : { phase: "sealing", attemptId: result.attemptId, revision: result.revision, continueExit: false }
    return true
  }
  action(action: CloseAction) {
    if (this.state.phase === "idle" || this.state.phase === "draining" || action.attemptId !== this.state.attemptId)
      return false
    if (action.action === "return") {
      this.state = { phase: "idle" }
      return true
    }
    if (this.state.phase !== "unconfirmed" || action.revision !== this.state.revision) return false
    this.state = { phase: "sealing", attemptId: action.attemptId, revision: action.revision, continueExit: true }
    return true
  }
  commit(commit: CloseCommit) {
    if (
      this.state.phase !== "sealing" ||
      commit.attemptId !== this.state.attemptId ||
      commit.revision !== this.state.revision
    )
      return false
    this.state = { phase: "draining", attemptId: commit.attemptId }
    return true
  }
}
