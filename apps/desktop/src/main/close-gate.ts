import type {
  CloseAction,
  CloseCommit,
  CloseState,
  Preparation,
  LifecycleIntent,
} from "../shared/desktop-bridge.ts"

/** One current attempt; explicit consent and both readiness reports are generation-bound. */
export class CloseGate {
  state: CloseState = { phase: "idle" }
  begin(attemptId: string, intent: LifecycleIntent = "close") {
    if (this.state.phase !== "idle") return false
    this.state = { phase: "preparing", attemptId, intent }
    return true
  }
  prepared(result: Preparation) {
    if (
      this.state.phase === "idle" ||
      this.state.phase === "draining" ||
      result.attemptId !== this.state.attemptId
    )
      return false
    const intent = this.state.intent ?? "close"
    if (intent === "restart" && !result.settings) return false
    if (
      "revision" in this.state &&
      (result.revision < this.state.revision ||
        (result.settings?.revision ?? 0) < (this.state.settings?.revision ?? 0))
    )
      return false
    const unconfirmed = result.items.length || result.settings?.draft || result.settings?.blocked
    const next: CloseState = unconfirmed
      ? { phase: "unconfirmed", ...result, intent }
      : {
          phase: "sealing",
          attemptId: result.attemptId,
          revision: result.revision,
          settings: result.settings,
          intent,
          continueExit: false,
        }
    if (JSON.stringify(next) === JSON.stringify(this.state)) return false
    this.state = next
    return true
  }
  action(action: CloseAction) {
    if (
      this.state.phase === "idle" ||
      this.state.phase === "draining" ||
      action.attemptId !== this.state.attemptId
    )
      return false
    if (action.action === "return") {
      this.state = { phase: "idle" }
      return true
    }
    if (
      this.state.phase !== "unconfirmed" ||
      action.revision !== this.state.revision ||
      (this.state.settings && action.settingsRevision !== this.state.settings.revision)
    )
      return false
    if (
      this.state.intent === "restart" &&
      (this.state.items.length || this.state.settings?.blocked || !this.state.settings)
    )
      return false
    this.state = {
      phase: "sealing",
      attemptId: action.attemptId,
      revision: action.revision,
      settings: this.state.settings,
      intent: this.state.intent,
      continueExit: true,
    }
    return true
  }
  commit(commit: CloseCommit) {
    if (
      this.state.phase !== "sealing" ||
      commit.attemptId !== this.state.attemptId ||
      commit.revision !== this.state.revision ||
      (this.state.settings && commit.settingsRevision !== this.state.settings.revision)
    )
      return false
    this.state = { phase: "draining", attemptId: commit.attemptId, intent: this.state.intent }
    return true
  }
}
