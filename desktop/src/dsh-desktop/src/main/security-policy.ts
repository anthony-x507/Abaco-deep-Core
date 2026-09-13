function isHarnessUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return (
      url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
    )
  } catch {
    return false
  }
}

export function isTrustedAppUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol === 'file:' || parsed.protocol === 'dsh-recovery:') return true
  } catch {
    return false
  }
  return isHarnessUrl(rawUrl)
}

export function canGrantWindowPermission(
  permission: string,
  requestingUrl: string | undefined,
  isMainFrame: boolean
): boolean {
  // Tight allowlist: clipboard write stays harness-only; `media` (mic + camera)
  // only for trusted app / harness main-frame (STT, photos, browser record).
  if (!isMainFrame || requestingUrl === undefined) return false
  if (permission === 'clipboard-sanitized-write') {
    return isHarnessUrl(requestingUrl)
  }
  if (permission === 'media') {
    return isTrustedAppUrl(requestingUrl)
  }
  return false
}
