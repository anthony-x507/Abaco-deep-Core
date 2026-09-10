import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { isSkillName } from '@deepseek-ai/dsh-skill'
import {
  ABACO_BROWSER_RECORDING_SCHEMA,
  ABACO_BROWSER_REDACTED_VALUE,
  ABACO_BROWSER_SKILL_FILENAME,
  ABACO_BROWSER_SKILL_MAX_STEPS,
  ABACO_BROWSER_SKILL_MAX_SUFFIX,
  ABACO_BROWSER_SKILLS_DIRNAME,
  abacoBrowserChannels,
  isFragileBrowserSelector,
  type AbacoBrowserRecordedAction,
  type AbacoBrowserRecordingDocument
} from '../src/shared/abaco-browser'
import {
  abacoBrowserSkillsDir,
  browserSkillSlug,
  collapseRecordedActions,
  draftBrowserSkill,
  inlineCode,
  parseBrowserRecordingDocument,
  renderBrowserSkillMarkdown,
  resolveAbacoDshHome,
  slugifyBrowserSkillName,
  writeBrowserSkillFromRecording,
  type AbacoBrowserSkillDraft
} from '../src/main/abaco-browser-skill-writer'

/* ──────────────────────────────────────────────────────────────────────────────
 * F3 — a finished F2 recording becomes a SKILL.md the Harness discovers.
 *
 * F2's own suite proves the recording is written; this one proves the far end of
 * that pipeline: that the collapse policy turns a raw event log into steps an
 * agent can follow, that the frontmatter is one the real skill provider accepts
 * (parsed here by the provider itself, not by a copy of its rules), that a
 * second save cannot overwrite the first skill, and that a missing or corrupt
 * recording is a sentence rather than a crash.
 * ────────────────────────────────────────────────────────────────────────────── */

const tempRoots: string[] = []

async function tempRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'abaco-skill-'))
  tempRoots.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true })
    })
  )
})

function field(
  overrides: Partial<NonNullable<AbacoBrowserRecordedAction['field']>> = {}
): NonNullable<AbacoBrowserRecordedAction['field']> {
  return { tag: 'input', type: 'text', name: '', id: '', autocomplete: '', ...overrides }
}

const LOGIN = 'https://panel.example.com/login'
const INVOICES = 'https://panel.example.com/invoices'
const NEW_INVOICE = 'https://panel.example.com/invoices/new'

/**
 * One recording, in the shape F2 writes: the initial `navigate` row first, then
 * the user's actions, then the closing `screenshot` row.
 *
 * It deliberately holds every kind of noise the collapse pass exists for — a
 * double click on the same control, a focus click before typing, a corrected
 * value typed into the same field, a password the recorder masked, a 50px
 * scroll, a framework-generated selector — so the expected step list is a
 * statement about the policy and not about this fixture.
 */
function sampleRecording(
  overrides: Partial<AbacoBrowserRecordingDocument> = {}
): AbacoBrowserRecordingDocument {
  return {
    schema: ABACO_BROWSER_RECORDING_SCHEMA,
    session_id: '2026-09-06T10-00-00-000Z',
    started_at: '2026-09-06T10:00:00.000Z',
    ended_at: '2026-09-06T10:02:30.000Z',
    initial_url: LOGIN,
    final_url: NEW_INVOICE,
    title: 'Facturas — Panel de ejemplo',
    mode: 'manual',
    actions: [
      {
        timestamp: '2026-09-06T10:00:00.000Z',
        url: LOGIN,
        action_type: 'navigate',
        notes: 'initial page; title="Acceso — Panel de ejemplo"'
      },
      // A double click on the same control: one step, "pulsado 2 veces".
      {
        timestamp: '2026-09-06T10:00:05.000Z',
        url: LOGIN,
        action_type: 'click',
        selector: '#user',
        text: 'Usuario',
        field: field({ id: 'user' })
      },
      {
        timestamp: '2026-09-06T10:00:05.400Z',
        url: LOGIN,
        action_type: 'click',
        selector: '#user',
        text: 'Usuario',
        field: field({ id: 'user' })
      },
      // A corrected value: the latest one is the one that matters.
      {
        timestamp: '2026-09-06T10:00:06.000Z',
        url: LOGIN,
        action_type: 'type',
        selector: '#user',
        text: 'ana@example.co',
        field: field({ id: 'user' })
      },
      {
        timestamp: '2026-09-06T10:00:07.000Z',
        url: LOGIN,
        action_type: 'type',
        selector: '#user',
        text: 'ana@example.com',
        field: field({ id: 'user' })
      },
      // The password: masked by F2, so the skill must ask for it instead.
      {
        timestamp: '2026-09-06T10:00:09.000Z',
        url: LOGIN,
        action_type: 'type',
        selector: '#pass',
        text: ABACO_BROWSER_REDACTED_VALUE,
        redacted: true,
        field: field({ type: 'password', id: 'pass', name: 'password', autocomplete: 'current-password' })
      },
      // The click that focused the field the recorder just typed into.
      {
        timestamp: '2026-09-06T10:00:09.400Z',
        url: LOGIN,
        action_type: 'click',
        selector: '#pass',
        text: '',
        field: field({ type: 'password', id: 'pass' })
      },
      {
        timestamp: '2026-09-06T10:00:11.000Z',
        url: LOGIN,
        action_type: 'click',
        selector: '#login',
        text: 'Entrar',
        notes: 'form submit',
        field: field({ type: 'submit', id: 'login' })
      },
      {
        timestamp: '2026-09-06T10:00:20.000Z',
        url: INVOICES,
        action_type: 'navigate',
        notes: 'title="Facturas — Panel de ejemplo"'
      },
      // A reading pause, then 50px of momentum (dropped), then a real move.
      {
        timestamp: '2026-09-06T10:00:30.000Z',
        url: INVOICES,
        action_type: 'scroll',
        notes: 'y=600'
      },
      {
        timestamp: '2026-09-06T10:00:30.200Z',
        url: INVOICES,
        action_type: 'scroll',
        notes: 'y=650'
      },
      {
        timestamp: '2026-09-06T10:01:00.000Z',
        url: INVOICES,
        action_type: 'click',
        selector: '.css-1x2y3z > div:nth-child(2) > button',
        text: 'Nueva factura'
      },
      {
        timestamp: '2026-09-06T10:01:20.000Z',
        url: INVOICES,
        action_type: 'scroll',
        notes: 'y=1400'
      },
      {
        timestamp: '2026-09-06T10:02:00.000Z',
        url: NEW_INVOICE,
        action_type: 'navigate',
        notes: 'title="Nueva factura"'
      },
      {
        timestamp: '2026-09-06T10:02:30.000Z',
        url: NEW_INVOICE,
        action_type: 'screenshot',
        screenshot_path: '/tmp/session-final.png',
        notes: 'final'
      }
    ],
    screenshots: { initial: '/tmp/session-initial.png', final: '/tmp/session-final.png' },
    skipped: { malformedMessages: 1, redactedValues: 1, duplicateActions: 3 },
    ...overrides
  }
}

/** What {@link collapseRecordedActions} must answer for {@link sampleRecording}. */
const EXPECTED_STEP_TYPES = [
  'navigate',
  'click',
  'type',
  'type',
  'click',
  'navigate',
  'scroll',
  'click',
  'scroll',
  'navigate'
]

async function writeRecording(directory: string, id: string, document: unknown): Promise<string> {
  await mkdir(directory, { recursive: true })
  const path = join(directory, `${id}.json`)
  // A string is written verbatim (that is how a truncated file is built); an
  // object is serialized the way F2 writes it.
  const body = typeof document === 'string' ? document : JSON.stringify(document, null, 2)
  await writeFile(path, body, 'utf8')
  return path
}

/** The draft the renderer consumes, without going through the disk. */
function draftFor(document: AbacoBrowserRecordingDocument): AbacoBrowserSkillDraft {
  return draftBrowserSkill(document)
}

/** Split the generated document the way the skill provider's parser does. */
function frontmatter(markdown: string): { data: Record<string, unknown>; body: string } {
  expect(markdown.startsWith('---\n')).toBe(true)
  const closing = markdown.indexOf('\n---\n', 3)
  expect(closing).toBeGreaterThan(0)
  const data = parseYaml(markdown.slice(4, closing + 1)) as Record<string, unknown>
  return { data, body: markdown.slice(closing + 5) }
}

/** The numbered-list markers of the body, in order. */
function numberedSteps(body: string): number[] {
  return [...body.matchAll(/^(\d+)\. /gmu)].map((match) => Number(match[1]))
}

/* ──────────────────────────────────────────────────────────────────────────────
 * The collapse policy
 * ────────────────────────────────────────────────────────────────────────────── */

describe('ABACO browser skill collapse (F3)', () => {
  it('turns the recorded log into the steps an agent should follow', () => {
    const { steps, dropped } = collapseRecordedActions(sampleRecording().actions)

    expect(steps.map((step) => step.action_type)).toEqual(EXPECTED_STEP_TYPES)
    // Rule 2: two presses of `#user` are one step that says so.
    const userClick = steps[1]
    expect(userClick?.selector).toBe('#user')
    expect(userClick?.repeat).toBe(2)
    // Rule 3: the click that only focused the password field is gone.
    expect(steps.some((step) => step.action_type === 'click' && step.selector === '#pass')).toBe(
      false
    )
    // A corrected value keeps the last one typed, not the first.
    expect(steps[2]?.text).toBe('ana@example.com')
    // The masked value survives as a *fact* about the field, never as a value.
    expect(steps[3]?.redacted).toBe(true)
    expect(steps[3]?.text).toBe(ABACO_BROWSER_REDACTED_VALUE)

    // Rule 1: the bookend screenshot is provenance, not a step.
    expect(dropped.screenshots).toBe(1)
    // Rule 4: `y=650` is momentum; `y=1400` is a new position.
    expect(dropped.scrolls).toBe(1)
    expect(dropped.repeats).toBe(2)
    expect(dropped.redundant).toBe(1)
  })

  it('groups only *consecutive* presses of the same control on the same page', () => {
    const actions: AbacoBrowserRecordedAction[] = [
      { timestamp: 't1', url: 'https://a.test/', action_type: 'click', selector: '#go' },
      { timestamp: 't2', url: 'https://a.test/', action_type: 'click', selector: '#go' },
      // A different page resets the grouping: the same selector is a different
      // control in a different document.
      { timestamp: 't3', url: 'https://a.test/next', action_type: 'click', selector: '#go' },
      { timestamp: 't4', url: 'https://a.test/next', action_type: 'click', selector: '#go' },
      { timestamp: 't5', url: 'https://a.test/next', action_type: 'click', selector: '#go' },
      { timestamp: 't6', url: 'https://a.test/next', action_type: 'click', selector: '#other' }
    ]
    const { steps, dropped } = collapseRecordedActions(actions)
    expect(steps).toHaveLength(3)
    expect(steps.map((step) => step.repeat)).toEqual([2, 3, 1])
    expect(dropped.repeats).toBe(3)
  })

  it('keeps the first scroll of a page and drops the momentum after it', () => {
    const actions: AbacoBrowserRecordedAction[] = [
      { timestamp: 't1', url: 'https://a.test/', action_type: 'scroll', notes: 'y=0' },
      { timestamp: 't2', url: 'https://a.test/', action_type: 'scroll', notes: 'y=90' },
      { timestamp: 't3', url: 'https://a.test/', action_type: 'scroll', notes: 'y=150' }
    ]
    const { steps, dropped } = collapseRecordedActions(actions)
    expect(steps).toHaveLength(1)
    expect(steps[0]?.notes).toBe('y=0')
    expect(dropped.scrolls).toBe(2)
    // The threshold, stated: 199px is momentum, 200px is a new position.
    const boundary = collapseRecordedActions([
      { timestamp: 't1', url: 'https://a.test/', action_type: 'scroll', notes: 'y=100' },
      { timestamp: 't2', url: 'https://a.test/', action_type: 'scroll', notes: 'y=299' },
      { timestamp: 't3', url: 'https://a.test/', action_type: 'scroll', notes: 'y=499' }
    ])
    expect(boundary.steps.map((step) => step.notes)).toEqual(['y=100', 'y=499'])
  })

  it('drops the rows an agent cannot act on and counts them', () => {
    const { steps, dropped } = collapseRecordedActions(
      [
        { timestamp: 't1', url: 'https://a.test/', action_type: 'screenshot', notes: 'initial' },
        { timestamp: 't2', url: 'https://a.test/', action_type: 'wait', selector: '#slow' }
      ],
      { malformed: 4 }
    )
    expect(steps.map((step) => step.action_type)).toEqual(['wait'])
    expect(dropped.screenshots).toBe(1)
    expect(dropped.malformed).toBe(4)
  })

  it('caps a runaway recording instead of emitting a hundred-step skill', () => {
    const actions: AbacoBrowserRecordedAction[] = []
    for (let index = 0; index < ABACO_BROWSER_SKILL_MAX_STEPS + 25; index += 1) {
      actions.push({
        timestamp: `t${index}`,
        url: 'https://a.test/',
        action_type: 'click',
        selector: `#row-${index}`
      })
    }
    const { steps, dropped } = collapseRecordedActions(actions)
    expect(steps).toHaveLength(ABACO_BROWSER_SKILL_MAX_STEPS)
    expect(dropped.overflow).toBe(25)
  })
})

/* ──────────────────────────────────────────────────────────────────────────────
 * The generated document
 * ────────────────────────────────────────────────────────────────────────────── */

describe('ABACO browser skill renderer (F3)', () => {
  it('renders frontmatter the skill provider can parse and numbered steps', async () => {
    const root = await tempRoot()
    const recordingsDir = join(root, 'abaco-browser', 'recordings')
    const skillsDir = abacoBrowserSkillsDir(join(root, 'harness'))
    const recordingPath = await writeRecording(
      recordingsDir,
      '2026-09-06T10-00-00-000Z',
      sampleRecording()
    )

    const result = await writeBrowserSkillFromRecording({ recordingsDir, skillsDir })

    expect(result.ok).toBe(true)
    expect(result.error).toBe('')
    expect(result.name).toBe('facturas-panel-de-ejemplo')
    expect(result.directory).toBe(join(root, 'harness', ABACO_BROWSER_SKILLS_DIRNAME, result.name))
    expect(result.path).toBe(join(result.directory, ABACO_BROWSER_SKILL_FILENAME))
    expect(result.stepCount).toBe(EXPECTED_STEP_TYPES.length)
    expect(result.description).toContain('panel.example.com')

    const markdown = await readFile(result.path, 'utf8')
    const { data, body } = frontmatter(markdown)

    // The two fields the provider *requires*, in the shape it validates.
    expect(data.name).toBe(result.name)
    expect(isSkillName(String(data.name))).toBe(true)
    expect(typeof data.description).toBe('string')
    expect(String(data.description)).toContain('panel.example.com')
    expect(typeof data.whenToUse).toBe('string')
    // Provenance, so a stale skill can be traced back to its demonstration.
    const metadata = data.metadata as Record<string, unknown>
    expect(metadata['generated-by']).toBe('abaco-browser-f3')
    expect(metadata.recording).toBe(recordingPath)
    expect(metadata['session-id']).toBe('2026-09-06T10-00-00-000Z')
    expect(metadata['final-url']).toBe(NEW_INVOICE)

    // Numbered from 1, one step per line, each naming the tool that runs it.
    expect(numberedSteps(body)).toEqual(
      Array.from({ length: EXPECTED_STEP_TYPES.length }, (_value, index) => index + 1)
    )
    expect(body).toContain('## Pasos')
    expect(body).toContain('`abaco_browser_navigate`')
    expect(body).toContain('`abaco_browser_click`')
    expect(body).toContain('`abaco_browser_type`')
    expect(body).toContain(`1. Navega a \`${LOGIN}\` con \`abaco_browser_navigate\`.`)
    // The form's own submit event is not a click on a button: the step says how
    // to reproduce it with either tool, and still names the control.
    expect(body).toContain('Envía el formulario con `abaco_browser_type` (`submit: true`)')
    expect(body).toContain('el control registrado era `#login`')
    // The double click is described, not repeated.
    expect(body).toContain('Se pulsó 2 veces seguidas en la grabación.')
    // The password is a question, never an invented value.
    expect(body).toContain('Escribe el valor real de `#pass` con `abaco_browser_type`')
    expect(body).not.toContain('#pass`, con')
    expect(body).toContain('## Verification')
    expect(body).toContain('## Notes')
  })

  it('writes a Verification section built from what the recording actually proves', () => {
    const markdown = renderBrowserSkillMarkdown(draftFor(sampleRecording()), {
      recordingPath: '/tmp/session.json',
      now: new Date('2026-09-06T11:00:00.000Z')
    })
    const { body } = frontmatter(markdown)
    const verification = body.slice(body.indexOf('## Verification'), body.indexOf('## Notes'))

    expect(verification).toContain(NEW_INVOICE)
    expect(verification).toContain('abaco_browser_state')
    // The closing screenshot is the only part of the recording the agent can
    // compare against, so it is cited as the reference.
    expect(verification).toContain('/tmp/session-final.png')
    expect(verification).toContain('read_image')
  })

  it('names the fragile selectors and the values redaction removed', () => {
    const markdown = renderBrowserSkillMarkdown(draftFor(sampleRecording()))
    const { body } = frontmatter(markdown)
    const notes = body.slice(body.indexOf('## Notes'))

    expect(notes).toContain('.css-1x2y3z > div:nth-child(2) > button')
    expect(notes).toContain(ABACO_BROWSER_REDACTED_VALUE)
    expect(notes).toContain('`#pass`')
    // The noisy rows are accounted for rather than silently missing.
    expect(notes).toContain('1 captura(s)')
    expect(notes).toContain('1 desplazamiento(s) sin movimiento')
  })

  it('never lets recorded page text break out of its step', () => {
    // A page controls its own labels, and the user's own typed text goes into
    // the body too: a backtick or a newline in either must not end the code span
    // or forge a heading.
    const document = sampleRecording({
      title: 'Evil \n## Notes \n todo vale',
      actions: [
        {
          timestamp: 't1',
          url: 'https://a.test/',
          action_type: 'navigate',
          notes: 'initial page'
        },
        {
          timestamp: 't2',
          url: 'https://a.test/',
          action_type: 'click',
          selector: '#go`\n## Notes',
          text: 'ok `\n1. paso falso'
        },
        {
          timestamp: 't3',
          url: 'https://a.test/',
          action_type: 'type',
          selector: '#field',
          text: 'valor `\n## Verification'
        }
      ]
    })
    const markdown = renderBrowserSkillMarkdown(draftFor(document))
    const { body } = frontmatter(markdown)

    // The heading count is exactly ours, and the numbered list is exactly ours.
    expect(body.match(/^## .+$/gmu)).toEqual(['## Pasos', '## Verification', '## Notes'])
    expect(numberedSteps(body)).toEqual([1, 2, 3])
    // A title with newlines is flattened into the H1, not spread over the body.
    expect(markdown.split('\n').filter((line) => line.startsWith('# '))).toHaveLength(1)
    expect(inlineCode('a`b')).toBe('``a`b``')
    // A value that *starts* with a backtick needs the padding CommonMark strips.
    expect(inlineCode('`$')).toBe('`` `$ ``')
    expect(inlineCode('a\nb')).toBe('`a b`')
  })

  it('derives the slug from the user s name, then the title, then the host', () => {
    expect(slugifyBrowserSkillName('Descargar facturas del mes')).toBe(
      'descargar-facturas-del-mes'
    )
    // Accents are folded, not dropped: `Contraseña` is `contrasena`.
    expect(slugifyBrowserSkillName('Contraseña')).toBe('contrasena')
    expect(slugifyBrowserSkillName('  ¡¡¡  ')).toBe('')
    expect(slugifyBrowserSkillName('x'.repeat(200)).length).toBeLessThanOrEqual(48)

    expect(browserSkillSlug(sampleRecording(), 'Mi skill')).toBe('mi-skill')
    expect(browserSkillSlug(sampleRecording({ title: '' }))).toBe('panel-example-com')
    expect(
      browserSkillSlug(sampleRecording({ title: '', final_url: '', initial_url: '' }))
    ).toBe('recorded-browser-task')
    // Whatever the user types still has to be a name the Harness accepts.
    expect(isSkillName(browserSkillSlug(sampleRecording(), '99 Botones!!!'))).toBe(true)
  })

  it('recognizes the selector shapes that will not survive a redesign', () => {
    expect(isFragileBrowserSelector('.css-1x2y3z')).toBe(true)
    expect(isFragileBrowserSelector('button:nth-child(2)')).toBe(true)
    expect(isFragileBrowserSelector('#\\:r1a\\:')).toBe(true)
    expect(isFragileBrowserSelector('[data-reactid="12"]')).toBe(true)
    expect(isFragileBrowserSelector(`#${'a'.repeat(120)}`)).toBe(true)
    expect(isFragileBrowserSelector('main > div > ul > li > a > span > b')).toBe(true)
    expect(isFragileBrowserSelector('#login-form input[name="email"]')).toBe(false)
    expect(isFragileBrowserSelector('button[type="submit"]')).toBe(false)
  })
})

/* ──────────────────────────────────────────────────────────────────────────────
 * Saving
 * ────────────────────────────────────────────────────────────────────────────── */

describe('ABACO browser skill saving (F3)', () => {
  it('writes into the $DSH_HOME it is given, not into the bundle or the recordings', async () => {
    const root = await tempRoot()
    const dshHome = join(root, 'Library', 'Application Support', 'abaco-deep-core', 'harness')
    const recordingsDir = join(root, 'userData', 'abaco-browser', 'recordings')
    await writeRecording(recordingsDir, 'session-a', sampleRecording())

    const result = await writeBrowserSkillFromRecording({
      recordingsDir,
      skillsDir: abacoBrowserSkillsDir(dshHome)
    })

    expect(result.ok).toBe(true)
    expect(result.path).toBe(join(dshHome, 'skills', result.name, 'SKILL.md'))
    expect((await readdir(join(dshHome, 'skills'))) ).toEqual([result.name])
    if (process.platform !== 'win32') {
      // A skill compiled from a recording can name internal pages and the shape
      // of a login, so the bundle is private to the user that made it.
      expect((await stat(result.path)).mode & 0o777).toBe(0o600)
      expect((await stat(result.directory)).mode & 0o777).toBe(0o700)
    }
  })

  it('resolves $DSH_HOME the way the Harness does', () => {
    expect(resolveAbacoDshHome({ DSH_HOME: '/tmp/custom-home' }, '/fallback')).toBe(
      '/tmp/custom-home'
    )
    expect(resolveAbacoDshHome({ DSH_HOME: '  ' }, '/fallback')).toBe('/fallback')
    expect(resolveAbacoDshHome({}, '/fallback')).toBe('/fallback')
    expect(abacoBrowserSkillsDir('/h')).toBe('/h/skills')
  })

  it('compiles the newest recording when no session id is given', async () => {
    const root = await tempRoot()
    const recordingsDir = join(root, 'recordings')
    const skillsDir = join(root, 'skills')
    await writeRecording(recordingsDir, 'session-old', sampleRecording({ title: 'Viejo' }))
    // Same clock in a test environment: the file that was written last wins.
    await new Promise((resolve) => setTimeout(resolve, 10))
    await writeRecording(recordingsDir, 'session-new', sampleRecording({ title: 'Nuevo' }))
    await writeFile(join(recordingsDir, 'notes.txt'), 'not a recording', 'utf8')

    const result = await writeBrowserSkillFromRecording({ recordingsDir, skillsDir })
    expect(result.ok).toBe(true)
    expect(result.name).toBe('nuevo')
  })

  it('compiles the session the strip asked for, by id', async () => {
    const root = await tempRoot()
    const recordingsDir = join(root, 'recordings')
    const skillsDir = join(root, 'skills')
    await writeRecording(recordingsDir, 'session-old', sampleRecording({ title: 'Viejo' }))
    await writeRecording(recordingsDir, 'session-new', sampleRecording({ title: 'Nuevo' }))

    const result = await writeBrowserSkillFromRecording({
      recordingsDir,
      skillsDir,
      recordingId: 'session-old'
    })
    expect(result.ok).toBe(true)
    expect(result.name).toBe('viejo')
  })

  it('never overwrites an existing skill: the second save takes a suffix', async () => {
    const root = await tempRoot()
    const recordingsDir = join(root, 'recordings')
    const skillsDir = join(root, 'skills')
    await writeRecording(recordingsDir, 'session-a', sampleRecording())

    const first = await writeBrowserSkillFromRecording({
      recordingsDir,
      skillsDir,
      requestedName: 'descargar facturas'
    })
    const second = await writeBrowserSkillFromRecording({
      recordingsDir,
      skillsDir,
      requestedName: 'descargar facturas'
    })
    const third = await writeBrowserSkillFromRecording({
      recordingsDir,
      skillsDir,
      requestedName: 'descargar facturas'
    })

    expect([first.name, second.name, third.name]).toEqual([
      'descargar-facturas',
      'descargar-facturas-2',
      'descargar-facturas-3'
    ])
    // The first skill is still exactly what it was, with its own name inside.
    expect(frontmatter(await readFile(first.path, 'utf8')).data.name).toBe('descargar-facturas')
    expect(frontmatter(await readFile(second.path, 'utf8')).data.name).toBe(
      'descargar-facturas-2'
    )
    expect((await readdir(skillsDir)).sort()).toEqual([
      'descargar-facturas',
      'descargar-facturas-2',
      'descargar-facturas-3'
    ])
  })

  it('falls back to a timestamp when every numbered name is taken', async () => {
    const root = await tempRoot()
    const recordingsDir = join(root, 'recordings')
    const skillsDir = join(root, 'skills')
    await writeRecording(recordingsDir, 'session-a', sampleRecording())
    // One directory beyond the writer's search window.
    for (let index = 1; index <= ABACO_BROWSER_SKILL_MAX_SUFFIX; index += 1) {
      const name = index === 1 ? 'ocupado' : `ocupado-${index}`
      await mkdir(join(skillsDir, name), { recursive: true })
    }

    const result = await writeBrowserSkillFromRecording({
      recordingsDir,
      skillsDir,
      requestedName: 'ocupado'
    })
    expect(result.ok).toBe(true)
    expect(result.name.startsWith('ocupado-')).toBe(true)
    expect(result.name).not.toBe('ocupado')
  })
})

/* ──────────────────────────────────────────────────────────────────────────────
 * Failures are sentences, not crashes
 * ────────────────────────────────────────────────────────────────────────────── */

describe('ABACO browser skill failures (F3)', () => {
  it('explains that there is nothing to compile yet', async () => {
    const root = await tempRoot()
    const result = await writeBrowserSkillFromRecording({
      recordingsDir: join(root, 'missing'),
      skillsDir: join(root, 'skills')
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('no recordings')
    expect(result.error).toContain(join(root, 'missing'))
    expect(result.path).toBe('')
    expect(result.stepCount).toBe(0)
  })

  it('refuses a corrupt recording without throwing', async () => {
    const root = await tempRoot()
    const recordingsDir = join(root, 'recordings')
    const skillsDir = join(root, 'skills')
    await writeRecording(recordingsDir, 'truncated', '{ "schema": "abaco-browser-recording/1", "act')
    await writeRecording(recordingsDir, 'not-a-recording', { hello: 'world' })
    await writeRecording(recordingsDir, 'other-schema', {
      schema: 'abaco-browser-recording/99',
      actions: []
    })
    await writeRecording(recordingsDir, 'no-actions', {
      schema: ABACO_BROWSER_RECORDING_SCHEMA,
      actions: []
    })
    await writeRecording(recordingsDir, 'wrong-type', [1, 2, 3])

    for (const [id, expected] of [
      ['truncated', 'not valid JSON'],
      ['not-a-recording', 'no "schema" field'],
      ['other-schema', 'cannot read'],
      ['no-actions', 'no usable actions'],
      ['wrong-type', 'not a recording object']
    ] as const) {
      const result = await writeBrowserSkillFromRecording({
        recordingsDir,
        skillsDir,
        recordingId: id
      })
      expect(result.ok).toBe(false)
      expect(result.error).toContain(expected)
      expect(result.path).toBe('')
    }
    // Nothing was written for any of them.
    await expect(readdir(skillsDir)).rejects.toThrow()
  })

  it('refuses a recording id that is not one, and reports a vanished file', async () => {
    const root = await tempRoot()
    const recordingsDir = join(root, 'recordings')
    const skillsDir = join(root, 'skills')
    await writeRecording(recordingsDir, 'session-a', sampleRecording())

    const traversal = await writeBrowserSkillFromRecording({
      recordingsDir,
      skillsDir,
      recordingId: '../../etc/passwd'
    })
    expect(traversal.ok).toBe(false)
    expect(traversal.error).toContain('not a valid recording id')

    const absent = await writeBrowserSkillFromRecording({
      recordingsDir,
      skillsDir,
      recordingId: 'session-that-never-was'
    })
    expect(absent.ok).toBe(false)
    expect(absent.error).toContain('no longer exists')
  })

  it('reports an unwritable skills directory instead of claiming success', async () => {
    const root = await tempRoot()
    const recordingsDir = join(root, 'recordings')
    await writeRecording(recordingsDir, 'session-a', sampleRecording())

    const result = await writeBrowserSkillFromRecording({
      recordingsDir,
      skillsDir: join(root, 'skills'),
      writeTextFile: async () => {
        throw new Error('EACCES: permission denied')
      }
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('EACCES')
    expect(result.name).toBe('')
  })

  it('drops the rows it cannot read and says how many', () => {
    const parsed = parseBrowserRecordingDocument(
      JSON.stringify({
        schema: ABACO_BROWSER_RECORDING_SCHEMA,
        session_id: 's',
        actions: [
          { timestamp: 't1', url: 'https://a.test/', action_type: 'click', selector: '#a' },
          { timestamp: 't2', url: 'https://a.test/', action_type: 'exfiltrate' },
          null
        ]
      }),
      { path: '/tmp/s.json' }
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.malformedActions).toBe(2)
    expect(parsed.document.actions).toHaveLength(1)
  })
})

/* ──────────────────────────────────────────────────────────────────────────────
 * The far end: the Harness discovers what F3 wrote
 * ────────────────────────────────────────────────────────────────────────────── */

describe('ABACO browser skill discovery (F3)', () => {
  it('is found and parsed by the real filesystem skill provider', async () => {
    const root = await tempRoot()
    const dshHome = join(root, 'harness')
    const recordingsDir = join(root, 'recordings')
    await writeRecording(recordingsDir, 'session-a', sampleRecording())

    const saved = await writeBrowserSkillFromRecording({
      recordingsDir,
      skillsDir: abacoBrowserSkillsDir(dshHome),
      requestedName: 'descargar facturas'
    })
    expect(saved.ok).toBe(true)

    // The real provider, over the real directory, with the watch disabled: this
    // is the parser that decides whether a skill exists at all, so using it here
    // is the difference between "the frontmatter looks right" and "the Harness
    // will see this skill".
    const controller = new AbortController()
    const provider = new FileSystemSkillProvider(
      {
        get: () => undefined,
        logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
        effect: () => {},
        on: () => {},
        skills: { registerProvider: () => {} }
      } as never,
      { invalidate: () => {}, signal: controller.signal } as never,
      {
        dshHome,
        agentsHome: join(root, 'agents'),
        includeDefaultRoots: true,
        watch: false,
        customSkillDirs: []
      }
    )

    try {
      const listed = await provider.list({ cwd: undefined })
      const candidates = Array.isArray(listed) ? listed : listed.candidates
      const mine = candidates.find((candidate) => candidate.name === 'descargar-facturas')
      expect(mine).toBeDefined()
      if (!mine) return
      expect(mine.source).toBe('user-dsh')
      expect(mine.path).toBe(saved.path)

      const skill = await provider.get(mine, { signal: controller.signal })
      expect(skill?.name).toBe('descargar-facturas')
      expect(skill?.description).toContain('panel.example.com')
      expect(skill?.whenToUse).toContain('panel.example.com')
      expect(skill?.content).toContain('## Pasos')
      expect(skill?.content).toContain('`abaco_browser_navigate`')
      expect(skill?.invocation.modelInvocable).toBe(true)
      expect(skill?.invocation.userInvocable).toBe(true)
    } finally {
      controller.abort()
      await provider.dispose()
    }
  })
})

/* ──────────────────────────────────────────────────────────────────────────────
 * The seam: channel, handler, bridge, strip
 * ────────────────────────────────────────────────────────────────────────────── */

describe('ABACO browser skill contract (F3)', () => {
  it('publishes the channel and registers the handler behind the trusted guard', async () => {
    expect(abacoBrowserChannels.saveSkill).toBe('abaco:browser:save-skill')
    const main = await readFile('src/main/index.ts', 'utf8')
    expect(main).toContain('ipcMain.handle(abacoBrowserChannels.saveSkill,')
    expect(main).toContain('assertTrustedAbacoBrowserEvent(event)')
    expect(main).toContain('readAbacoSaveSkillRequest(request)')
    // The skill root is resolved from `$DSH_HOME`, with the value the shell
    // injects into the Harness child as the fallback.
    expect(main).toContain('resolveAbacoDshHome(process.env,')
    expect(main).toContain('abacoBrowserSkillsDir(abacoBrowserDshHome())')
    // Recording is user-only; so is minting a skill.
    const rpc = await readFile('src/main/abaco-browser-rpc.ts', 'utf8')
    expect(rpc).not.toContain('saveSkill')
    expect(rpc).not.toContain('save-skill')
  })

  it('exposes the skill bridge to the Harness page', async () => {
    const preload = await readFile('src/preload/index.ts', 'utf8')
    expect(preload).toContain('saveSkill:')
    expect(preload).toContain('abacoBrowserChannels.saveSkill')
    expect(preload).toContain('AbacoBrowserSaveSkillResult')
  })

  it('ships the strip control and wires it to the save channel', async () => {
    const html = await readFile('build/abaco-browser-chrome.html', 'utf8')
    const preload = await readFile('src/preload/abaco-browser-chrome.ts', 'utf8')

    // The control exists, is hidden until a recording does, and is a form so the
    // name can be typed somewhere (`prompt()` does not exist in Electron).
    expect(html).toContain('id="abaco-browser-skill-form"')
    expect(html).toContain('id="abaco-browser-skill-name"')
    expect(html).toContain('id="abaco-browser-skill-save"')
    expect(html).toContain('id="abaco-browser-skill-status"')
    expect(html).toContain('id="abaco-browser-skill-form" hidden')
    // Still an inert document: styles only, no script of its own.
    expect(html).not.toContain('<script')
    expect(html).toContain("body[data-platform='darwin'] .skillForm")

    expect(preload).toContain('abacoBrowserChannels.saveSkill')
    expect(preload).toContain('paintSkill(next.hasRecording)')
    expect(preload).toContain('lastRecordingId = next.lastRecordingId')
    expect(preload).toContain("skillForm.hidden = !available")
    expect(preload).toContain('skillForm.addEventListener(\'submit\'')
    // The strip reports the outcome in place: the path on success, the writer's
    // own sentence on failure.
    expect(preload).toContain('skillStatus.textContent = message')
  })

  it('tells the strip whether a finished recording exists', async () => {
    const controller = await readFile('src/main/abaco-browser-controller.ts', 'utf8')
    expect(controller).toContain('hasRecording: !status.recording && status.lastRecordingPath.length > 0')
    expect(controller).toContain('lastRecordingId: status.recording ? \'\' : status.sessionId')
  })
})
