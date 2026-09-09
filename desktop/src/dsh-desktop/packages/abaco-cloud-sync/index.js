/**
 * Host half (skeleton).
 * Backend lands in Fase 3; this module is a placeholder that exposes the
 * sync service interface so the rest of the app can call it.
 */
export function apply(ctx) {
  ctx.abacoSync = {
    /** Currently authenticated account, or null. */
    account: null,
    /** Tier 1/2/3 sync engine — stub for now. */
    async pull() { throw new Error('abaco-cloud-sync: not implemented yet (Fase 3)') },
    async push() { throw new Error('abaco-cloud-sync: not implemented yet (Fase 3)') },
    async login() { throw new Error('abaco-cloud-sync: not implemented yet (Fase 3)') },
    async logout() {},
  }
}