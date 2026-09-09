window.__ModuleLoader__.load({
  id: 'dsh-desktop-client-ui',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    // ── ABACO brand (replaces DeepSeek BrandWordmark / FishLogo) ──────────
    // Inline SVG of the stylized 3D "A" monolith (navy/blue + warm rim),
    // matching desktop/brand/logo.svg but without the backing rectangle so it
    // works as a transparent brand mark in the sidebar and conversation hero.
    const ABACO_A_SVG = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-80 -140 170 260" role="img" aria-label="ABACO">',
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
    function abacoMarkSvg() {
      const seq = ++gradientSeq
      return ABACO_A_SVG.replace(/abacoFront/g, `abacoFront${seq}`)
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
        .abacoBrandName{display:flex;align-items:center;gap:7px;color:inherit;text-decoration:none}
        .abacoBrandName .abacoName{font-weight:700;letter-spacing:.06em;font-size:13px;line-height:1}
        .abacoBrandName .abacoSub{font-size:8px;letter-spacing:.22em;opacity:.65;margin-top:1px}
      `
      document.head.appendChild(style)
    }

    function DesktopBrandMark() {
      // The 3D "A" monolith as the sidebar brand mark.
      return React.createElement('span', {
        className: 'abacoBrandMark',
        style: { display: 'inline-flex', alignItems: 'center' },
        dangerouslySetInnerHTML: { __html: abacoMarkSvg() },
      })
    }

    function DesktopBrandName() {
      // "ABACO / DEEP CORE" wordmark next to the mark (no DeepSeek wordmark).
      return React.createElement(
        'span',
        { className: 'abacoBrandName' },
        React.createElement('span', { className: 'abacoName', dangerouslySetInnerHTML: { __html: abacoMarkSvg() } }),
        React.createElement(
          'span',
          { style: { display: 'flex', flexDirection: 'column', lineHeight: 1.1 } },
          React.createElement('span', { className: 'abacoName' }, 'ABACO'),
          React.createElement('span', { className: 'abacoSub' }, 'DEEP CORE')
        )
      )
    }

    function ConversationBrandMark() {
      // Hero brand mark on empty/conversation screens.
      return React.createElement('span', {
        className: 'abacoHeroMark',
        style: { display: 'inline-flex', alignItems: 'center' },
        dangerouslySetInnerHTML: { __html: abacoMarkSvg() },
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
