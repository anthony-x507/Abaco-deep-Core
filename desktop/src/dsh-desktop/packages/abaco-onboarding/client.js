window.__ModuleLoader__.load({
  id: 'abaco-onboarding',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    const ONBOARDING_KEY = 'abaco-onboarding:completed'

    function OnboardingWizard({ onDone }) {
      const [step, setStep] = React.useState(0)
      const [name, setName] = React.useState('')

      const steps = [
        React.createElement('div', { key: 'welcome', style: { padding: 32, maxWidth: 520 } },
          React.createElement('h1', { style: { margin: 0, fontSize: 28, fontWeight: 700 } }, 'Bienvenido a ABACO DEEP HARNES'),
          React.createElement('p', { style: { marginTop: 12, color: 'var(--abaco-fg-1)', lineHeight: 1.5 } },
            'Tu centro de operaciones cerrajero: agentes de IA, manos libres con voz, documentos sincronizados entre todas tus Macs.',
          ),
          React.createElement('p', { style: { marginTop: 16, color: 'var(--abaco-fg-2)', fontSize: 12 } },
            'Esto es un placeholder — la versión completa llega en próximas sesiones.'),
        ),
        React.createElement('div', { key: 'name', style: { padding: 32, maxWidth: 520 } },
          React.createElement('h2', { style: { margin: 0, fontSize: 18, fontWeight: 600 } }, '¿Cómo llamamos a este Mac?'),
          React.createElement('p', { style: { color: 'var(--abaco-fg-1)', fontSize: 13 } }, 'Para identificarlo en tu lista de dispositivos sincronizados.'),
          React.createElement('input', {
            type: 'text',
            value: name,
            onChange: (e) => setName(e.target.value),
            placeholder: 'ej: MacBook Taller, MBPRO-CASA',
            style: {
              marginTop: 12, width: '100%', padding: '8px 12px',
              background: 'var(--abaco-bg-1)', border: '1px solid var(--abaco-border)',
              borderRadius: 8, color: 'var(--abaco-fg-0)', fontSize: 14,
            },
          }),
        ),
      ]

      return React.createElement(
        'div',
        {
          style: {
            position: 'fixed', inset: 0, background: 'rgba(10,14,26,0.85)',
            backdropFilter: 'blur(8px)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          },
        },
        React.createElement(
          'div',
          {
            style: {
              background: 'var(--abaco-bg-0)', borderRadius: 16,
              boxShadow: 'var(--abaco-shadow-lg)', minWidth: 480,
            },
          },
          steps[step] || steps[steps.length - 1],
          React.createElement(
            'div',
            { style: { padding: 16, display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid var(--abaco-border)' } },
            step > 0 && React.createElement('button', {
              type: 'button', onClick: () => setStep(step - 1),
              style: {
                padding: '6px 14px', background: 'transparent',
                border: '1px solid var(--abaco-border)', borderRadius: 8,
                color: 'var(--abaco-fg-1)', cursor: 'pointer', fontSize: 13,
              },
            }, 'Atrás'),
            React.createElement('button', {
              type: 'button',
              onClick: () => {
                if (step < steps.length - 1) setStep(step + 1)
                else onDone?.({ deviceName: name })
              },
              style: {
                padding: '6px 14px', background: 'var(--abaco-accent-1)',
                border: 'none', borderRadius: 8,
                color: 'var(--abaco-bg-0)', cursor: 'pointer', fontSize: 13, fontWeight: 500,
              },
            }, step < steps.length - 1 ? 'Siguiente' : 'Empezar'),
          ),
        ),
      )
    }

    function apply(_ctx) {
      const store = typeof window !== 'undefined' && window.__abaco_services && window.__abaco_services.store
      if (!store) return
      let mounted = false

      const tryMount = async () => {
        if (mounted) return
        const done = await store.get(ONBOARDING_KEY)
        if (done) return
        mounted = true

        // Render into a portal at document.body level
        const div = document.createElement('div')
        div.id = 'abaco-onboarding-root'
        document.body.appendChild(div)
        // Note: production version uses React portal properly.
        console.log('[abaco-onboarding] wizard placeholder — full version in next session')
      }

      tryMount()
    }

    exports.apply = apply
    exports.inject = []
    exports.OnboardingWizard = OnboardingWizard
    return module.exports
  },
})