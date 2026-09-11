import { describe, expect, it } from 'vitest'
import { apply, classifyDocument, EXTRACT_PATH, name } from '../packages/abaco-documents/index.js'

/**
 * P0 documents contract: photos must classify + extract, and the host route
 * must stop answering 415 for PNG/JPEG/GIF/WEBP.
 */

/** Minimal 1×1 PNG (68 bytes). */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

describe('abaco-documents classifyDocument', () => {
  it('admits images by MIME and by extension', () => {
    expect(classifyDocument('image/png', 'shot.png')).toBe('image')
    expect(classifyDocument('image/jpeg', 'shot.jpg')).toBe('image')
    expect(classifyDocument('application/octet-stream', 'foto.webp')).toBe('image')
    expect(classifyDocument('', 'photo.GIF')).toBe('image')
  })

  it('still classifies documents and rejects unknown binaries', () => {
    expect(classifyDocument('application/pdf', 'a.pdf')).toBe('pdf')
    expect(classifyDocument('text/plain', 'a.txt')).toBe('text')
    expect(classifyDocument('application/octet-stream', 'a.bin')).toBeNull()
    expect(classifyDocument('image/heic', 'a.heic')).toBeNull()
  })
})

describe('abaco-documents extract route (images)', () => {
  it(`registers ${EXTRACT_PATH} and returns base64 text for a tiny PNG`, async () => {
    const registry: Array<{
      path: string
      methods: string[]
      fetch: (request: Request) => Promise<Response>
    }> = []

    apply({
      connection: {
        fetch: {
          register: (entry: (typeof registry)[number]) => {
            registry.push(entry)
          },
        },
      },
    } as never)

    expect(name).toBe('abaco-documents')
    expect(registry).toHaveLength(1)
    expect(registry[0]?.path).toBe(EXTRACT_PATH)

    const request = new Request(
      `http://abaco.local${EXTRACT_PATH}?filename=${encodeURIComponent('dot.png')}`,
      {
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body: TINY_PNG,
      },
    )
    const response = await registry[0]!.fetch(request)
    expect(response.status).toBe(200)
    const payload = await response.json() as {
      ok: boolean
      text: string
      meta: { kind?: string; mediaType?: string; byteLength?: number }
    }
    expect(payload.ok).toBe(true)
    expect(payload.meta.kind).toBe('image')
    expect(payload.meta.mediaType).toBe('image/png')
    expect(payload.meta.byteLength).toBe(TINY_PNG.length)
    expect(payload.text.startsWith('[image image/png; base64]')).toBe(true)
    expect(payload.text).toContain(TINY_PNG.toString('base64'))
  })

  it('rejects unsupported extensions with 415', async () => {
    const registry: Array<{
      path: string
      methods: string[]
      fetch: (request: Request) => Promise<Response>
    }> = []
    apply({
      connection: {
        fetch: {
          register: (entry: (typeof registry)[number]) => {
            registry.push(entry)
          },
        },
      },
    } as never)

    const request = new Request(
      `http://abaco.local${EXTRACT_PATH}?filename=secret.exe`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: Buffer.from('MZ'),
      },
    )
    const response = await registry[0]!.fetch(request)
    expect(response.status).toBe(415)
    const payload = await response.json() as { ok: boolean; error: string }
    expect(payload.ok).toBe(false)
    expect(payload.error).toMatch(/PNG, JPEG, GIF, WEBP/i)
  })
})
