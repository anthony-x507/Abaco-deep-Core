/**
 * The ABACO browser's skill writer (F3): a finished F2 recording becomes a
 * `SKILL.md` the Harness discovers on its own.
 *
 * ## Where this sits
 *
 * F2 left a JSON file on disk (`<userData>/abaco-browser/recordings/<stamp>.json`)
 * holding what a human did in the overlay. That file is evidence, not a
 * procedure: one row per keystroke burst, a `will-navigate` beside every
 * `did-navigate`, a scroll row per reading pause. F3 is the compiler that turns
 * it into the two things an agent needs — *a name it can find* and *steps it can
 * follow*:
 *
 * ```
 *  <recordingsDir>/<stamp>.json
 *          │  read + validate          (never throws: a failure is a value)
 *          ▼
 *   collapse: merge / drop / number      → AbacoBrowserSkillStep[]
 *          │
 *          ▼
 *   render: frontmatter + Pasos + Verification + Notes
 *          │
 *          ▼
 *  <DSH_HOME>/skills/<slug>/SKILL.md  ──►  @deepseek-ai/dsh-skill-filesystem
 * ```
 *
 * ## Why `$DSH_HOME/skills` and not a directory of our own
 *
 * The Harness already has a skill catalog, and `dsh-skill-filesystem` already
 * looks for `<dshHome>/skills/<dir>/SKILL.md`; `dshHome` is the same
 * `DSH_HOME` the shell injects into the Harness child
 * (`src/main/runtime/harness-runtime.ts:271`). Writing anywhere else would mean
 * a second discovery mechanism and a second catalog, so F3 writes where the
 * provider already reads — and the frontmatter is exactly what its parser
 * requires: `name` (matching `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, i.e. a slug) and
 * `description` (both mandatory, `dsh-skill-filesystem/lib/index.js:679-688`),
 * with `whenToUse` and `metadata` as the optional extras it also carries.
 *
 * ## The two halves of the output, and why they read differently
 *
 * The **frontmatter and body are Spanish**: the recording is a demonstration by
 * this app's user, the skill is theirs, and the upstream sketch this phase ports
 * (`desktop/features/browser/skill-generator.ts`) generated Spanish prose too.
 * The **error strings are English**, because they are the one part of this
 * module that reaches a UI — the chrome strip, whose every other line is
 * English. Localizing the generated markdown means editing the tables in
 * {@link renderBrowserSkillMarkdown} and nothing else.
 *
 * ## No `electron` import
 *
 * Like `abaco-browser-recorder.ts`, this module reaches the disk through
 * injected seams (`readTextFile`, `listRecordingFiles`, `pathExists`, …), so
 * `test/abaco-browser-skill.test.ts` can drive a whole save against a temp
 * directory with no Electron runtime in the picture.
 *
 * @module abaco-browser-skill-writer
 */

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ABACO_BROWSER_RECORDING_SCHEMA,
  ABACO_BROWSER_REDACTED_VALUE,
  ABACO_BROWSER_SKILL_FILENAME,
  ABACO_BROWSER_SKILL_MAX_INLINE,
  ABACO_BROWSER_SKILL_MAX_NAME,
  ABACO_BROWSER_SKILL_MAX_STEPS,
  ABACO_BROWSER_SKILL_MAX_SUFFIX,
  ABACO_BROWSER_SKILL_SCROLL_MIN_DELTA,
  ABACO_BROWSER_SKILLS_DIRNAME,
  isAbacoBrowserRecordedActionType,
  isFragileBrowserSelector,
  type AbacoBrowserRecordedAction,
  type AbacoBrowserRecordedActionType,
  type AbacoBrowserRecordingDocument,
  type AbacoBrowserSaveSkillResult
} from '../shared/abaco-browser'

/* ────────────────────────────────────────────────────────────────────────────
 * Vocabulary
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * One numbered step of the generated skill.
 *
 * Deliberately not an {@link AbacoBrowserRecordedAction}: the collapse pass has
 * already decided what is a step, so a step carries the *decision* (how many
 * times a control was pressed, that a value was withheld) rather than the raw
 * event fields.
 */
export interface AbacoBrowserSkillStep {
  action_type: AbacoBrowserRecordedActionType
  url: string
  selector?: string
  /** The final value for `type`; never the masked one (see `redacted`). */
  text?: string
  /** How many consecutive presses of the same control this step stands for. */
  repeat: number
  /** True when the recorded value is {@link ABACO_BROWSER_REDACTED_VALUE}. */
  redacted?: boolean
  notes?: string
}

/** What the collapse pass threw away, reported in the skill's Notes. */
export interface AbacoBrowserSkillDropTally {
  /** `screenshot` rows: provenance for the writer, never a step. */
  screenshots: number
  /** Scroll rows that were momentum rather than a new position. */
  scrolls: number
  /** Consecutive presses folded into the step before them. */
  repeats: number
  /** Rows that restated the step before them (a focus click, a retype). */
  redundant: number
  /** Rows the recording itself dropped (malformed or unknown). */
  malformed: number
  /** Steps beyond {@link ABACO_BROWSER_SKILL_MAX_STEPS}. */
  overflow: number
}

/** The rendered skill, before anything is written. */
export interface AbacoBrowserSkillDraft {
  slug: string
  title: string
  description: string
  whenToUse: string
  steps: AbacoBrowserSkillStep[]
  /** Selectors the Notes section warns about. */
  fragileSelectors: string[]
  /** Selectors whose recorded value was masked. */
  redactedSelectors: string[]
  dropped: AbacoBrowserSkillDropTally
  document: AbacoBrowserRecordingDocument
}

/* ────────────────────────────────────────────────────────────────────────────
 * Reading the recording
 * ──────────────────────────────────────────────────────────────────────────── */

/** What {@link parseBrowserRecordingDocument} answers. Never throws. */
export type AbacoBrowserRecordingParse =
  | { ok: true; document: AbacoBrowserRecordingDocument; malformedActions: number }
  | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Coerce one recorded action, or `undefined` when it cannot be one. */
function readAction(value: unknown): AbacoBrowserRecordedAction | undefined {
  if (!isRecord(value)) return undefined
  if (!isAbacoBrowserRecordedActionType(value.action_type)) return undefined
  const action: AbacoBrowserRecordedAction = {
    timestamp: stringField(value.timestamp),
    url: stringField(value.url),
    action_type: value.action_type
  }
  const selector = stringField(value.selector)
  const text = stringField(value.text)
  const notes = stringField(value.notes)
  const screenshot = stringField(value.screenshot_path)
  if (selector.length > 0) action.selector = selector
  if (text.length > 0) action.text = text
  if (notes.length > 0) action.notes = notes
  if (screenshot.length > 0) action.screenshot_path = screenshot
  if (value.redacted === true) action.redacted = true
  return action
}

/**
 * Parse the JSON F2 wrote.
 *
 * Total, and every refusal names the file: this reads a document that the user
 * can open in an editor, that an older build may have written with a different
 * envelope, or that a failed write may have truncated. "That recording is not
 * readable, and here is why" is a sentence the strip can show; a stack trace is
 * not.
 */
export function parseBrowserRecordingDocument(
  raw: string,
  options: { path?: string } = {}
): AbacoBrowserRecordingParse {
  const where = options.path !== undefined ? ` in ${options.path}` : ''
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return {
      ok: false,
      error: `The recording${where} is not valid JSON (${describe(error)}).`
    }
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: `The recording${where} is not a recording object.` }
  }
  const schema = stringField(parsed.schema)
  if (schema !== ABACO_BROWSER_RECORDING_SCHEMA) {
    return {
      ok: false,
      error:
        schema.length === 0
          ? `The file${where} has no "schema" field, so it is not an ABACO browser recording.`
          : `The recording${where} uses schema "${schema}", which this build cannot read (expected "${ABACO_BROWSER_RECORDING_SCHEMA}").`
    }
  }
  if (!Array.isArray(parsed.actions)) {
    return { ok: false, error: `The recording${where} has no "actions" array.` }
  }
  const actions: AbacoBrowserRecordedAction[] = []
  let malformedActions = 0
  for (const entry of parsed.actions) {
    const action = readAction(entry)
    if (action) actions.push(action)
    else malformedActions += 1
  }
  if (actions.length === 0) {
    return {
      ok: false,
      error: `The recording${where} holds no usable actions, so there is nothing to turn into a skill.`
    }
  }
  const screenshots = isRecord(parsed.screenshots) ? parsed.screenshots : {}
  const skipped = isRecord(parsed.skipped) ? parsed.skipped : {}
  return {
    ok: true,
    malformedActions,
    document: {
      schema: ABACO_BROWSER_RECORDING_SCHEMA,
      session_id: stringField(parsed.session_id),
      started_at: stringField(parsed.started_at),
      ended_at: stringField(parsed.ended_at),
      initial_url: stringField(parsed.initial_url),
      final_url: stringField(parsed.final_url),
      title: stringField(parsed.title),
      mode: 'manual',
      actions,
      screenshots: {
        ...(stringField(screenshots.initial).length > 0
          ? { initial: stringField(screenshots.initial) }
          : {}),
        ...(stringField(screenshots.final).length > 0
          ? { final: stringField(screenshots.final) }
          : {})
      },
      skipped: {
        malformedMessages: numericField(skipped.malformedMessages),
        redactedValues: numericField(skipped.redactedValues),
        duplicateActions: numericField(skipped.duplicateActions)
      }
    }
  }
}

function numericField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/** The scroll offset the page recorded in a scroll action's notes (`y=800`). */
export function scrollOffsetFromAction(action: AbacoBrowserRecordedAction): number | undefined {
  const match = /(?:^|\s)y=(-?\d+)/u.exec(action.notes ?? '')
  if (!match) return undefined
  const parsed = Number.parseInt(match[1] ?? '', 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

/* ────────────────────────────────────────────────────────────────────────────
 * The collapse pass
 * ──────────────────────────────────────────────────────────────────────────── */

/** True when the action was a form's own `submit` event rather than a click. */
function isFormSubmit(action: AbacoBrowserRecordedAction): boolean {
  return /form submit/iu.test(action.notes ?? '')
}

function selectorOf(step: AbacoBrowserSkillStep | undefined): string {
  return step?.selector ?? ''
}

/**
 * Turn the recorded rows into numbered steps.
 *
 * Pure and synchronous, so the policy is unit-testable without a file, a page or
 * a clock — the same seam `mergeRecordedAction` gives F2. Four rules, each one
 * answering a specific way the raw log is not a procedure:
 *
 *  1. **`screenshot` and unknown rows are not steps.** A bookend PNG is
 *     provenance (it is cited in *Verification*), and an action the vocabulary
 *     does not know is not something an agent can be told to repeat.
 *  2. **Consecutive presses of one control are one step.** A double click, or a
 *     click that a page's own re-render logged twice, becomes
 *     `Haz click en … (pulsado 2 veces)` instead of two identical lines.
 *  3. **A click that merely restated the focused field is noise.** The recorder
 *     logs the click that focuses an input and the `input` that follows it; only
 *     the second one moves the task forward.
 *  4. **A scroll is kept only when it reveals something new.** The page script
 *     already throttles scrolls inside 400px, so what survives here is the
 *     second reading pause of a long page: dropped unless it moved at least
 *     {@link ABACO_BROWSER_SKILL_SCROLL_MIN_DELTA} from the last *kept* position
 *     on that URL.
 */
export function collapseRecordedActions(
  actions: readonly AbacoBrowserRecordedAction[],
  options: { malformed?: number } = {}
): { steps: AbacoBrowserSkillStep[]; dropped: AbacoBrowserSkillDropTally } {
  const steps: AbacoBrowserSkillStep[] = []
  const lastKeptScrollByUrl = new Map<string, number>()
  const dropped: AbacoBrowserSkillDropTally = {
    screenshots: 0,
    scrolls: 0,
    repeats: 0,
    redundant: 0,
    malformed: options.malformed ?? 0,
    overflow: 0
  }

  for (const action of actions) {
    if (action.action_type === 'screenshot') {
      dropped.screenshots += 1
      continue
    }

    if (action.action_type === 'scroll') {
      const offset = scrollOffsetFromAction(action)
      const previous = lastKeptScrollByUrl.get(action.url)
      // No offset at all is a scroll we cannot describe; take it as a new one
      // only on a page we have not seen a scroll on.
      if (offset !== undefined && previous !== undefined) {
        if (Math.abs(offset - previous) < ABACO_BROWSER_SKILL_SCROLL_MIN_DELTA) {
          dropped.scrolls += 1
          continue
        }
      } else if (previous !== undefined) {
        dropped.scrolls += 1
        continue
      }
      if (offset !== undefined) lastKeptScrollByUrl.set(action.url, offset)
      steps.push({ action_type: 'scroll', url: action.url, repeat: 1, notes: action.notes })
      continue
    }

    const previousStep = steps[steps.length - 1]
    const samePlace =
      previousStep !== undefined &&
      previousStep.url === action.url &&
      selectorOf(previousStep).length > 0 &&
      selectorOf(previousStep) === (action.selector ?? '')

    if (action.action_type === 'click' && samePlace) {
      // Rule 3 first: a click on the field the previous step just typed into is
      // the focus, not a new intention.
      if (previousStep?.action_type === 'type') {
        dropped.redundant += 1
        continue
      }
      // Rule 2: the same control pressed again in the same breath.
      if (previousStep?.action_type === 'click') {
        previousStep.repeat += 1
        dropped.repeats += 1
        continue
      }
    }

    if (action.action_type === 'type' && samePlace && previousStep?.action_type === 'type') {
      // The recorder already merges a typed word; a second burst on the same
      // field (a correction) leaves the latest value as the one that matters.
      previousStep.text = action.text ?? previousStep.text
      previousStep.redacted = action.redacted === true
      previousStep.repeat += 1
      dropped.repeats += 1
      continue
    }

    if (action.action_type === 'navigate' && previousStep?.action_type === 'navigate') {
      if (previousStep.url === action.url) {
        // A `will-navigate`/`did-navigate` pair the recorder did not collapse
        // (they are merged only inside its 5s window). The arrival row carries
        // the title, so it wins.
        if ((action.notes ?? '').length > 0) previousStep.notes = action.notes
        dropped.redundant += 1
        continue
      }
    }

    steps.push({
      action_type: action.action_type,
      url: action.url,
      ...(action.selector !== undefined ? { selector: action.selector } : {}),
      ...(action.text !== undefined ? { text: action.text } : {}),
      repeat: 1,
      ...(action.redacted === true ? { redacted: true } : {}),
      ...(action.notes !== undefined ? { notes: action.notes } : {})
    })
  }

  if (steps.length > ABACO_BROWSER_SKILL_MAX_STEPS) {
    dropped.overflow = steps.length - ABACO_BROWSER_SKILL_MAX_STEPS
    steps.length = ABACO_BROWSER_SKILL_MAX_STEPS
  }
  return { steps, dropped }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Naming and prose
 * ──────────────────────────────────────────────────────────────────────────── */

/** Fallback slug when neither the user nor the page offered a usable name. */
export const ABACO_BROWSER_SKILL_FALLBACK_SLUG = 'recorded-browser-task'

/**
 * Reduce free text to the one shape the skill provider accepts
 * (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`). Returns `''` when nothing survives, so the
 * caller decides the fallback rather than getting a slug like `-`.
 *
 * Accents are folded rather than dropped: the pages this records have Spanish
 * titles, and `Contraseña` must become `contrasena`, not `contrase-a`.
 */
export function slugifyBrowserSkillName(raw: string, max = 48): string {
  const folded = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  const trimmed = folded.slice(0, Math.max(1, max)).replace(/-+$/gu, '')
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(trimmed) ? trimmed : ''
}

/** The host of a URL, or `''` when it is not one (a `file:` page, an empty row). */
export function hostOfBrowserUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/** Collapse whitespace, drop control characters and clamp one inline value. */
function inline(value: string, max = ABACO_BROWSER_SKILL_MAX_INLINE): string {
  const flattened = value
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  return flattened.length > max ? `${flattened.slice(0, max)}…` : flattened
}

/**
 * One value as inline code.
 *
 * Recorded text is hostile input: selectors and visible labels come from the
 * page, and the user's own typed value comes from a field. A backtick or a
 * newline in there would end the code span and could forge a section heading in
 * the generated document, so the value is flattened, escaped, and the runs of
 * backticks are neutralized by using a longer delimiter.
 */
export function inlineCode(value: string, max = ABACO_BROWSER_SKILL_MAX_INLINE): string {
  const flat = inline(value, max)
  const longestRun = (flat.match(/`+/gu) ?? []).reduce((longest, run) => Math.max(longest, run.length), 0)
  const fence = '`'.repeat(longestRun + 1)
  // CommonMark strips one leading and trailing space from a code span *only*
  // when the content starts and ends with a backtick, so the padding is added
  // exactly then.
  const pad = flat.startsWith('`') || flat.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${flat}${pad}${fence}`
}

/** Extract `title="…"` from a recorded navigation's notes. */
export function recordedTitle(notes: string | undefined): string {
  const match = /title="([^"]*)"/u.exec(notes ?? '')
  return match?.[1] !== undefined ? inline(match[1], 120) : ''
}

/** A one-line description of a step, used by Notes and by *Verification*. */
export function describeSkillStep(step: AbacoBrowserSkillStep): string {
  switch (step.action_type) {
    case 'navigate':
      return `navegar a ${inline(step.url, 120)}`
    case 'click':
      return `hacer click en ${inline(step.selector ?? 'un control sin selector', 120)}`
    case 'type':
      return `escribir en ${inline(step.selector ?? 'un campo sin selector', 120)}`
    case 'scroll':
      return `desplazarse a ${step.notes ?? 'otra posición'}`
    case 'wait':
      return `esperar a ${inline(step.selector ?? 'un selector', 120)}`
    default:
      return step.action_type
  }
}

/**
 * The numbered steps, as markdown.
 *
 * Every step names the exact tool the agent must call: a skill that says "click
 * the sign-in button" without `abaco_browser_click` leaves the model to guess
 * between the browser tools and its own memory of the page.
 *
 * The four sections are `## Pasos` (the procedure, Spanish like the prose), and
 * `## Verification` / `## Notes` — kept in English because those are the names
 * this phase specifies for them and the words a reader scans for, the same words
 * the Harness's own bundled skills use for their guidance sections.
 */
export function renderRecordedSteps(steps: readonly AbacoBrowserSkillStep[]): string {
  const lines: string[] = []
  steps.forEach((step, index) => {
    lines.push(`${index + 1}. ${renderSkillStep(step)}`)
  })
  return lines.join('\n')
}

/** One step as a numbered-list item. */
export function renderSkillStep(step: AbacoBrowserSkillStep): string {
  const repeats =
    step.repeat > 1 ? ` Se pulsó ${step.repeat} veces seguidas en la grabación.` : ''
  switch (step.action_type) {
    case 'navigate': {
      const title = recordedTitle(step.notes)
      return `Navega a ${inlineCode(step.url)} con \`abaco_browser_navigate\`.${
        title.length > 0 ? ` La página se titulaba «${title}».` : ''
      }`
    }
    case 'click': {
      if (isFormSubmitText(step.notes)) {
        const control =
          step.selector !== undefined && step.selector.length > 0
            ? ` (el control registrado era ${inlineCode(step.selector)})`
            : ''
        return `Envía el formulario con \`abaco_browser_type\` (\`submit: true\`) sobre su último campo, o con \`abaco_browser_click\` en su botón de envío${control}.${repeats}`
      }
      const label =
        step.text !== undefined && step.text.length > 0
          ? ` El control mostraba ${inlineCode(step.text, 120)}.`
          : ''
      return `Haz click en ${inlineCode(step.selector ?? 'el elemento descrito en las notas')} con \`abaco_browser_click\`.${label}${repeats}`
    }
    case 'type': {
      if (step.redacted === true) {
        return `Escribe el valor real de ${inlineCode(step.selector ?? 'este campo')} con \`abaco_browser_type\` — la grabación lo ocultó por ser un campo sensible, así que pídeselo al usuario antes de ejecutar el paso.${repeats}`
      }
      const value =
        step.text !== undefined && step.text.length > 0
          ? inlineCode(step.text)
          : "''"
      return `Escribe ${value} en ${inlineCode(step.selector ?? 'el campo descrito en las notas')} con \`abaco_browser_type\`.${repeats}`
    }
    case 'wait':
      return `Espera a que aparezca ${inlineCode(step.selector ?? 'el selector descrito en las notas')} con \`abaco_browser_wait_for\`.${repeats}`
    case 'scroll': {
      const offset = scrollOffsetFromAction({
        timestamp: '',
        url: step.url,
        action_type: 'scroll',
        ...(step.notes !== undefined ? { notes: step.notes } : {})
      })
      const at = offset !== undefined ? ` hasta \`y≈${offset}\`` : ''
      return `Desplázate${at} (la grabación registró la posición, no el gesto) y confirma con \`abaco_browser_read_dom\` que el contenido nuevo está ahí.${repeats}`
    }
    default:
      return `${step.action_type} en ${inlineCode(step.url)}.`
  }
}

function isFormSubmitText(notes: string | undefined): boolean {
  return /form submit/iu.test(notes ?? '')
}

/**
 * Summary line for the frontmatter `description` and the strip's success note.
 * Written for the *catalog*: it has to say what the skill does, where it does
 * it, and when to reach for it, in one screen line.
 */
export function describeBrowserSkill(
  document: AbacoBrowserRecordingDocument,
  stepCount: number
): string {
  const host = hostOfBrowserUrl(document.final_url) || hostOfBrowserUrl(document.initial_url)
  const place = host.length > 0 ? host : 'el navegador integrado'
  const counts = countActionTypes(document.actions)
  const parts: string[] = []
  if (counts.navigate > 0) parts.push(`${counts.navigate} navegación(es)`)
  if (counts.click > 0) parts.push(`${counts.click} click(s)`)
  if (counts.type > 0) parts.push(`${counts.type} campo(s) escrito(s)`)
  const shape = parts.length > 0 ? parts.join(', ') : `${stepCount} paso(s)`
  const redacted = document.actions.filter((action) => action.redacted === true).length
  const secret =
    redacted > 0
      ? ` Hay ${redacted} valor(es) sensibles que el usuario debe aportar.`
      : ''
  const destination =
    document.final_url.length > 0 ? ` Termina en ${document.final_url}.` : ''
  return `Reproduce en el navegador integrado la tarea que el usuario demostró en ${place} (${shape}, ${stepCount} pasos).${destination} Úsalo cuando pida repetir o automatizar ese mismo flujo en ${place}.${secret}`
}

function countActionTypes(
  actions: readonly AbacoBrowserRecordedAction[]
): Record<AbacoBrowserRecordedActionType | 'other', number> {
  const counts = { click: 0, type: 0, navigate: 0, scroll: 0, screenshot: 0, wait: 0, other: 0 }
  for (const action of actions) {
    if (isAbacoBrowserRecordedActionType(action.action_type)) counts[action.action_type] += 1
    else counts.other += 1
  }
  return counts
}

/* ────────────────────────────────────────────────────────────────────────────
 * The document
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The human title of the skill: the recorded page's own title (which is what
 * the user recognises in the list of skills), falling back to the host.
 */
export function browserSkillTitle(document: AbacoBrowserRecordingDocument): string {
  const title = inline(document.title, 90)
  if (title.length > 0) return title
  const host = hostOfBrowserUrl(document.final_url) || hostOfBrowserUrl(document.initial_url)
  return host.length > 0 ? `Tarea grabada en ${host}` : 'Tarea grabada en el navegador'
}

/**
 * The slug: the user's typed name when there is one (they are the authority on
 * what this skill is), otherwise the page title, otherwise the host, otherwise
 * {@link ABACO_BROWSER_SKILL_FALLBACK_SLUG}.
 */
export function browserSkillSlug(
  document: AbacoBrowserRecordingDocument,
  requestedName?: string
): string {
  const requested = slugifyBrowserSkillName((requestedName ?? '').slice(0, ABACO_BROWSER_SKILL_MAX_NAME))
  if (requested.length > 0) return requested
  const fromTitle = slugifyBrowserSkillName(document.title)
  if (fromTitle.length > 0) return fromTitle
  const host = slugifyBrowserSkillName(hostOfBrowserUrl(document.final_url) || hostOfBrowserUrl(document.initial_url))
  return host.length > 0 ? host : ABACO_BROWSER_SKILL_FALLBACK_SLUG
}

/** Everything the renderer needs, derived from a parsed document. */
export function draftBrowserSkill(
  document: AbacoBrowserRecordingDocument,
  options: { requestedName?: string; malformedActions?: number } = {}
): AbacoBrowserSkillDraft {
  const { steps, dropped } = collapseRecordedActions(document.actions, {
    malformed: options.malformedActions ?? 0
  })
  const selectors = new Set<string>()
  const redacted = new Set<string>()
  for (const step of steps) {
    if (step.selector === undefined) continue
    if (isFragileBrowserSelector(step.selector)) selectors.add(step.selector)
    if (step.redacted === true) redacted.add(step.selector)
  }
  const slug = browserSkillSlug(document, options.requestedName)
  const title = browserSkillTitle(document)
  const host = hostOfBrowserUrl(document.final_url) || hostOfBrowserUrl(document.initial_url)
  const recordedPage = inline(document.title, 60) || title
  return {
    slug,
    title,
    description: describeBrowserSkill(document, steps.length),
    whenToUse:
      host.length > 0
        ? `Úsalo cuando el usuario pida repetir o automatizar en ${host} el flujo que grabó («${recordedPage}»), o cuando pida «hazlo otra vez como la última vez» sobre ese sitio.`
        : `Úsalo cuando el usuario pida repetir el flujo que grabó en el navegador integrado.`,
    steps,
    fragileSelectors: [...selectors],
    redactedSelectors: [...redacted],
    dropped,
    document
  }
}

/** YAML double-quoted scalar: JSON's escaping is a subset of YAML's. */
function yamlString(value: string): string {
  return JSON.stringify(value)
}

/**
 * The whole `SKILL.md`.
 *
 * Shape (and the reason for each part):
 *
 *  - **frontmatter** — `name`/`description` are what the provider requires;
 *    `whenToUse` is what the model reads when deciding whether to load the
 *    skill; `metadata` carries the provenance (which recording, which session,
 *    when, how much was dropped) so a stale skill can be traced back to the
 *    demonstration it came from.
 *  - **`## Pasos`** — one numbered line per step, each naming the exact
 *    `abaco_browser_*` tool.
 *  - **`## Verification`** — how an agent knows it finished: the recorded final
 *    URL, the last action, and (when F2 managed to take one) the closing
 *    screenshot, which `read_image` can compare against a fresh one.
 *  - **`## Notes`** — the honest part: fragile selectors, the values redaction
 *    removed, and the fact that this is a demonstration rather than a designed
 *    procedure.
 */
export function renderBrowserSkillMarkdown(
  draft: AbacoBrowserSkillDraft,
  options: { recordingPath?: string; now?: Date } = {}
): string {
  const document = draft.document
  const generatedAt = (options.now ?? new Date()).toISOString()
  const host = hostOfBrowserUrl(document.final_url) || hostOfBrowserUrl(document.initial_url)
  const lastStep = draft.steps[draft.steps.length - 1]

  const frontmatter: string[] = [
    '---',
    `name: ${yamlString(draft.slug)}`,
    `description: ${yamlString(draft.description)}`,
    `whenToUse: ${yamlString(draft.whenToUse)}`,
    'metadata:',
    `  generated-by: ${yamlString('abaco-browser-f3')}`,
    `  generated-at: ${yamlString(generatedAt)}`,
    ...(options.recordingPath !== undefined
      ? [`  recording: ${yamlString(options.recordingPath)}`]
      : []),
    `  session-id: ${yamlString(document.session_id)}`,
    ...(document.started_at.length > 0 ? [`  recorded-at: ${yamlString(document.started_at)}`] : []),
    ...(document.ended_at.length > 0 ? [`  recorded-until: ${yamlString(document.ended_at)}`] : []),
    ...(document.initial_url.length > 0
      ? [`  initial-url: ${yamlString(document.initial_url)}`]
      : []),
    ...(document.final_url.length > 0 ? [`  final-url: ${yamlString(document.final_url)}`] : []),
    `  actions: ${document.actions.length}`,
    `  steps: ${draft.steps.length}`,
    `  redacted-values: ${document.actions.filter((action) => action.redacted === true).length}`,
    '---'
  ]

  const header: string[] = [
    `# ${draft.title}`,
    '',
    draft.description,
    '',
    `- **Página de entrada:** ${document.initial_url.length > 0 ? inlineCode(document.initial_url) : '(no registrada)'}`,
    `- **Página final:** ${document.final_url.length > 0 ? inlineCode(document.final_url) : '(no registrada)'}${host.length > 0 ? ` (${host})` : ''}`,
    `- **Grabación:** ${document.started_at.length > 0 ? `${inline(document.started_at, 40)} → ${inline(document.ended_at, 40) || '?'}` : 'sin fechas'}; sesión ${inlineCode(document.session_id || 'desconocida', 80)}`,
    `- **Contenido:** ${document.actions.length} acciones grabadas → ${draft.steps.length} pasos`,
    ...(options.recordingPath !== undefined
      ? [`- **Origen:** ${inlineCode(options.recordingPath)}`]
      : [])
  ]

  const steps: string[] = ['## Pasos', '']
  if (draft.steps.length === 0) {
    steps.push(
      'La grabación no contiene ninguna acción repetible (solo capturas o desplazamientos sin movimiento). Repite la demostración en el navegador integrado antes de usar este skill.'
    )
  } else {
    steps.push(renderRecordedSteps(draft.steps))
  }

  const verification: string[] = ['', '## Verification', '']
  if (document.final_url.length > 0) {
    verification.push(
      `- Llama a \`abaco_browser_state\` y comprueba que \`url\` es ${inlineCode(document.final_url)}: ahí terminó la sesión grabada.`
    )
  }
  if (document.title.length > 0) {
    verification.push(
      `- El título de la página grabada era «${inline(document.title, 90)}»; si \`title\` ya no se parece, el flujo se quedó en una pantalla anterior.`
    )
  }
  if (lastStep) {
    verification.push(
      `- La grabación terminó con: ${describeSkillStep(lastStep)}. Si ese control sigue en pantalla tal cual y no aparece la pantalla final, el flujo no se completó.`
    )
  }
  const finalShot = document.screenshots.final
  if (finalShot !== undefined) {
    verification.push(
      `- Captura de referencia: compara \`abaco_browser_screenshot\` con la captura final de la grabación, ${inlineCode(finalShot)}, usando \`read_image\`.`
    )
  }
  if (verification[verification.length - 1] === '') {
    verification.push(
      '- La grabación no tiene URL final: da por bueno el skill solo si el último paso produce el efecto que esperabas.'
    )
  }

  const notes: string[] = ['', '## Notes', '']
  notes.push(
    '- Grabado a partir de una demostración humana: los pasos son lo que el usuario hizo, no necesariamente el mínimo necesario. Puedes agrupar o reordenar mientras el resultado verifique.'
  )
  if (draft.fragileSelectors.length > 0) {
    notes.push(
      `- Selectores frágiles (probablemente generados por el framework y distintos tras el próximo despliegue): ${draft.fragileSelectors
        .map((selector) => inlineCode(selector, 120))
        .join(', ')}. Si fallan, localiza el elemento con \`abaco_browser_read_dom\` y reescribe el paso.`
    )
  }
  if (draft.redactedSelectors.length > 0) {
    notes.push(
      `- Valores omitidos: el contenido de ${draft.redactedSelectors
        .map((selector) => inlineCode(selector, 120))
        .join(', ')} se grabó como ${inlineCode(ABACO_BROWSER_REDACTED_VALUE)} por ser campos sensibles. Pide el valor real al usuario; no lo inventes.`
    )
  }
  notes.push(
    '- Antes de cada paso que dependa de contenido lento, usa `abaco_browser_wait_for` con el selector del paso: la grabación humana incluía esperas que el log no registra.'
  )
  notes.push(
    `- Si el overlay está en modo \`manual\`, los tools \`abaco_browser_*\` son rechazados: pide al usuario que devuelva el control (\`mode: agent\`) antes de ejecutar el skill.`
  )
  if (draft.dropped.overflow > 0) {
    notes.push(
      `- La grabación tenía más de ${ABACO_BROWSER_SKILL_MAX_STEPS} pasos: se omitieron los últimos ${draft.dropped.overflow}. Divide la tarea en varios skills si necesitas la parte final.`
    )
  }
  notes.push(
    `- Descartado al compilar (no son pasos): ${draft.dropped.screenshots} captura(s), ${draft.dropped.scrolls} desplazamiento(s) sin movimiento, ${draft.dropped.repeats} repetición(es) del mismo control, ${draft.dropped.redundant} fila(s) redundante(s)` +
      (draft.dropped.malformed > 0 ? `, ${draft.dropped.malformed} acción(es) ilegible(s)` : '') +
      (document.skipped.redactedValues > 0
        ? `; el grabador además enmascaró ${document.skipped.redactedValues} valor(es) sensible(s)`
        : '') +
      '.'
  )

  return [...frontmatter, '', ...header, '', ...steps, ...verification, ...notes, ''].join('\n')
}

/* ────────────────────────────────────────────────────────────────────────────
 * Writing it
 * ──────────────────────────────────────────────────────────────────────────── */

/** One entry of the recordings directory, as the newest-first scan sees it. */
export interface AbacoBrowserRecordingEntry {
  name: string
  modifiedMs: number
}

/**
 * Everything injectable, so `test/abaco-browser-skill.test.ts` can drive a
 * whole save against a temp directory.
 */
export interface AbacoBrowserSkillWriterOptions {
  /** `<userData>/abaco-browser/recordings`. */
  recordingsDir: string
  /** `<DSH_HOME>/skills` — the user-scope root the Harness already scans. */
  skillsDir: string
  /** Session id to compile; omitted or empty means "the newest recording". */
  recordingId?: string
  /** Slug the user typed in the strip; omitted means "derive it from the page". */
  requestedName?: string
  now?: () => Date
  readTextFile?: (path: string) => Promise<string>
  listRecordingFiles?: (dir: string) => Promise<AbacoBrowserRecordingEntry[]>
  pathExists?: (path: string) => Promise<boolean>
  ensureDir?: (path: string, mode: number) => Promise<void>
  writeTextFile?: (path: string, data: string, mode: number) => Promise<void>
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isAbsent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

/** Default directory scan: `*.json`, newest first, name as the tie-breaker. */
async function listRecordings(dir: string): Promise<AbacoBrowserRecordingEntry[]> {
  const entries = await readdir(dir, { withFileTypes: true, encoding: 'utf8' })
  const files: AbacoBrowserRecordingEntry[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const path = join(dir, entry.name)
    try {
      files.push({ name: entry.name, modifiedMs: (await stat(path)).mtimeMs })
    } catch {
      // A recording that vanished between the listing and the stat is not a
      // candidate; the next one in the list is.
    }
  }
  files.sort((left, right) =>
    right.modifiedMs === left.modifiedMs
      ? right.name.localeCompare(left.name)
      : right.modifiedMs - left.modifiedMs
  )
  return files
}

/** Refuse a session id that could address anything but a recording file. */
function isSafeRecordingId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) && !value.includes('..')
}

/**
 * Compile one recording into `<skillsDir>/<slug>/SKILL.md`.
 *
 * Every failure — no recording yet, a corrupt file, a directory that cannot be
 * created — comes back as `{ ok: false, error }` with a sentence the chrome
 * strip can show. Nothing here throws: the caller is an IPC handler whose
 * result is painted into a 44px toolbar, and a rejected promise would reach the
 * user as "Error invoking remote method".
 */
export async function writeBrowserSkillFromRecording(
  options: AbacoBrowserSkillWriterOptions
): Promise<AbacoBrowserSaveSkillResult> {
  const readText =
    options.readTextFile ?? (async (path: string) => await readFile(path, 'utf8'))
  const listFiles = options.listRecordingFiles ?? listRecordings
  const exists = options.pathExists ?? defaultPathExists
  const ensureDir = options.ensureDir ?? (async (path: string, mode: number) => {
    await mkdir(path, { recursive: true, mode })
  })
  const writeText =
    options.writeTextFile ?? (async (path: string, data: string, mode: number) => {
      await writeFile(path, data, { encoding: 'utf8', mode })
    })
  const now = options.now ?? (() => new Date())

  const recordingPath = await resolveRecordingPath({
    recordingsDir: options.recordingsDir,
    recordingId: (options.recordingId ?? '').trim(),
    listFiles
  })
  if (!recordingPath.ok) return failure(recordingPath.error)

  let raw: string
  try {
    raw = await readText(recordingPath.path)
  } catch (error) {
    return failure(
      isAbsent(error)
        ? `The recording at ${recordingPath.path} no longer exists.`
        : `Could not read the recording at ${recordingPath.path}: ${describe(error)}`
    )
  }

  const parsed = parseBrowserRecordingDocument(raw, { path: recordingPath.path })
  if (!parsed.ok) return failure(parsed.error)

  const draft = draftBrowserSkill(parsed.document, {
    ...(options.requestedName !== undefined ? { requestedName: options.requestedName } : {}),
    malformedActions: parsed.malformedActions
  })

  const directory = await resolveUniqueSkillDirectory(options.skillsDir, draft.slug, exists)
  const slug = directory.slice(options.skillsDir.length).replace(/^[/\\]+/u, '')
  if (slug.length === 0 || slug.includes('/') || slug.includes('\\')) {
    // A guard for the arithmetic above rather than for a real input: the caller
    // must be able to trust that `name` matches the directory that was written.
    return failure(`Could not derive a skill name for ${recordingPath.path}.`)
  }
  const path = join(directory, ABACO_BROWSER_SKILL_FILENAME)
  const markdown = renderBrowserSkillMarkdown(
    { ...draft, slug },
    { recordingPath: recordingPath.path, now: now() }
  )

  try {
    await ensureDir(directory, ABACO_BROWSER_SKILL_DIR_MODE)
    await writeText(path, markdown, ABACO_BROWSER_SKILL_FILE_MODE)
  } catch (error) {
    return failure(`Could not write ${path}: ${describe(error)}`)
  }

  return {
    ok: true,
    name: slug,
    path,
    directory,
    description: draft.description,
    stepCount: draft.steps.length,
    error: ''
  }
}

/**
 * Directories are `0700` and the file `0600`: a skill derived from a recording
 * can name internal URLs, internal selector names and the shape of a login, and
 * the Harness reads it as the same user that wrote it. A skill the user *wants*
 * to share can be copied out — which is also the point at which they should
 * re-read it.
 */
export const ABACO_BROWSER_SKILL_DIR_MODE = 0o700

/** See {@link ABACO_BROWSER_SKILL_DIR_MODE}. */
export const ABACO_BROWSER_SKILL_FILE_MODE = 0o600

async function defaultPathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (isAbsent(error)) return false
    throw error
  }
}

/** Which file to compile: the requested session, or the newest recording. */
async function resolveRecordingPath(input: {
  recordingsDir: string
  recordingId: string
  listFiles: (dir: string) => Promise<AbacoBrowserRecordingEntry[]>
}): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  if (input.recordingId.length > 0) {
    if (!isSafeRecordingId(input.recordingId)) {
      return { ok: false, error: `"${input.recordingId}" is not a valid recording id.` }
    }
    return { ok: true, path: join(input.recordingsDir, `${input.recordingId}.json`) }
  }
  let files: AbacoBrowserRecordingEntry[]
  try {
    files = await input.listFiles(input.recordingsDir)
  } catch (error) {
    return {
      ok: false,
      error: isAbsent(error)
        ? `There are no recordings yet (${input.recordingsDir} does not exist). Record your actions in the ABACO browser first.`
        : `Could not list the recordings in ${input.recordingsDir}: ${describe(error)}`
    }
  }
  const newest = files[0]
  if (!newest) {
    return {
      ok: false,
      error: `There are no recordings in ${input.recordingsDir} yet. Record your actions in the ABACO browser first.`
    }
  }
  return { ok: true, path: join(input.recordingsDir, newest.name) }
}

/**
 * The first free slug, so a second save of the same flow becomes `foo-2` rather
 * than overwriting the first skill. The Harness keys skills by name, so an
 * overwrite would silently replace what the user already had.
 */
async function resolveUniqueSkillDirectory(
  skillsDir: string,
  base: string,
  exists: (path: string) => Promise<boolean>
): Promise<string> {
  const candidates: string[] = [base]
  for (let index = 2; index <= ABACO_BROWSER_SKILL_MAX_SUFFIX; index += 1) {
    candidates.push(`${base}-${index}`)
  }
  for (const candidate of candidates) {
    if (!(await exists(join(skillsDir, candidate)))) return join(skillsDir, candidate)
  }
  // Every numbered name is taken: a timestamp keeps the write from landing on
  // somebody else's skill, which is the only outcome that would lose data.
  return join(skillsDir, `${base}-${Date.now()}`)
}

function failure(error: string): AbacoBrowserSaveSkillResult {
  return { ok: false, name: '', path: '', directory: '', description: '', stepCount: 0, error }
}

/* ────────────────────────────────────────────────────────────────────────────
 * DSH_HOME
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Resolve `$DSH_HOME` the way the Harness itself does: the environment first
 * (an explicit override is a deliberate act), then the value the shell injects
 * into the Harness child, which in this app is `<userData>/harness`.
 *
 * Mirrors `resolveDshHome` in `@deepseek-ai/dsh-home-paths` — a blank variable is
 * unset, never "the current directory" — but is restated here because main must
 * be able to resolve it without pulling the Harness's own package into the
 * Electron bundle.
 */
export function resolveAbacoDshHome(
  env: NodeJS.ProcessEnv = process.env,
  fallback: string
): string {
  const fromEnv = env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return fromEnv.trim()
  return fallback
}

/** `<DSH_HOME>/skills`, the user-scope root `dsh-skill-filesystem` scans. */
export function abacoBrowserSkillsDir(dshHome: string): string {
  return join(dshHome, ABACO_BROWSER_SKILLS_DIRNAME)
}
