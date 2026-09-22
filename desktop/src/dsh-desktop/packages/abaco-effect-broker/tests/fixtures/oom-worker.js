/**
 * Fixture: announce ready, then die the way an OOM killer would (SIGKILL).
 * We do not actually exhaust the CI heap.
 */
process.on('message', () => {})
if (typeof process.send === 'function') process.send({ ok: true, ready: true })
try {
  process.kill(process.pid, 'SIGKILL')
} catch {
  process.exit(137)
}
