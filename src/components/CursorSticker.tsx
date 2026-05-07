import { useEffect, useRef, useState } from 'react'

// Arabic phrases that cycle on click. Order matters — designer-approved
// sequence starting from the default greeting.
//   صحتين  — sahteen ("to your health")  [default]
//   بالهنا  — bil hana ("with pleasure")
//   اتفضل  — itfaddal ("help yourself")
//   يلا    — yalla ("let's go")
//   طازة   — taza ("fresh")
//   حبيبي  — habibi ("my dear")
const PHRASES = ['صحتين', 'بالهنا', 'اتفضل', 'يلا', 'طازة', 'حبيبي'] as const

const INTERACTIVE_SELECTOR =
  'input, textarea, select, button, a, [role="button"], [contenteditable="true"]'

/**
 * Small orange Arabic pill that follows the cursor on the landing page.
 * Click anywhere to cycle to the next phrase. Hidden on touch devices,
 * over interactive elements, and while a modal is open.
 *
 * Uses a ref + requestAnimationFrame to write `transform` directly to the
 * DOM so mousemove never triggers a React re-render — keeps the animation
 * silky on slow CPUs.
 */
export function CursorSticker() {
  const elRef = useRef<HTMLDivElement | null>(null)
  const pos = useRef({ x: 0, y: 0 })
  const raf = useRef(0)
  const [phraseIdx, setPhraseIdx] = useState(0)
  const [visible, setVisible] = useState(false)
  // Resolved once on the client. Touch devices (no hover) get nothing.
  // matchMedia is guarded so the lazy initializer is safe even if this
  // ever ends up running during SSR.
  const [enabled] = useState(() => {
    if (typeof window === 'undefined') return false
    return !window.matchMedia('(pointer: coarse)').matches
  })

  useEffect(() => {
    if (!enabled) return

    const apply = () => {
      raf.current = 0
      const el = elRef.current
      if (!el) return
      el.style.transform = `translate(${pos.current.x + 20}px, ${pos.current.y - 30}px) rotate(-12deg)`
    }

    const isInteractive = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false
      return target.closest(INTERACTIVE_SELECTOR) !== null
    }

    const isModalOpen = (): boolean =>
      document.querySelector('[role="dialog"][aria-modal="true"]') !== null

    const onMove = (e: MouseEvent) => {
      if (isModalOpen() || isInteractive(e.target)) {
        setVisible(false)
        return
      }
      pos.current = { x: e.clientX, y: e.clientY }
      setVisible(true)
      if (!raf.current) raf.current = requestAnimationFrame(apply)
    }

    const onLeave = () => setVisible(false)

    const onClick = (e: MouseEvent) => {
      if (isModalOpen() || isInteractive(e.target)) return
      setPhraseIdx(i => (i + 1) % PHRASES.length)
    }

    window.addEventListener('mousemove', onMove, { passive: true })
    document.addEventListener('mouseleave', onLeave)
    window.addEventListener('click', onClick)

    return () => {
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
      window.removeEventListener('click', onClick)
      if (raf.current) {
        cancelAnimationFrame(raf.current)
        raf.current = 0
      }
    }
  }, [enabled])

  if (!enabled) return null

  return (
    <div
      ref={elRef}
      aria-hidden="true"
      className={`ck-cursor-sticker${visible ? '' : ' ck-cursor-sticker--hidden'}`}
    >
      {PHRASES[phraseIdx]}
    </div>
  )
}
