window.__ModuleLoader__.load({
  id: 'abaco-device-identity',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    // In the renderer we don't have access to the Host context directly.
    // The Host passes identity via a global property injected by the main
    // process on boot. This plugin just reads it.
    const DEVICE_GLOBAL = '__ABACO_DEVICE__'

    function apply(_ctx) {
      // Cordis forbids undeclared ctx.* without inject ("cannot get property …
      // without inject"). Publish helpers on a plain window bag instead.
      const bag = (typeof window !== 'undefined' && (window.__abaco_services = window.__abaco_services || {})) || {}
      bag.getDevice = () => {
        if (typeof window !== 'undefined' && window[DEVICE_GLOBAL]) return window[DEVICE_GLOBAL]
        return null
      }
      const inMemoryStore = new Map()
      const localKey = 'abaco-device-store'
      let persisted = {}
      try {
        persisted = JSON.parse(window.localStorage.getItem(localKey) || '{}')
      } catch {}

      for (const [k, v] of Object.entries(persisted)) inMemoryStore.set(k, v)

      bag.store = {
        async get(key) {
          return inMemoryStore.get(key) ?? null
        },
        async set(key, value) {
          inMemoryStore.set(key, value)
          persisted[key] = value
          try {
            window.localStorage.setItem(localKey, JSON.stringify(persisted))
          } catch {}
        },
        async delete(key) {
          inMemoryStore.delete(key)
          delete persisted[key]
          try {
            window.localStorage.setItem(localKey, JSON.stringify(persisted))
          } catch {}
        },
      }
    }

    exports.apply = apply
    exports.inject = []
    return module.exports
  },
})