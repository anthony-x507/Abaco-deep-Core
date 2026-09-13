/**
 * F2-W1 · Cascada asesora G1→G2→G3 (Janice).
 *
 * Rol: SOLO ASESORA. La cascada NUNCA ejecuta efectos y NUNCA decide por el
 * broker: G0 (`authorize()` en index.js) siempre tiene la última palabra.
 * La salida de `evaluate()` es una RECOMENDACIÓN de severidad que el broker
 * puede consultar y recortar, jamás una autorización.
 *
 * Capas:
 *   G1 = triage determinista barato (tabla de reglas, función pura).
 *   G2 = sentinel heurístico determinista (scoring, SIN LLM).
 *   G3 = `janiceAdvise()` — STUB determinista con la interfaz congelada.
 *        El LLM real de Janice se conecta después; el stub solo PROPONE
 *        {severity, action} + rationale. PROHIBIDO ejecutar efectos: el stub
 *        es una función pura sin acceso a ningún sink.
 *
 * REGLA DE ORO (en código, ver `applyAdvisorResult`): las capas asesoras
 * (G2, G3) solo pueden SUBIR la severidad establecida al consultarlas.
 * Todo intento de bajarla se IGNORA y se audita como
 * 'advisor-downgrade-attempt' en el audit interno append-only
 * (`getCascadeAudit()`). W6 deberá reenviar estos registros al audit con
 * hash chain de provenance (W3) — declarado como decisión pendiente.
 *
 * ESM, cero dependencias externas, sin red. `evaluate` y `janiceAdvise` son
 * puras salvo el audit interno (append-only, observable para tests).
 *
 * @module abaco-effect-broker/cascade
 */

// ---------------------------------------------------------------------------
// Vocabulario congelado (F2-CONTRACT)
// ---------------------------------------------------------------------------

/** Severity: 0=ok · 1=watch · 2=suspicious · 3=critical */
export const SEVERITY_LABELS = ['ok', 'watch', 'suspicious', 'critical']

/** Trust ordinal: system(5) > developer(4) > guardian(3) > user(2) > plugin-data(1) > untrusted(0) */
const TRUST_ORDINAL = {
  system: 5,
  developer: 4,
  guardian: 3,
  user: 2,
  'plugin-data': 1,
  untrusted: 0,
}

/** Kinds que por naturaleza son control/egress: el triage los trata con pinzas. */
const CRITICAL_KINDS = new Set([
  'proc.spawn',
  'fs.write',
  'net.fetch',
  'grant.mutate',
  'compose.mutate',
  'tool.register',
  'self.modify',
  'exfiltration',
  'prompt-injection',
])

/** Acciones cerradas que el asesor puede proponer (nunca ejecutar). */
export const ADVISOR_ACTIONS = Object.freeze([
  'none',
  'observe',
  'quarantine',
  'deny-and-escalate-human',
])

/** Evento de auditoría para intentos de bajar severidad (regla de oro). */
export const DOWNGRADE_ATTEMPT_EVENT = 'advisor-downgrade-attempt'

const trustRank = (label) =>
  typeof label === 'string' && TRUST_ORDINAL[label] !== undefined ? TRUST_ORDINAL[label] : 0

const clampSeverity = (n) => {
  const v = Number.isInteger(n) ? n : Math.trunc(Number(n) || 0)
  return v < 0 ? 0 : v > 3 ? 3 : v
}

// ---------------------------------------------------------------------------
// Audit interno append-only (observable por tests; W6 lo reenvía a W3)
// ---------------------------------------------------------------------------

/** @type {Array<object>} */
const cascadeAudit = []
let auditSeq = 0

function pushCascadeAudit(entry) {
  auditSeq += 1
  cascadeAudit.push({ seq: auditSeq, ts: Date.now(), ...entry })
}

/** Copia del audit interno de la cascada (append-only). */
export function getCascadeAudit() {
  return cascadeAudit.map((e) => ({ ...e }))
}

/** Limpieza solo para tests. */
export function resetCascadeForTests() {
  cascadeAudit.length = 0
  auditSeq = 0
}

// ---------------------------------------------------------------------------
// Normalización defensiva del finding (determinista, nunca lanza)
// ---------------------------------------------------------------------------

function normalizeFinding(f) {
  const src = f && typeof f === 'object' ? f : {}
  const prov = src.provenance && typeof src.provenance === 'object' ? src.provenance : {}
  const strOr = (v, dflt) => (typeof v === 'string' && v ? v : dflt)
  const claim = strOr(prov.claim, 'untrusted')
  const channel = strOr(prov.channel, 'untrusted')
  // effective = min(claim, channel) por ordinal (misma regla F1-P2) si no viene dado.
  const effective =
    typeof prov.effective === 'string' && TRUST_ORDINAL[prov.effective] !== undefined
      ? prov.effective
      : trustRank(claim) <= trustRank(channel)
        ? claim
        : channel
  const rawSignals = Array.isArray(src.signals) ? src.signals : []
  const signals = rawSignals
    .filter((s) => s && typeof s === 'object')
    .map((s) => ({
      type: strOr(s.type, 'unknown'),
      severity: clampSeverity(s.severity),
      source: strOr(s.source, 'unknown'),
    }))
  return {
    kind: strOr(src.kind, 'unknown'),
    pluginId: strOr(src.pluginId, 'unknown'),
    provenance: { claim, channel, effective },
    signals,
    context: src.context && typeof src.context === 'object' ? src.context : {},
  }
}

// ---------------------------------------------------------------------------
// G1 — triage determinista barato (función pura)
// ---------------------------------------------------------------------------

/**
 * @returns {{ severity: 0|1|2|3, escalate: boolean, reason: string }}
 */
function g1Triage(f) {
  const maxS = f.signals.reduce((m, s) => Math.max(m, s.severity), 0)
  const gap = Math.max(0, trustRank(f.provenance.claim) - trustRank(f.provenance.effective))
  const critical = CRITICAL_KINDS.has(f.kind)
  const risk = f.context && f.context.risk === true

  // R1 — spoof de procedencia (claim >> effective): escenario rojo del red team.
  if (gap >= 2) {
    return { severity: 3, escalate: true, reason: 'provenance-spoof' }
  }
  // R2 — kind crítico caliente.
  if (critical && maxS >= 2) {
    return { severity: 3, escalate: true, reason: 'critical-kind-hot' }
  }
  // R3 — kind crítico sin señales calientes: sospechoso, pide segunda mirada.
  if (critical) {
    return { severity: 2, escalate: true, reason: 'critical-kind' }
  }
  // R4 — señal crítica.
  if (maxS >= 3) {
    return { severity: 3, escalate: true, reason: 'critical-signal' }
  }
  // R5 — señal sospechosa.
  if (maxS === 2) {
    return { severity: 2, escalate: true, reason: 'suspicious-signal' }
  }
  // R6 — brecha leve de procedencia: watch + escalar.
  if (gap === 1) {
    return { severity: Math.max(maxS, 1), escalate: true, reason: 'provenance-gap' }
  }
  // R7 — contexto marcado con riesgo.
  if (risk) {
    return { severity: Math.max(maxS, 1), escalate: true, reason: 'context-risk' }
  }
  // R8 — caso trivial: G1 decide solo (severidad 0 ó 1, sin banderas).
  return { severity: maxS <= 1 ? maxS : 1, escalate: false, reason: maxS === 0 ? 'trivial-clean' : 'trivial-watch' }
}

// ---------------------------------------------------------------------------
// G2 — sentinel heurístico determinista (scoring, SIN LLM)
// ---------------------------------------------------------------------------

/**
 * Scoring determinista 0..100. Puro: mismo finding → mismo score.
 * @returns {{ score: number, escalate: boolean, notes: string[] }}
 */
function g2Score(f) {
  const maxS = f.signals.reduce((m, s) => Math.max(m, s.severity), 0)
  const gap = Math.max(0, trustRank(f.provenance.claim) - trustRank(f.provenance.effective))
  const sources = new Set(f.signals.map((s) => s.source))
  const severities = f.signals.map((s) => s.severity)
  const spread =
    severities.length > 1 ? Math.max(...severities) - Math.min(...severities) : 0
  const critical = CRITICAL_KINDS.has(f.kind)
  const risk = f.context && f.context.risk === true

  let score = 0
  const parts = []
  const add = (pts, label) => {
    score += pts
    parts.push(`${label}+${pts}`)
  }

  add(maxS * 20, `maxSignal(${maxS})`)
  if (gap > 0) add(Math.min(gap * 10, 20), `provGap(${gap})`)
  if (sources.size >= 2) add(10, 'multiSource')
  if (spread >= 2) add(10, 'conflictingSignals')
  if (critical) add(10, 'criticalKind')
  if (risk) add(15, 'contextRisk')
  if (f.context && f.context.firstSeen === true) add(5, 'firstSeen')
  score = Math.min(100, score)

  // Escala: score alto → Janice (G3). Umbrales iniciales (pendiente de
  // afinado por el líder): >=60 siempre; spoof confirmado (gap>=2) desde 40.
  const escalate = score >= 60 || (gap >= 2 && score >= 40)
  return { score, escalate, notes: [`g2-score=${score} [${parts.join(', ')}]`] }
}

function scoreToSeverity(score) {
  if (score >= 60) return 3
  if (score >= 25) return 2
  return 1
}

// ---------------------------------------------------------------------------
// REGLA DE ORO — las capas asesoras solo pueden SUBIR severidad
// ---------------------------------------------------------------------------

/**
 * Aplica el resultado de una capa asesora sobre el piso vigente.
 * Si el candidato es MENOR que el piso: se ignora y se audita como
 * 'advisor-downgrade-attempt'. Si es mayor: se adopta (subida permitida).
 * @returns {{ severity: number, note: string }}
 */
function applyAdvisorResult({ layer, floor, candidate, pluginId, findingKind }) {
  const cand = clampSeverity(candidate)
  if (cand < floor) {
    pushCascadeAudit({
      kind: DOWNGRADE_ATTEMPT_EVENT,
      layer,
      pluginId,
      findingKind,
      floor,
      attempted: cand,
    })
    return {
      severity: floor,
      note:
        `${layer}: intento de bajar severidad ${floor}→${cand} IGNORADO ` +
        `(regla de oro); auditado como '${DOWNGRADE_ATTEMPT_EVENT}'`,
    }
  }
  if (cand > floor) {
    return { severity: cand, note: `${layer}: severidad elevada ${floor}→${cand}` }
  }
  return { severity: floor, note: `${layer}: confirma severidad ${floor}` }
}

// ---------------------------------------------------------------------------
// G3 — janiceAdvise: STUB determinista (interfaz congelada)
// ---------------------------------------------------------------------------

/**
 * STUB determinista de Janice (G3). SOLO ASESORA: propone {severity, action}
 * + rationale. NO ejecuta efectos — es una función pura sin acceso a ningún
 * sink, broker o runtime. El LLM real se conecta después manteniendo esta
 * interfaz; declarado como decisión pendiente en el reporte F2-W1.
 *
 * @param {object} finding
 * @returns {{ proposal: { severity: 0|1|2|3, action: string }, rationale: string }}
 */
export function janiceAdvise(finding) {
  const f = normalizeFinding(finding)
  const maxS = f.signals.reduce((m, s) => Math.max(m, s.severity), 0)
  const critical = CRITICAL_KINDS.has(f.kind)
  const risk = f.context && f.context.risk === true

  // Heurística del stub: severidad = evidencia directa + kind crítico + riesgo.
  // NOTA: el stub NO replica la lógica de spoof de G1 a propósito — G1 ya
  // fijó el piso 3 en esos casos y la regla de oro impide que el stub lo baje.
  const sev = clampSeverity(maxS + (critical ? 1 : 0) + (risk ? 1 : 0))
  const action =
    sev >= 3 ? 'deny-and-escalate-human' : sev === 2 ? 'quarantine' : sev === 1 ? 'observe' : 'none'

  const factors = [`maxSignal=${maxS}`]
  if (critical) factors.push('critical-kind')
  if (risk) factors.push('context-risk')
  const rationale =
    `janice-stub [${f.pluginId}/${f.kind}]: ${factors.join(' + ')} → ` +
    `severity=${sev} (${SEVERITY_LABELS[sev]}), action=${action}. ` +
    `STUB determinista — el LLM real de Janice se conecta después con esta misma interfaz.`

  return { proposal: { severity: sev, action }, rationale }
}

// ---------------------------------------------------------------------------
// evaluate — cascada completa G1→G2→G3 (asesora; G0 decide)
// ---------------------------------------------------------------------------

/**
 * Evalúa un finding por la cascada asesora.
 *
 * finding = { kind, pluginId, provenance:{claim,channel,effective},
 *             signals:[{type,severity,source}], context }
 *
 * @returns {{ severity: 0|1|2|3, escalations: string[], advisorNotes: string[], decidedBy: 'G1'|'G2'|'G3' }}
 */
export function evaluate(finding) {
  const f = normalizeFinding(finding)
  const escalations = []
  const advisorNotes = []

  const g1 = g1Triage(f)
  let severity = g1.severity
  let decidedBy = 'G1'
  advisorNotes.push(`G1 triage: severity=${g1.severity} (${g1.reason})`)

  if (!g1.escalate) {
    return { severity, escalations, advisorNotes, decidedBy }
  }

  // ---- G2 ----
  escalations.push('G1→G2')
  const g2 = g2Score(f)
  advisorNotes.push(...g2.notes)
  const r2 = applyAdvisorResult({
    layer: 'G2',
    floor: severity,
    candidate: scoreToSeverity(g2.score),
    pluginId: f.pluginId,
    findingKind: f.kind,
  })
  severity = r2.severity
  advisorNotes.push(r2.note)
  decidedBy = 'G2'

  if (!g2.escalate) {
    return { severity, escalations, advisorNotes, decidedBy }
  }

  // ---- G3 (Janice, solo asesora) ----
  escalations.push('G2→G3')
  const adv = janiceAdvise(f)
  advisorNotes.push(`G3 janice: ${adv.rationale}`)
  const r3 = applyAdvisorResult({
    layer: 'G3',
    floor: severity,
    candidate: adv.proposal.severity,
    pluginId: f.pluginId,
    findingKind: f.kind,
  })
  severity = r3.severity
  advisorNotes.push(r3.note)
  if (adv.proposal.action) {
    advisorNotes.push(`G3 proposed-action=${adv.proposal.action} (propuesta, NO ejecutada)`)
  }
  decidedBy = 'G3'

  return { severity, escalations, advisorNotes, decidedBy }
}
