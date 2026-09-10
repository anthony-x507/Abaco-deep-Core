/**
 * Host half for the browser-only ABACO browser-launcher plugin.
 *
 * The integrated browser lives entirely in the desktop shell: `src/main/
 * abaco-browser-controller.ts` owns the overlay `WebContentsView` and
 * `src/preload/index.ts` exposes `window.dshAbacoBrowser` to the Harness page.
 * The plugin only contributes the launcher affordance in the sidebar footer, so
 * this half is inert — it deliberately neither reads nor assigns anything on
 * `ctx`, exactly like abaco-agent-status and abaco-voice.
 */
export function apply() {}
