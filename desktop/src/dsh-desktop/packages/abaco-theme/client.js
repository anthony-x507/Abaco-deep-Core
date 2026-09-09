window.__ModuleLoader__.load({
  id: 'abaco-theme',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const TOKENS = `
      :root {
        /* Surfaces */
        --abaco-bg-0: #0A0E1A;
        --abaco-bg-1: #111729;
        --abaco-bg-2: #1A2238;
        --abaco-bg-3: #232E4A;

        /* Foreground */
        --abaco-fg-0: #F1F5F9;
        --abaco-fg-1: #94A3B8;
        --abaco-fg-2: #64748B;

        /* Border */
        --abaco-border:        #1E293B;
        --abaco-border-strong: #334155;

        /* Brand accents */
        --abaco-accent-1: #38BDF8;
        --abaco-accent-2: #A78BFA;
        --abaco-accent-3: #F472B6;

        /* Semantic */
        --abaco-success: #34D399;
        --abaco-warning: #FBBF24;
        --abaco-danger:  #F87171;
        --abaco-info:    #60A5FA;

        /* Typography */
        --abaco-font-sans: 'SF Pro Display', 'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif;
        --abaco-font-mono: 'SF Mono', 'JetBrains Mono', 'Menlo', 'Consolas', monospace;

        /* Type scale (1.2 ratio) */
        --abaco-fs-xs:  11px;
        --abaco-fs-sm:  12px;
        --abaco-fs-md:  13px;
        --abaco-fs-base: 14px;
        --abaco-fs-lg:  16px;
        --abaco-fs-xl:  20px;
        --abaco-fs-2xl: 24px;
        --abaco-fs-3xl: 32px;

        /* Spacing scale (8px grid, with 4px half-step) */
        --abaco-sp-1:  4px;
        --abaco-sp-2:  8px;
        --abaco-sp-3:  12px;
        --abaco-sp-4:  16px;
        --abaco-sp-6:  24px;
        --abaco-sp-8:  32px;
        --abaco-sp-12: 48px;
        --abaco-sp-16: 64px;

        /* Radii */
        --abaco-radius-sm: 6px;
        --abaco-radius:    8px;
        --abaco-radius-md: 12px;
        --abaco-radius-lg: 16px;

        /* Motion */
        --abaco-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
        --abaco-ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
        --abaco-dur-hover:   150ms;
        --abaco-dur-state:   200ms;
        --abaco-dur-panel:   250ms;

        /* Shadows */
        --abaco-shadow-sm: 0 1px 2px rgba(0,0,0,0.20);
        --abaco-shadow:    0 4px 12px rgba(0,0,0,0.25);
        --abaco-shadow-lg: 0 12px 32px rgba(0,0,0,0.35);
      }

      /* Light theme override (data-theme="light") */
      [data-theme="light"], :root[data-theme="light"] {
        --abaco-bg-0: #FFFFFF;
        --abaco-bg-1: #F8FAFC;
        --abaco-bg-2: #F1F5F9;
        --abaco-bg-3: #E2E8F0;
        --abaco-fg-0: #0F172A;
        --abaco-fg-1: #475569;
        --abaco-fg-2: #94A3B8;
        --abaco-border:        #E2E8F0;
        --abaco-border-strong: #CBD5E1;
      }

      /* Respect prefers-reduced-motion */
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after {
          animation-duration: 0.01ms !important;
          transition-duration: 0.01ms !important;
        }
      }

      /* Subtle scrollbar */
      ::-webkit-scrollbar { width: 10px; height: 10px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb {
        background: var(--abaco-border);
        border-radius: var(--abaco-radius-sm);
      }
      ::-webkit-scrollbar-thumb:hover { background: var(--abaco-border-strong); }
    `

    function apply(ctx) {
      if (document.getElementById('abaco-theme-style')) return
      const s = document.createElement('style')
      s.id = 'abaco-theme-style'
      s.dataset.plugin = 'abaco-theme'
      s.textContent = TOKENS
      document.head.appendChild(s)
    }

    exports.apply = apply
    exports.inject = []
    return module.exports
  },
})