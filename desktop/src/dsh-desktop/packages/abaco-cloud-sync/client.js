window.__ModuleLoader__.load({
  id: 'abaco-cloud-sync',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    function apply(ctx) {
      // Skeleton — will be filled when backend lands.
      ctx.abacoSync = ctx.abacoSync || {
        account: null,
        async login() { return { ok: false, reason: 'not-implemented' } },
      }
    }

    exports.apply = apply
    exports.inject = []
    return module.exports
  },
})