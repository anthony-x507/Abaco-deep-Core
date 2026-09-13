window.__ModuleLoader__.load({
  id: 'dsh-desktop-client-ui',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    // ── ABACO brand (replaces the upstream DeepSeek wordmark artwork and
    // fish-logo primitives that used to occupy these seats) ────────────────
    // Raster mark from build/app-icon.png (installed as /dsh-desktop-logo.png
    // by scripts/install-brand-assets.mjs). Square crop of the stylized A.
    const ABACO_MARK_SRC = '/dsh-desktop-logo.png'

    const STYLE_ID = 'dsh-desktop-client-ui-style'

    function installStyles() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.dataset.plugin = 'dsh-desktop-client-ui'
      style.textContent = `
        .abacoBrandMark {
          display: inline-flex;
          align-items: center;
          flex: none;
          line-height: 0;
          -webkit-user-drag: none;
          user-select: none;
        }
        .abacoBrandMark img {
          display: block;
          flex: none;
          object-fit: contain;
          border-radius: 4px;
        }
        .abacoBrandName {
          display: inline-flex;
          align-items: center;
          height: 24px;
          white-space: nowrap;
          color: inherit;
          font-size: 18px;
          font-weight: 600;
          line-height: 24px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
        body[data-ds-dark-theme] .abacoBrandMark {
          filter: drop-shadow(0 0 1px rgba(255, 255, 255, 0.28));
        }
      `
      document.head.appendChild(style)
    }

    function slotSize(props, fallback) {
      return props && typeof props.size === 'number' ? props.size : fallback
    }

    function BrandMarkImage(size) {
      return React.createElement('img', {
        src: ABACO_MARK_SRC,
        alt: 'ABACO',
        'aria-label': 'ABACO',
        width: size,
        height: size,
        draggable: false,
      })
    }

    function DesktopBrandMark(props) {
      // Stylized A (PNG) as the sidebar brand mark (wide and rail seats).
      const size = slotSize(props, 24)
      return React.createElement('span', {
        className: 'abacoBrandMark',
        style: { width: `${size}px`, height: `${size}px` },
      }, BrandMarkImage(size))
    }

    function DesktopBrandName() {
      // "ABACO" wordmark next to the mark (no DeepSeek wordmark artwork).
      return React.createElement('span', { className: 'abacoBrandName' }, 'ABACO')
    }

    function ConversationBrandMark(props) {
      // Hero brand mark on empty/conversation screens (slot requests size 34).
      const size = slotSize(props, 34)
      const extraClass = props && typeof props.className === 'string' ? ` ${props.className}` : ''
      return React.createElement('span', {
        className: `abacoBrandMark${extraClass}`,
        style: { width: `${size}px`, height: `${size}px` },
      }, BrandMarkImage(size))
    }

    const inject = ['slots']
    function apply(ctx) {
      installStyles()
      ctx.slots.inject('sidebar.brand.mark', () =>
        ctx.slots.inject('sidebar.brand.name', () =>
          ctx.slots.inject('conversation.hero.brand.mark', function* () {
            yield ctx.slots.register({ name: 'sidebar.brand.mark' }, DesktopBrandMark)
            yield ctx.slots.register({ name: 'sidebar.brand.name' }, DesktopBrandName)
            yield ctx.slots.register(
              { name: 'conversation.hero.brand.mark' },
              ConversationBrandMark
            )
          })
        )
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
