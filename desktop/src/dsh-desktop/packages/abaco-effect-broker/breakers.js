/**
 * F2-W2 Circuit breakers por plugin (Harness host).
 *
 * Respuesta graduada por plugin: observe → throttle → quarantine → kill → blocklist.
 * Threat 0..3 con histéresis: escalada rápida (la señal manda), desescalada lenta
 * (solo tras ventana limpia sostenida). Breakers POR PLUGIN, nunca globales.
 *
 * Reglas duras (del contrato F2, §W2):
 *  - Kill (nivel 3) exige 2 señales INDEPENDIENTES (sources distintas, severity ≥ 2)
 *    o flag humanApproval. Una sola señal JAMÁS mata sola (ni severity 3 sola).
 *  - Flapping no oscila: cualquier señal severity ≥ 1 reinicia el contador de
 *    ventana limpia, así que alternar bueno/malo nunca desescala.
 *  - Todo "no" con camino medible al "sí": la salida de cuarentena es automática
 *    tras ventanas limpias consecutivas; kill/blocklist solo salen por release
 *    humano explícito (documentado abajo).
 *
 * Módulo puro y determinista: sin reloj, sin aleatoriedad, sin I/O, sin red,
 * cero dependencias. La integración con authorize() es trabajo de W6; este
 * módulo solo computa estado.
 *
 * @module abaco-effect-broker/breakers
 */

/** BreakerLevel: 0=observe · 1=throttle · 2=quarantine · 3=kill · 4=blocklisted */
export const LEVELS = Object.freeze({
  OBSERVE: 0,
  THROTTLE: 1,
  QUARANTINE: 2,
  KILL: 3,
  BLOCKLISTED: 4,
})

/** Severity: 0=ok · 1=watch · 2=suspicious · 3=critical (vocabulario congelado F2). */
const SEV_MAX = 3

/**
 * Ventana limpia: señales severity-0 CONSECUTIVAS necesarias para bajar threat
 * un paso (3→2, 2→1, 1→0). Cualquier señal severity ≥ 1 reinicia el contador.
 * Camino medible de salida de cuarentena (documentado):
 *   6 limpias → quarantine→throttle · 12 limpias → throttle→observe · 18 → threat 0.
 */
export const CLEAN_DECAY_WINDOW = 6

/** Ventana de señales recientes por plugin para la regla de kill (bounded). */
const RING_SIZE = 64

/** Nivel mínimo que impone cada threat (kill/blocklist nunca bajan solos). */
function levelForThreat(threat) {
  if (threat >= 3) return LEVELS.QUARANTINE
  if (threat === 2) return LEVELS.THROTTLE
  return LEVELS.OBSERVE
}

/** @type {Map<string, object>} estado por pluginId — NUNCA global. */
const breakers = new Map()

function freshState() {
  return {
    level: LEVELS.OBSERVE,
    threat: 0,
    signalCount: 0,
    cleanStreak: 0, // severity-0 consecutivas desde la última señal mala
    ring: [], // últimas RING_SIZE señales: { severity, source }
    killSources: null, // Set<string> fijado al matar; null = no matado
  }
}

function get(pluginId) {
  let s = breakers.get(pluginId)
  if (!s) {
    s = freshState()
    breakers.set(pluginId, s)
  }
  return s
}

/** Fuentes distintas con severity ≥ 2 dentro de la ventana reciente. */
function severeSources(ring) {
  const out = new Set()
  for (const e of ring) {
    if (e.severity >= 2) out.add(e.source)
  }
  return out
}

function snapshot(s) {
  return { level: s.level, threat: s.threat, signalCount: s.signalCount }
}

function validate(pluginId, signal) {
  if (typeof pluginId !== 'string' || pluginId.length === 0) {
    throw new TypeError('record: pluginId must be a non-empty string')
  }
  if (!signal || typeof signal !== 'object') {
    throw new TypeError('record: signal must be an object { type, severity, source }')
  }
  if (!Number.isInteger(signal.severity) || signal.severity < 0 || signal.severity > SEV_MAX) {
    throw new TypeError('record: signal.severity must be an integer 0..3')
  }
  if (typeof signal.source !== 'string' || signal.source.length === 0) {
    throw new TypeError('record: signal.source must be a non-empty string')
  }
  if (signal.type !== undefined && typeof signal.type !== 'string') {
    throw new TypeError('record: signal.type must be a string when present')
  }
  if (signal.humanApproval !== undefined && typeof signal.humanApproval !== 'boolean') {
    throw new TypeError('record: signal.humanApproval must be a boolean when present')
  }
}

/**
 * Registra una señal de un plugin y actualiza su breaker.
 * @param {string} pluginId
 * @param {{ type?: string, severity: 0|1|2|3, source: string, humanApproval?: boolean }} signal
 * @returns {{ level: number, threat: number, signalCount: number }} estado resultante
 */
export function record(pluginId, signal) {
  validate(pluginId, signal)
  const s = get(pluginId)
  const { severity, source } = signal
  const human = signal.humanApproval === true

  s.signalCount += 1
  s.ring.push({ severity, source })
  if (s.ring.length > RING_SIZE) s.ring.splice(0, s.ring.length - RING_SIZE)

  // ——— Decisión humana: la única vía que mata con una sola señal, y la única
  // vía de salida de kill/blocklist. severity 0 + humanApproval = RELEASE
  // (limpia kill/blocklist/cuarentena: camino medible al "sí"). severity ≥ 1 +
  // humanApproval = KILL inmediato (type 'human-blocklist' → blocklist directo).
  if (human) {
    if (severity === 0) {
      s.level = LEVELS.OBSERVE
      s.threat = 0
      s.cleanStreak = 0
      s.killSources = null
      return snapshot(s)
    }
    s.threat = Math.max(s.threat, severity)
    if (signal.type === 'human-blocklist') {
      s.level = LEVELS.BLOCKLISTED
      s.killSources = severeSources(s.ring)
    } else {
      s.level = LEVELS.KILL
      s.killSources = new Set([source])
    }
    return snapshot(s)
  }

  // ——— Señal limpia: solo desescala tras ventana sostenida; kill/blocklist
  // nunca salen solos (su salida es el release humano de arriba).
  if (severity === 0) {
    if (s.level < LEVELS.KILL) {
      s.cleanStreak += 1
      while (s.cleanStreak >= CLEAN_DECAY_WINDOW && s.threat > 0) {
        s.cleanStreak -= CLEAN_DECAY_WINDOW
        s.threat -= 1
        // Desescalada de nivel paso a paso (nunca salta 2→0 de golpe):
        // así el flapping no puede oscilar el nivel.
        if (s.level > levelForThreat(s.threat)) s.level -= 1
      }
    }
    return snapshot(s)
  }

  // ——— Señal mala: histéresis — escalada inmediata, el contador limpio se rompe.
  s.cleanStreak = 0
  if (severity > s.threat) s.threat = severity

  if (s.level < LEVELS.KILL) {
    // Escalada de nivel rápida, espejo del threat (observe→throttle→quarantine).
    const floor = levelForThreat(s.threat)
    if (floor > s.level) s.level = floor

    // KILL: exige 2 fuentes INDEPENDIENTES (severity ≥ 2) en la ventana.
    // Una sola fuente, aunque grite severity 3 mil veces, jamás mata sola.
    const sources = severeSources(s.ring)
    if (sources.size >= 2) {
      s.level = LEVELS.KILL
      s.killSources = sources
    }
  } else if (s.level === LEVELS.KILL) {
    // Tras el kill, una TERCERA fuente independiente en critical (severity 3)
    // confirma ataque coordinado → blocklist. Sin esto, el kill es estable.
    if (severity === SEV_MAX && s.killSources && !s.killSources.has(source)) {
      s.level = LEVELS.BLOCKLISTED
    }
  }
  // level 4 (blocklisted): terminal salvo release humano; las señales solo se cuentan.

  return snapshot(s)
}

/**
 * Estado público de un plugin. Plugin desconocido = observe/threat-0
 * (deny-by-default lo decide el broker/W6, no este módulo).
 * @param {string} pluginId
 * @returns {{ level: 0|1|2|3|4, threat: 0|1|2|3, signalCount: number }}
 */
export function state(pluginId) {
  if (typeof pluginId !== 'string' || pluginId.length === 0) {
    throw new TypeError('state: pluginId must be a non-empty string')
  }
  const s = breakers.get(pluginId)
  return s ? snapshot(s) : { level: LEVELS.OBSERVE, threat: 0, signalCount: 0 }
}

/** Limpia todo el estado (solo tests). */
export function resetForTests() {
  breakers.clear()
}
