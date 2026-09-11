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
  // Keep the permission surface tight: only the harness main-frame may write
  // the sanitized clipboard, and only trusted app / harness main-frame may use
  // getUserMedia (`media` = microphone + camera) for STT / photos.
  if (!isMainFrame || requestingUrl === undefined) return false
  if (permission === 'clipboard-sanitized-write') {
    return isHarnessUrl(requestingUrl)
  }
  if (permission === 'media') {
    return isTrustedAppUrl(requestingUrl)
  }
  return false
}
