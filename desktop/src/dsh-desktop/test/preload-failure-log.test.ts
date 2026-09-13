import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  SANDBOX_PRELOAD_SOURCE_ID,
  classifyConsoleMessage,
  describePreloadFailure,
  isPreloadFailureMessage,
  type ConsoleMessageDetails
} from '../src/main/preload-failure'

/**
 * The `console-message` shapes below are not invented: they are what Electron
 * 43.4.0 delivered for a sandboxed preload that throws while loading, captured
 * by loading a broken preload into a hidden BrowserWindow:
 *
 * ```
 * [BUG]     CONSOLE level=error sourceId=node:electron/js2c/sandbox_bundle
 *           message=Unable to load preload script: /private/tmp/.../preload-bug.cjs
 * [BUG]     CONSOLE level=error sourceId=node:electron/js2c/sandbox_bundle
 *           message=Error: module not found: ./probe-chunk.cjs
 * [BUG]     PRELOAD_ERROR path=preload-bug.cjs message=module not found: ./probe-chunk.cjs
 * [BUG]     EXEC typeof window.probeBridge -> undefined
 * [CONTROL] EXEC typeof window.probeBridge -> object
 * [BUG]     CONSOLE level=warning sourceId=node:electron/js2c/sandbox_bundle
 *           message=%cElectron Security Warning (Insecure Content-Security-Policy) ...
 * ```
 */
const MEASURED_PRELOAD_NOTICE: ConsoleMessageDetails = {
  level: 'error',
  sourceId: SANDBOX_PRELOAD_SOURCE_ID,
  message: "Unable to load preload script: /private/tmp/preload-probe/preload-bug.cjs"
}

const MEASURED_PRELOAD_THROW: ConsoleMessageDetails = {
  level: 'error',
  sourceId: SANDBOX_PRELOAD_SOURCE_ID,
  message: 'Error: module not found: ./probe-chunk.cjs'
}

/** Measured too: a healthy sandboxed preload reports this from the same source. */
const MEASURED_SECURITY_WARNING: ConsoleMessageDetails = {
  level: 'warning',
  sourceId: SANDBOX_PRELOAD_SOURCE_ID,
  message: '%cElectron Security Warning (Insecure Content-Security-Policy) font-weight: bold'
}

describe('classifying console-message from the main window', () => {
  it('claims a preload failure even though its source is not the harness page', () => {
    // This is the case that was silently dropped: a preload error carries the
    // sandbox bundle as its source, so the `http://127.0.0.1:` filter rejected
    // the one error that explained why every bridge in the window was missing.
    expect(classifyConsoleMessage(MEASURED_PRELOAD_NOTICE, 'http://127.0.0.1:51234/')).toBe(
      'preload-failure'
    )
    expect(classifyConsoleMessage(MEASURED_PRELOAD_THROW, 'http://127.0.0.1:51234/')).toBe(
      'preload-failure'
    )
  })

  it('claims a preload failure that names itself in a message from elsewhere', () => {
    // Electron's own wording is a second, independent signal, so the notice is
    // still recognised if a future Electron changes where it attributes it.
    expect(
      classifyConsoleMessage(
        {
          level: 'error',
          sourceId: 'file:///Applications/ABACO%20DEEP%20HARNES.app/out/preload/index.cjs',
          message: 'Unable to load preload script: /out/preload/index.cjs'
        },
        'http://127.0.0.1:51234/'
      )
    ).toBe('preload-failure')
  })

  it('leaves a healthy sandboxed preload warning alone', () => {
    // Same `sourceId` as a fatal preload failure — the level is what separates
    // them, so recording warnings here would flood the log on every launch.
    expect(classifyConsoleMessage(MEASURED_SECURITY_WARNING, 'http://127.0.0.1:51234/')).toBe(
      'ignore'
    )
    expect(isPreloadFailureMessage(MEASURED_SECURITY_WARNING)).toBe(false)
  })

  it('keeps sending harness page errors to the renderer plugin log', () => {
    expect(
      classifyConsoleMessage(
        {
          level: 'error',
          sourceId: 'http://127.0.0.1:51234/assets/index.js',
          message: 'TypeError: plugin failed'
        },
        'http://127.0.0.1:51234/'
      )
    ).toBe('renderer-plugin-failure')
  })

  it('still falls back to the window URL when a message carries no source', () => {
    expect(
      classifyConsoleMessage(
        { level: 'error', message: 'Uncaught TypeError' },
        'http://127.0.0.1:51234/'
      )
    ).toBe('renderer-plugin-failure')
  })

  it('does not open the filter to errors from anywhere else', () => {
    // The filter exists to keep unrelated noise out of the plugin recovery
    // evidence. Only preload failures are added to what it accepts.
    expect(
      classifyConsoleMessage(
        { level: 'error', sourceId: 'https://example.com/app.js', message: 'Uncaught TypeError' },
        'http://127.0.0.1:51234/'
      )
    ).toBe('ignore')
    expect(
      classifyConsoleMessage(
        { level: 'error', sourceId: 'devtools://devtools/bundled/x.js', message: 'boom' },
        'http://127.0.0.1:51234/'
      )
    ).toBe('ignore')
    expect(
      classifyConsoleMessage(
        { level: 'error', message: 'Uncaught TypeError' },
        'https://example.com/'
      )
    ).toBe('ignore')
  })

  it('ignores everything below error', () => {
    for (const level of ['info', 'warning', 'debug']) {
      expect(classifyConsoleMessage({ ...MEASURED_PRELOAD_NOTICE, level }, 'http://127.0.0.1:1/')
      ).toBe('ignore')
    }
  })
})

describe('describing a preload failure for the harness log', () => {
  it('names the preload, the error and the consequence', () => {
    const line = describePreloadFailure(
      '/Applications/ABACO DEEP HARNES.app/out/preload/index.cjs',
      { message: 'module not found: ./chunks/abaco-browser-BvKaUG4Y.cjs' }
    )

    expect(line).toContain('/Applications/ABACO DEEP HARNES.app/out/preload/index.cjs')
    expect(line).toContain('module not found: ./chunks/abaco-browser-BvKaUG4Y.cjs')
    expect(line).toContain('contextBridge')
  })

  it('turns the relative-require signature into the fix', () => {
    const line = describePreloadFailure('index.cjs', new Error('module not found: ./chunks/x.cjs'))

    // The whole point of logging this failure is that the next person does not
    // have to rediscover the sandboxed resolver's rules.
    expect(line).toContain('./chunks/x.cjs')
    expect(line).toContain('electron.vite.config.ts')
    expect(line).toContain('"electron"')
  })

  it('does not invent a cause for a preload failure that is not a bad require', () => {
    const line = describePreloadFailure('index.cjs', new Error('Cannot read properties of undefined'))

    expect(line).toContain('Cannot read properties of undefined')
    expect(line).not.toContain('electron.vite.config.ts')
  })

  it('reads a message off whatever shape crossed the process boundary', () => {
    expect(describePreloadFailure('a.cjs', 'plain string')).toContain('plain string')
    expect(describePreloadFailure('a.cjs', { message: 'object with a message' })).toContain(
      'object with a message'
    )
    expect(describePreloadFailure('a.cjs', { code: 'ENOENT' })).toContain('ENOENT')
  })
})

describe('wiring the preload failure evidence into the app', () => {
  it('listens for preload-error on the main window and the two child views', async () => {
    const main = await readFile('src/main/index.ts', 'utf8')
    const controller = await readFile('src/main/abaco-browser-controller.ts', 'utf8')

    expect(main).toContain("webContents.on('preload-error'")
    expect(controller).toContain("webContents.on('preload-error'")
  })

  it('routes every preload-error report into appendPreloadFailureLog', async () => {
    const main = await readFile('src/main/index.ts', 'utf8')

    const listenerCount = main.match(/on\('preload-error'/g)?.length ?? 0
    const reportCount = main.match(/appendPreloadFailureLog\(preloadPath, error\)/g)?.length ?? 0
    expect(listenerCount).toBeGreaterThan(0)
    expect(reportCount).toBe(listenerCount)
    // The browser strip lives in the controller, whose view is built there.
    expect(main).toContain('onPreloadError: appendPreloadFailureLog')
  })

  it('persists the line to the harness log and also puts it on stderr', async () => {
    const main = await readFile('src/main/index.ts', 'utf8')
    const body = /function appendPreloadFailureLog\([\s\S]*?\n}/.exec(main)?.[0]

    expect(body).toBeDefined()
    expect(body).toContain('console.error(')
    expect(body).toContain("appendFileSync(join(app.getPath('logs'), 'harness.log')")
    // A window that reloads in a loop must not flood the log.
    expect(body).toContain('lastPreloadFailureLine')
  })

  it('sends console-message through the classifier instead of an inline filter', async () => {
    const main = await readFile('src/main/index.ts', 'utf8')
    const handler = /webContents\.on\('console-message'[\s\S]*?\n  \}\)/.exec(main)?.[0]

    expect(handler).toBeDefined()
    expect(handler).toContain('classifyConsoleMessage')
    expect(handler).toContain("'preload-failure'")
    expect(handler).toContain('appendPreloadFailureLog')
  })
})
