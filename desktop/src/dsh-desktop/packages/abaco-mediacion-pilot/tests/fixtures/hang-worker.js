/**
 * Fixture: announces ready then never replies (timeout path).
 */
process.on('message', () => {
  /* swallow — never answer */
})
process.send && process.send({ ok: true, ready: true })
setInterval(() => {}, 1 << 30)
