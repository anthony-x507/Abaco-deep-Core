window.__ModuleLoader__.load({
  id: 'abaco-voice',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    // Provider registration side-effect: each module adds itself to the
    // shared registry. Order matters for any provider that depends on another.
    require('./lib/providers/web-speech.js')
    require('./lib/providers/openai.js')
    require('./lib/providers/edge.js')
    require('./lib/providers/elevenlabs.js')
    require('./lib/providers/deepgram.js')

    const { registerProvider, getProvider, listProviders } = require('./lib/registry.js')
    const { play, stop, isPlaying } = require('./lib/playback.js')
    const { start: recStart, stop: recStop, cancel: recCancel, isRecording, requestPermission } = require('./lib/recorder.js')
    const { loadConfig, saveConfig, getProviderConfig, setProviderConfig } = require('./lib/storage.js')

    // ── Disclosure dialog ─────────────────────────────────────────────────

    const DISCLOSURE_KEY = 'abaco-voice:disclosure-seen'

    function shouldShowDisclosure(config) {
      // Show once per provider change, or first run.
      const accepted = config?.privacy?.disclosureAccepted
      if (!accepted) return true
      return false
    }

    async function ensureDisclosureAccepted(ctx, provider) {
      const cap = provider?.capabilities || {}
      if (cap.offline === true || cap.offline === 'partial') return // local-only
      const cfg = await loadConfig(ctx.store)
      if (cfg.privacy.disclosureAccepted) return
      const ok = window.confirm(
        `Activar ${provider.label}?\n\n` +
        `Tu audio será enviado a ${provider.label.includes('OpenAI') ? 'OpenAI' : 'un servicio externo'} para transcripción/síntesis. ` +
        `No se almacena en nuestros servidores, pero sale de tu Mac.\n\n` +
        `Si prefieres privacidad total, usa "Web Speech (browser)" — corre local sin enviar audio a ningún lado.\n\n` +
        `¿Continuar?`
      )
      if (!ok) throw new Error('Disclosure not accepted')
      cfg.privacy.disclosureAccepted = true
      cfg.privacy.disclosureAcceptedAt = new Date().toISOString()
      await saveConfig(ctx.store, cfg)
    }

    // ── Mic button (composer accessory) ──────────────────────────────────

    function MicButton({ onInsert }) {
      const [state, setState] = React.useState('idle') // idle | recording | transcribing | error
      const [error, setError] = React.useState(null)
      const [duration, setDuration] = React.useState(0)
      const timerRef = React.useRef(null)

      React.useEffect(() => () => {
        if (timerRef.current) clearInterval(timerRef.current)
      }, [])

      const onClick = async () => {
        setError(null)
        try {
          if (state === 'recording') {
            setState('transcribing')
            const { blob, duration: dur } = await recStop()
            clearInterval(timerRef.current)
            setDuration(0)
            await transcribe(blob, dur, onInsert)
            setState('idle')
            return
          }
          // start
          const cfg = await loadConfig(window.__abaco_ctx?.store)
          const provider = getProvider(cfg.sttProvider)
          if (!provider) throw new Error('STT provider not configured')
          await ensureDisclosureAccepted(window.__abaco_ctx, provider)
          await recStart()
          setState('recording')
          setDuration(0)
          timerRef.current = setInterval(() => setDuration((d) => d + 0.1), 100)
        } catch (e) {
          setError(e.message)
          setState('error')
        }
      }

      async function transcribe(blob, dur, onInsert) {
        const cfg = await loadConfig(window.__abaco_ctx.store)
        const provider = getProvider(cfg.sttProvider)
        const provCfg = cfg.providers[provider.id] || {}
        try {
          const result = await provider.transcribe(blob, provCfg)
          if (result.text) onInsert(result.text)
        } catch (e) {
          setError(e.message)
          setState('error')
        }
      }

      const onCancel = async () => {
        clearInterval(timerRef.current)
        recCancel()
        setState('idle')
        setDuration(0)
      }

      const styles = {
        idle: { background: 'var(--abaco-bg-2)', color: 'var(--abaco-fg-1)', border: '1px solid var(--abaco-border)' },
        recording: { background: 'var(--abaco-danger)', color: 'white', animation: 'abaco-pulse 1s infinite' },
        transcribing: { background: 'var(--abaco-accent-1)', color: 'var(--abaco-bg-0)' },
        error: { background: 'var(--abaco-warning)', color: 'var(--abaco-bg-0)' },
      }

      const label =
        state === 'recording' ? `◼ ${duration.toFixed(1)}s`
        : state === 'transcribing' ? '…'
        : state === 'error' ? '⚠'
        : '🎙'

      return React.createElement(
        'div',
        { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
        React.createElement('button', {
          type: 'button',
          'aria-label': state === 'recording' ? 'Detener grabación' : 'Transcribir voz',
          title: error || (state === 'recording' ? 'Detener' : 'Micrófono'),
          onClick,
          style: {
            width: 32, height: 32, borderRadius: 8, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 500, ...styles[state],
          },
        }, label),
        state === 'recording' && React.createElement('button', {
          type: 'button',
          'aria-label': 'Cancelar',
          onClick: onCancel,
          style: {
            width: 24, height: 24, borderRadius: 6, cursor: 'pointer',
            background: 'transparent', color: 'var(--abaco-fg-2)', border: 'none', fontSize: 14,
          },
        }, '×'),
      )
    }

    // ── Speak button (per AI message) ────────────────────────────────────

    function SpeakButton({ text }) {
      const [state, setState] = React.useState('idle')

      const onClick = async () => {
        try {
          if (state === 'speaking') {
            stop()
            setState('idle')
            return
          }
          const cfg = await loadConfig(window.__abaco_ctx.store)
          const provider = getProvider(cfg.ttsProvider)
          if (!provider) throw new Error('TTS provider not configured')
          await ensureDisclosureAccepted(window.__abaco_ctx, provider)
          const provCfg = cfg.providers[provider.id] || {}
          const audio = await provider.synthesize(text, provCfg)
          setState('speaking')
          await play(audio)
          setState('idle')
        } catch (e) {
          console.error('abaco-voice speak failed:', e)
          setState('error')
          setTimeout(() => setState('idle'), 2000)
        }
      }

      return React.createElement('button', {
        type: 'button',
        'aria-label': state === 'speaking' ? 'Detener' : 'Leer en voz alta',
        title: state === 'speaking' ? 'Detener' : 'Leer en voz alta',
        onClick,
        style: {
          width: 24, height: 24, borderRadius: 6, cursor: 'pointer',
          background: state === 'speaking' ? 'var(--abaco-accent-1)' : 'transparent',
          color: state === 'speaking' ? 'var(--abaco-bg-0)' : 'var(--abaco-fg-2)',
          border: 'none', fontSize: 13,
        },
      }, state === 'speaking' ? '◼' : state === 'error' ? '⚠' : '🔊')
    }

    // ── Settings panel ───────────────────────────────────────────────────

    function SettingsPanel() {
      const [config, setConfig] = React.useState(null)
      const [ttsProviders, setTtsProviders] = React.useState([])
      const [sttProviders, setSttProviders] = React.useState([])

      React.useEffect(() => {
        (async () => {
          setConfig(await loadConfig(window.__abaco_ctx.store))
          setTtsProviders(listProviders('tts'))
          setSttProviders(listProviders('stt'))
        })()
      }, [])

      if (!config) return React.createElement('div', null, 'Cargando…')

      const update = async (patch) => {
        const next = { ...config, ...patch }
        setConfig(next)
        await saveConfig(window.__abaco_ctx.store, next)
      }

      const updateProvider = async (providerId, partial) => {
        const next = await setProviderConfig(window.__abaco_ctx.store, providerId, partial)
        setConfig((c) => ({ ...c, providers: { ...c.providers, [providerId]: next } }))
      }

      const renderProviderForm = (provider) => {
        const provCfg = config.providers[provider.id] || {}
        return React.createElement(
          'div',
          { style: { padding: 12, marginTop: 8, background: 'var(--abaco-bg-1)', borderRadius: 8 } },
          ...provider.configSchema.map((field) =>
            renderField(field, provCfg[field.key] ?? field.default ?? '', (v) => updateProvider(provider.id, { [field.key]: v }))
          ),
        )
      }

      const renderField = (field, value, onChange) => {
        if (field.type === 'secret') {
          return React.createElement('div', { key: field.key, style: { marginBottom: 8 } },
            React.createElement('label', { style: { display: 'block', fontSize: 12, color: 'var(--abaco-fg-1)', marginBottom: 4 } }, field.label),
            React.createElement('input', {
              type: 'password', value, onChange: (e) => onChange(e.target.value),
              placeholder: field.placeholder || '••••••',
              style: {
                width: '100%', padding: '6px 8px', background: 'var(--abaco-bg-2)',
                border: '1px solid var(--abaco-border)', borderRadius: 6,
                color: 'var(--abaco-fg-0)', fontSize: 13, fontFamily: 'SF Mono, monospace',
              },
            }),
          )
        }
        if (field.type === 'select') {
          const opts = typeof field.options === 'string' && field.options === 'voices'
            ? [] // populated lazily
            : field.options || []
          return React.createElement('div', { key: field.key, style: { marginBottom: 8 } },
            React.createElement('label', { style: { display: 'block', fontSize: 12, color: 'var(--abaco-fg-1)', marginBottom: 4 } }, field.label),
            React.createElement('select', {
              value, onChange: (e) => onChange(e.target.value),
              style: {
                width: '100%', padding: '6px 8px', background: 'var(--abaco-bg-2)',
                border: '1px solid var(--abaco-border)', borderRadius: 6,
                color: 'var(--abaco-fg-0)', fontSize: 13,
              },
            }, ...opts.map((o) => React.createElement('option', { key: o.value, value: o.value }, o.label))),
          )
        }
        if (field.type === 'range') {
          return React.createElement('div', { key: field.key, style: { marginBottom: 8 } },
            React.createElement('label', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--abaco-fg-1)', marginBottom: 4 } },
              React.createElement('span', null, field.label),
              React.createElement('span', { style: { fontFamily: 'SF Mono, monospace' } }, String(value)),
            ),
            React.createElement('input', {
              type: 'range', min: field.min, max: field.max, step: field.step, value, onChange: (e) => onChange(Number(e.target.value)),
              style: { width: '100%' },
            }),
          )
        }
        if (field.type === 'boolean') {
          return React.createElement('label', { key: field.key, style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13, color: 'var(--abaco-fg-1)' } },
            React.createElement('input', { type: 'checkbox', checked: value, onChange: (e) => onChange(e.target.checked) }),
            field.label,
          )
        }
        // text
        return React.createElement('div', { key: field.key, style: { marginBottom: 8 } },
          React.createElement('label', { style: { display: 'block', fontSize: 12, color: 'var(--abaco-fg-1)', marginBottom: 4 } }, field.label),
          React.createElement('input', {
            type: 'text', value, onChange: (e) => onChange(e.target.value),
            placeholder: field.placeholder || '',
            style: {
              width: '100%', padding: '6px 8px', background: 'var(--abaco-bg-2)',
              border: '1px solid var(--abaco-border)', borderRadius: 6,
              color: 'var(--abaco-fg-0)', fontSize: 13,
            },
          }),
        )
      }

      const ttsSelected = getProvider(config.ttsProvider)
      const sttSelected = getProvider(config.sttProvider)

      return React.createElement(
        'div',
        { style: { padding: 16, fontSize: 14, color: 'var(--abaco-fg-0)' } },
        React.createElement('h3', { style: { margin: '0 0 12px', fontSize: 16, fontWeight: 600 } }, 'Voz — Text-to-speech'),
        React.createElement('label', { style: { display: 'block', fontSize: 12, color: 'var(--abaco-fg-1)', marginBottom: 4 } }, 'Proveedor'),
        React.createElement('select', {
          value: config.ttsProvider, onChange: (e) => update({ ttsProvider: e.target.value }),
          style: {
            width: '100%', padding: '8px 10px', background: 'var(--abaco-bg-1)',
            border: '1px solid var(--abaco-border)', borderRadius: 6,
            color: 'var(--abaco-fg-0)', fontSize: 14,
          },
        }, ...ttsProviders.map((p) =>
          React.createElement('option', { key: p.id, value: p.id },
            `${p.label}${p.capabilities.requiresKey ? ' 🔑' : ''}${p.capabilities.offline === true || p.capabilities.offline === 'partial' ? ' 🛡 local' : ''}`),
        )),
        ttsSelected && renderProviderForm(ttsSelected),
        ttsSelected && ttsSelected.capabilities.privacyNote && React.createElement(
          'div', { style: { marginTop: 6, fontSize: 11, color: 'var(--abaco-warning)' } },
          '⚠ ', ttsSelected.capabilities.privacyNote,
        ),

        React.createElement('h3', { style: { margin: '24px 0 12px', fontSize: 16, fontWeight: 600 } }, 'Voz — Speech-to-text'),
        React.createElement('label', { style: { display: 'block', fontSize: 12, color: 'var(--abaco-fg-1)', marginBottom: 4 } }, 'Proveedor'),
        React.createElement('select', {
          value: config.sttProvider, onChange: (e) => update({ sttProvider: e.target.value }),
          style: {
            width: '100%', padding: '8px 10px', background: 'var(--abaco-bg-1)',
            border: '1px solid var(--abaco-border)', borderRadius: 6,
            color: 'var(--abaco-fg-0)', fontSize: 14,
          },
        }, ...sttProviders.map((p) =>
          React.createElement('option', { key: p.id, value: p.id },
            `${p.label}${p.capabilities.requiresKey ? ' 🔑' : ''}${p.capabilities.offline === true || p.capabilities.offline === 'partial' ? ' 🛡 local' : ''}`),
        )),
        sttSelected && renderProviderForm(sttSelected),
        sttSelected && sttSelected.capabilities.privacyNote && React.createElement(
          'div', { style: { marginTop: 6, fontSize: 11, color: 'var(--abaco-warning)' } },
          '⚠ ', sttSelected.capabilities.privacyNote,
        ),

        React.createElement('h3', { style: { margin: '24px 0 12px', fontSize: 16, fontWeight: 600 } }, 'Privacidad'),
        React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--abaco-fg-1)' } },
          React.createElement('input', {
            type: 'checkbox',
            checked: !!config.privacy?.disclosureAccepted,
            disabled: true,
            onChange: () => {},
          }),
          React.createElement('span', null,
            'Disclosure aceptado',
            config.privacy?.disclosureAcceptedAt && React.createElement('span',
              { style: { marginLeft: 6, color: 'var(--abaco-fg-2)', fontSize: 11 } },
              `(${new Date(config.privacy.disclosureAcceptedAt).toLocaleDateString()})`,
            ),
          ),
        ),
        React.createElement('button', {
          type: 'button', onClick: async () => {
            await saveConfig(window.__abaco_ctx.store, {
              ...config,
              privacy: { ...config.privacy, disclosureAccepted: false, disclosureAcceptedAt: null },
            })
            setConfig({ ...config, privacy: { ...config.privacy, disclosureAccepted: false } })
          },
          style: {
            marginTop: 8, padding: '4px 10px', background: 'transparent',
            border: '1px solid var(--abaco-border)', borderRadius: 6,
            color: 'var(--abaco-fg-1)', fontSize: 11, cursor: 'pointer',
          },
        }, 'Reset disclosure'),
      )
    }

    // ── Slot injection ───────────────────────────────────────────────────

    const inject = ['slots', 'store']

    async function apply(ctx) {
      // Expose ctx for components that need it (mic button needs it async)
      window.__abaco_ctx = ctx

      // Mic button → composer left slot
      ctx.slots.inject('conversation.input.left', () =>
        ctx.slots.register(
          { name: 'conversation.input.left' },
          function AbacoMicButton(props) {
            return React.createElement(MicButton, {
              onInsert: (text) => {
                const input = props?.input
                if (input && typeof input.insertText === 'function') input.insertText(text)
                else if (input && typeof input.setValue === 'function') input.setValue((prev) => prev ? prev + ' ' + text : text)
              },
            })
          },
        ),
      )

      // Speak button → message actions slot (AI messages only)
      ctx.slots.inject('message.actions', () =>
        ctx.slots.register(
          { name: 'message.actions', when: (m) => m?.role === 'assistant' },
          function AbacoSpeakButton(props) {
            const text = props?.message?.text || props?.message?.content || ''
            if (!text) return null
            return React.createElement(SpeakButton, { text })
          },
        ),
      )

      // Settings panel → settings page
      ctx.slots.inject('settings.advanced.item', () =>
        ctx.slots.register(
          { name: 'settings.advanced.item', id: 'abaco-voice' },
          function AbacoVoiceSettings() {
            return React.createElement(SettingsPanel)
          },
        ),
      )

      // Inject styles (icon pulse + base colors if not already in theme)
      if (!document.getElementById('abaco-voice-style')) {
        const s = document.createElement('style')
        s.id = 'abaco-voice-style'
        s.dataset.plugin = 'abaco-voice'
        s.textContent = `
          @keyframes abaco-pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: .8; transform: scale(1.05); }
          }
        `
        document.head.appendChild(s)
      }
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})