import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'node:path'

// electron-vite 5.0.0's isolated-entries reporter (`vite:isolate-entries`, used
// below) calls `process.stdout.clearLine`/`cursorTo`/`moveCursor` without
// checking for a TTY. Those three exist only when stdout is a terminal, so with
// stdout piped — which is how CI runs the release build — the preload build
// aborts with "process.stdout.moveCursor is not a function" (exit 1, no preload
// emitted). Supplying the missing no-ops is enough, and on a real terminal
// nothing here is replaced. `test/preload-sandbox-isolation.test.ts` runs the
// build with stdout piped, so a regression fails the suite instead of only CI.
for (const method of ['clearLine', 'cursorTo', 'moveCursor'] as const) {
  const stream = process.stdout as unknown as Record<string, unknown>
  if (typeof stream[method] !== 'function') stream[method] = () => true
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    // Keeps the isolated-entries per-module progress line out of piped logs;
    // it is the same level electron-vite already uses for its nested builds.
    // Errors and warnings still get through.
    logLevel: 'warn',
    build: {
      // The main window and the browser chrome both run their preload with
      // `sandbox: true`, where Electron replaces `require` with a resolver that
      // knows only `electron` and a handful of Node builtins — see
      // `test/preload-sandbox-isolation.test.ts` for the measured list. A
      // relative specifier throws `module not found`, and because the preload
      // body runs as a single function that throw aborts everything after it, so
      // the `contextBridge.exposeInMainWorld` calls never run and the window
      // comes up with no bridges at all (the folder picker then reports
      // "DSH Desktop directory picker bridge is unavailable").
      //
      // With the default multi-entry build, Rollup pulls any module two entries
      // import — `../shared/abaco-browser`, shared by `index` and
      // `abaco-browser-chrome` — into `out/preload/chunks/*.cjs` and starts each
      // entry with `require("./chunks/<name>.cjs")`, which is exactly that fatal
      // relative require. `output.inlineDynamicImports` cannot fix it: Rollup
      // rejects that option for multi-entry builds. `isolatedEntries` builds
      // each entry in its own single-entry pass instead, so every dependency is
      // inlined and no relative require can be emitted, no matter which module
      // the entries come to share next.
      isolatedEntries: true,
      // `isolatedEntries` only inlines what the module graph reaches; anything
      // left external would survive as a bare `require("<package>")`, which the
      // sandboxed resolver also rejects. Nothing in the preload graph imports a
      // package today, and this keeps that true if something starts to.
      // `electron` and the Node builtins stay external regardless — the preload
      // preset pins them — so the one allowed require survives.
      externalizeDeps: false,
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          'windows-menu': resolve('src/preload/windows-menu.ts'),
          'abaco-browser-chrome': resolve('src/preload/abaco-browser-chrome.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  }
})
