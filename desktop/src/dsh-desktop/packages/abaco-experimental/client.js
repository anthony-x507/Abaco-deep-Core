window.__ModuleLoader__.load({
  id: 'abaco-experimental',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const FEATURES_KEY = 'abaco-experimental:features'
    const DEFAULTS = {
      telemetryLocal: false,
      betaChannel: false,
      verboseLogs: false,
      pluginSandboxRelaxed: false,
    }

    function apply(_ctx) {
      const bag = (typeof window !== 'undefined' && (window.__abaco_services = window.__abaco_services || {})) || {}
      const store = bag.store
      bag.features = {
        async list() {
          if (!store) return DEFAULTS
          const raw = await store.get(FEATURES_KEY)
          try { return { ...DEFAULTS, ...JSON.parse(raw || '{}') } } catch { return DEFAULTS }
        },
        async set(key, value) {
          if (!store) return
          const cur = await bag.features.list()
          const next = { ...cur, [key]: !!value }
          await store.set(FEATURES_KEY, JSON.stringify(next))
          return next
        },
      }
    }

    exports.apply = apply
    exports.inject = []
    return module.exports
  },
})