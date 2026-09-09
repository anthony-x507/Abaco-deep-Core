/**
 * Host half for the browser-only ABACO voice plugin.
 *
 * No Node-side state today; the system-TTS bridge lives in the renderer so
 * the same code path works on every desktop platform without re-implementing
 * per-OS voice routing. A future macOS-only `say` bridge can be added here
 * without touching the client contract.
 */
export function apply() {}