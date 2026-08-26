export class SessionShellForegroundConfirmation {
  private confirmation: Promise<boolean> | null = null

  constructor(
    private readonly confirmProcess: (() => Promise<boolean>) | undefined,
    private readonly isAlive: () => boolean,
    private readonly isAlreadyConfirmed: () => boolean
  ) {}

  confirm(): Promise<boolean> {
    if (!this.isAlive()) {
      return Promise.resolve(false)
    }
    if (this.isAlreadyConfirmed()) {
      return Promise.resolve(true)
    }
    if (!this.confirmProcess) {
      return Promise.resolve(false)
    }
    if (!this.confirmation) {
      const pending = this.confirmProcess()
        .then((confirmed) => this.isAlive() && confirmed)
        .catch(() => false)
      this.confirmation = pending
      void pending.finally(() => {
        if (this.confirmation === pending) {
          this.confirmation = null
        }
      })
    }
    return this.confirmation
  }
}
