// One instance per active library/backend session; never persisted. Inactive
// videos retain only their current File identity and position, not DOM or bytes.
export class PlaybackCoordinator {
  private positions = new Map<string, { fileId: string; position: number }>()
  private active?: { entityId: string; fileId: string; stop: () => void }
  volume = 1
  muted = false
  position(entityId: string, fileId: string) {
    const previous = this.positions.get(entityId)
    if (previous?.fileId !== fileId) {
      this.positions.set(entityId, { fileId, position: 0 })
      return 0
    }
    return previous.position
  }
  observe(entityId: string, fileId?: string) {
    if (this.active?.entityId === entityId && this.active.fileId !== fileId) this.pause()
    if (!fileId) this.positions.delete(entityId)
    else if (this.positions.has(entityId) && this.positions.get(entityId)?.fileId !== fileId)
      this.positions.set(entityId, { fileId, position: 0 })
  }
  forget(entityId: string) {
    this.observe(entityId)
  }
  activate(entityId: string, fileId: string, stop: () => void) {
    this.pause()
    const lease = { entityId, fileId, stop }
    this.active = lease
    const position = this.position(entityId, fileId)
    return {
      position,
      save: (position: number, volume: number, muted: boolean) => {
        if (this.active !== lease) return
        if (this.positions.get(entityId)?.fileId === fileId && Number.isFinite(position) && position >= 0)
          this.positions.set(entityId, { fileId, position })
        this.volume = Math.max(0, Math.min(1, volume))
        this.muted = muted
      },
      release: () => {
        if (this.active !== lease) return
        stop()
        this.active = undefined
      },
    }
  }
  pause() {
    this.active?.stop()
  }
}
