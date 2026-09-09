window.__ModuleLoader__.load({
  id: 'abaco-brand',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const BRAND = {
      productName: 'ABACO DEEP HARNES',
      shortName: 'Abaco',
      tagline: 'Centro de operaciones cerrajero, manos libres, sincronizado.',
    }

    const STYLE_ID = 'abaco-brand-style'

    function apply(ctx) {
      ctx.abacoBrand = BRAND

      // Inject minimal brand-aware styles that override the upstream wordmark
      // gap so the sidebar breathes a bit more.
      if (!document.getElementById(STYLE_ID)) {
        const s = document.createElement('style')
        s.id = STYLE_ID
        s.dataset.plugin = 'abaco-brand'
        s.textContent = `
          [data-slot="sidebar.brand.mark"], [data-slot="sidebar.brand.name"] {
            letter-spacing: -0.01em;
          }
        `
        document.head.appendChild(s)
      }
    }

    exports.apply = apply
    exports.inject = []
    return module.exports
  },
})