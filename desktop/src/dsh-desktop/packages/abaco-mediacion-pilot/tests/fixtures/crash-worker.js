/**
 * Fixture: dies immediately after announcing ready.
 * Used to prove the Janice host survives worker death.
 */
process.on('message', () => {})
process.send && process.send({ ok: true, ready: true })
process.exit(9)
