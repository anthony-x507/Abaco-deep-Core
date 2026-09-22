import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = path.resolve(import.meta.dirname, '..')

function pngSize(buffer: Buffer): { width: number; height: number } {
  if (buffer.subarray(0, 8).toString('binary') !== '\u0089PNG\r\n\u001a\n') {
    throw new Error('not a PNG')
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

describe('ABACO HARNESS official logo pack', () => {
  it('keeps the official 1536×1024 RGBA source and a 1024 dock face', async () => {
    const [official, dock, composer] = await Promise.all([
      readFile(path.join(projectRoot, 'build', 'abaco-brand', 'abaco-logo-new.png')),
      readFile(path.join(projectRoot, 'build', 'app-icon.png')),
      readFile(path.join(projectRoot, 'scripts', 'compose-abaco-icons.py'), 'utf8')
    ])
    expect(pngSize(official)).toEqual({ width: 1536, height: 1024 })
    expect(pngSize(dock)).toEqual({ width: 1024, height: 1024 })
    expect(composer).toContain('SAFE_MARGIN = 0.12')
    expect(composer).toContain('CANVAS = 1024')
    expect(composer).toContain('abaco-logo-new.png')
    expect(composer).toContain('full photo/logo')
  })
})
