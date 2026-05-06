import { useState } from 'react'

type Props = {
  url: string
  title: string
  text: string
  label?: string
  className?: string
}

/**
 * Cross-platform share affordance. On mobile (where navigator.share
 * is supported), opens the OS share sheet. On desktop, copies the URL
 * to the clipboard with a brief "Link copied" confirmation; falls back
 * to mailto if clipboard isn't available.
 *
 * URL is consumed verbatim — caller is responsible for adding ?ref=
 * attribution (or omitting it). The URL must NEVER carry an ?as=
 * ambient token (those are personal recognition tokens, never shared).
 *
 * USER_FLOWS_SPEC.md §3a.8.
 */
export function ShareButton({
  url,
  title,
  text,
  label = 'Share',
  className = '',
}: Props) {
  const [copied, setCopied] = useState(false)

  async function onClick() {
    const canNativeShare =
      typeof navigator !== 'undefined' && typeof navigator.share === 'function'

    if (canNativeShare) {
      try {
        await navigator.share({ title, text, url })
        return
      } catch {
        // user canceled — no-op
        return
      }
    }

    // Desktop fallback: clipboard
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      return
    } catch {
      // last resort: mailto
      window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${text}\n\n${url}`)}`
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={
        className ||
        'border border-warm px-5 py-2 text-xs tracking-[0.2em] uppercase text-ink-muted hover:border-ink hover:text-ink transition-colors'
      }
    >
      {copied ? '[ Link copied ]' : `[ ${label} ]`}
    </button>
  )
}
