import { describe, expect, it } from 'vitest'
import { canGrantWindowPermission, isTrustedAppUrl } from '../src/main/security-policy'

const HARNESS = 'http://127.0.0.1:43127/session'
const HARNESS_LOCALHOST = 'http://localhost:43127/session'

describe('security-policy trust boundary', () => {
  it('only trusts the launcher and loopback HTTP pages', () => {
    expect(isTrustedAppUrl('file:///app/index.html')).toBe(true)
    expect(isTrustedAppUrl('http://127.0.0.1:43127')).toBe(true)
    expect(isTrustedAppUrl('http://localhost:43127')).toBe(true)
    expect(isTrustedAppUrl('https://127.0.0.1:43127')).toBe(false)
    expect(isTrustedAppUrl('http://example.com')).toBe(false)
    expect(isTrustedAppUrl('javascript:alert(1)')).toBe(false)
  })
})

describe('security-policy window permissions', () => {
  it('grants clipboard writes from the harness main frame only', () => {
    expect(canGrantWindowPermission('clipboard-sanitized-write', HARNESS, true)).toBe(true)
    expect(canGrantWindowPermission('clipboard-sanitized-write', HARNESS_LOCALHOST, true)).toBe(true)
    expect(canGrantWindowPermission('clipboard-sanitized-write', 'file:///tmp/app.html', true)).toBe(false)
  })

  it('grants media (mic + camera) on trusted/harness main-frame', () => {
    // P0: without this, setPermissionRequestHandler denied getUserMedia.
    expect(canGrantWindowPermission('media', HARNESS, true)).toBe(true)
    expect(canGrantWindowPermission('media', HARNESS_LOCALHOST, true)).toBe(true)
    expect(canGrantWindowPermission('media', 'file:///app/index.html', true)).toBe(true)
    expect(canGrantWindowPermission('media', 'dsh-recovery://boot', true)).toBe(true)
  })

  it('still denies media from untrusted or nested frames', () => {
    expect(canGrantWindowPermission('media', HARNESS, false)).toBe(false)
    expect(canGrantWindowPermission('media', 'https://example.com/session', true)).toBe(false)
    expect(canGrantWindowPermission('media', undefined, true)).toBe(false)
  })

  it('does not open the rest of the permission surface', () => {
    expect(canGrantWindowPermission('clipboard-read', HARNESS, true)).toBe(false)
    expect(canGrantWindowPermission('geolocation', HARNESS, true)).toBe(false)
    expect(canGrantWindowPermission('notifications', HARNESS, true)).toBe(false)
    expect(canGrantWindowPermission('display-capture', HARNESS, true)).toBe(false)
    expect(canGrantWindowPermission('mediaKeySystem', HARNESS, true)).toBe(false)
  })
})
