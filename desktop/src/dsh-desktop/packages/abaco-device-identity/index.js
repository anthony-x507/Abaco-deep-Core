/**
 * Host half: ensures the device identity exists and is stored in the
 * macOS Keychain (via @deepseek-ai/dsh-secure-store) on first launch.
 *
 * If the user hasn't picked a display name yet, we generate one from the
 * hostname (e.g. "MacBook Pro de Anthony") which the user can edit.
 */
import { randomUUID } from 'node:crypto'
import { hostname, userInfo } from 'node:os'

const DEVICE_KEY = 'abaco-device-identity:v1'

async function readSecureStore(ctx) {
  const store = ctx.get?.('secureStore') || ctx['secureStore']
  if (store?.get && store?.set) return store
  return null
}

export async function apply(ctx) {
  const store = await readSecureStore(ctx)
  if (!store) {
    // No secure store available — fall back to local file in userData
    // (still safer than nothing; abaco-cloud-sync will treat as Tier 3).
    console.warn('[abaco-device-identity] secureStore unavailable; using ephemeral identity')
  }

  let identity = store ? JSON.parse((await store.get(DEVICE_KEY)) || 'null') : null
  if (!identity) {
    identity = {
      id: randomUUID(),
      displayName: guessDisplayName(),
      createdAt: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      hostname: hostname(),
      osUser: userInfo().username,
    }
    if (store) await store.set(DEVICE_KEY, JSON.stringify(identity))
    else {
      const { writeFile, mkdir } = await import('node:fs/promises')
      const { join } = await import('node:path')
      const dir = process.env.ABACO_DATA_DIR || `${process.env.HOME}/.abaco-deep-harnes`
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'device-identity.json'), JSON.stringify(identity, null, 2))
    }
  }

  ctx.abacoDevice = identity
}

function guessDisplayName() {
  const h = hostname()
  const friendly = h
    .replace(/\.local$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
  return friendly || 'Mi Mac'
}