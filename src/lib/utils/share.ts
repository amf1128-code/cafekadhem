/**
 * Share a URL using the Web Share API with clipboard fallback.
 * Returns true if shared/copied successfully.
 */
export async function shareLink(url: string, title: string, text?: string): Promise<boolean> {
  // Try Web Share API first (mobile)
  if (navigator.share) {
    try {
      await navigator.share({ title, text: text || title, url })
      return true
    } catch (err) {
      // User cancelled or API failed — fall through to clipboard
      if ((err as DOMException).name === 'AbortError') {
        return false
      }
    }
  }

  // Clipboard fallback
  try {
    await navigator.clipboard.writeText(url)
    return true
  } catch {
    // Final fallback: legacy execCommand
    const textarea = document.createElement('textarea')
    textarea.value = url
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const success = document.execCommand('copy')
    document.body.removeChild(textarea)
    return success
  }
}
