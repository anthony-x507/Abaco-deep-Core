/**
 * Provider registry for abaco-voice.
 *
 * Each provider implements the same interface:
 *
 *   {
 *     id: 'unique-id',
 *     kind: 'tts' | 'stt',
 *     label: 'Display Name',
 *     capabilities: { languages, requiresKey, offline },
 *     configSchema: [{ key, label, type, secret, options? }],
 *     defaultConfig: { ... },
 *     synthesize(text, voice, opts): Promise<AudioSource>,
 *     // stt only:
 *     transcribe(audio, opts): Promise<{ text, language, segments }>
 *   }
 *
 * Providers register themselves at module load. The settings UI reads
 * providersByKind, the mic button uses providersByKind.stt, the speak
 * button uses providersByKind.tts.
 */

const providers = new Map()

export function registerProvider(provider) {
  if (!provider?.id || !provider?.kind) {
    throw new Error('abaco-voice: provider must have id and kind')
  }
  if (providers.has(provider.id)) {
    throw new Error(`abaco-voice: provider "${provider.id}" already registered`)
  }
  providers.set(provider.id, provider)
}

export function getProvider(id) {
  return providers.get(id)
}

export function listProviders(kind) {
  const out = []
  for (const p of providers.values()) {
    if (!kind || p.kind === kind) out.push(p)
  }
  return out
}

export function providersByKind(kind) {
  return listProviders(kind)
}