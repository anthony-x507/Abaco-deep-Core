/**
 * Fixture: echoes the IPC envelope so tests can assert {op,args,grantId}.
 */
process.on('message', (msg) => {
  process.send && process.send({
    id: msg && msg.id,
    ok: true,
    echo: msg,
    keys: msg && typeof msg === 'object' ? Object.keys(msg).sort() : [],
  })
})
process.send && process.send({ ok: true, ready: true })
