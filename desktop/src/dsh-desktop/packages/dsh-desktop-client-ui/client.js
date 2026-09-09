window.__ModuleLoader__.load({
  id: 'dsh-desktop-client-ui',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    // ── ABACO brand (replaces the upstream DeepSeek wordmark artwork and
    // fish-logo primitives that used to occupy these seats) ────────────────
    // Inline SVG of the stylized 3D "A" monolith (navy/blue + warm rim),
    // matching desktop/brand/logo.svg but without the backing rectangle so it
    // works as a transparent brand mark in the sidebar and conversation hero.
    // ViewBox: 170 x 260 user units. Each mount gets unique gradient ids and
    // an explicit pixel size (the slots give no width/height context, and a
    // bare <svg> would fall back to the 300x150 replaced-element default).
    const ABACO_A_SVG = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-80 -140 170 260" role="img" aria-label="ABACO" {sizing}>',
      '<defs>',
      '<linearGradient id="abacoFront" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#3D6FB2"/><stop offset="100%" stop-color="#0E2147"/></linearGradient>',
      '<linearGradient id="abacoRight" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#2A4F87"/><stop offset="100%" stop-color="#070C1F"/></linearGradient>',
      '<linearGradient id="abacoLeft" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#D9A48B"/><stop offset="35%" stop-color="#7A6A8B"/><stop offset="100%" stop-color="#1B2548"/></linearGradient>',
      '<linearGradient id="abacoEdge" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#7989B0"/><stop offset="50%" stop-color="#C9D3E8"/><stop offset="100%" stop-color="#5A6488"/></linearGradient>',
      '</defs>',
      '<g transform="translate(0 0)">',
      '<path d="M -8 -130 L 8 -130 L 60 70 L 30 70 L 16 30 L -16 30 L -30 70 L -60 70 Z" fill="url(#abacoLeft)" transform="translate(-60 0)"/>',
      '<path d="M -8 -130 L 8 -130 L 60 70 L 30 70 L 16 30 L -16 30 L -30 70 L -60 70 Z" fill="url(#abacoRight)" transform="translate(60 0) scale(-1 1)"/>',
      '<path d="M -8 -130 L 8 -130 L 60 70 L 30 70 L 16 30 L -16 30 L -30 70 L -60 70 Z" fill="url(#abacoFront)"/>',
      '<path d="M -16 30 L 16 30 L 0 -30 Z" fill="#0A1230"/>',
      '<path d="M -8 -130 L 68 110 L 28 110 L 22 80 L -22 80 L -28 110 L -68 110 Z" fill="none" stroke="url(#abacoEdge)" stroke-width="2"/>',
      '<line x1="-50" y1="70" x2="50" y2="70" stroke="url(#abacoEdge)" stroke-width="2"/>',
      '<line x1="-22" y1="80" x2="22" y2="80" stroke="url(#abacoEdge)" stroke-width="2"/>',
      '</g>',
      '</svg>'
    ].join('')

    // Unique gradient ids per mount (multiple brand marks can be on page).
    let gradientSeq = 0
    /**
     * @param height - rendered height in px; width follows the 170:260 viewBox.
     * @returns ABACO emblem svg markup with unique gradient ids.
     */
    function abacoMarkSvg(height) {
      const seq = ++gradientSeq
      const width = Math.round((height * 170) / 260)
      return ABACO_A_SVG.replace('{sizing}', `width="${width}" height="${height}"`)
        .replace(/abacoFront/g, `abacoFront${seq}`)
        .replace(/abacoRight/g, `abacoRight${seq}`)
        .replace(/abacoLeft/g, `abacoLeft${seq}`)
        .replace(/abacoEdge/g, `abacoEdge${seq}`)
    }

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
        .abacoBrandMark svg {
          display: block;
          flex: none;
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

    function DesktopBrandMark(props) {
      // The 3D "A" monolith as the sidebar brand mark (wide and rail seats).
      const size = slotSize(props, 24)
      return React.createElement('span', {
        className: 'abacoBrandMark',
        style: { width: `${Math.round((size * 170) / 260)}px`, height: `${size}px` },
        dangerouslySetInnerHTML: { __html: abacoMarkSvg(size) }
      })
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
        style: { width: `${Math.round((size * 170) / 260)}px`, height: `${size}px` },
        dangerouslySetInnerHTML: { __html: abacoMarkSvg(size) }
      })
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
