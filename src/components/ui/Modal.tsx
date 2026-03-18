import { type ReactNode, useEffect } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-cream rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6">
        {title && (
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-serif text-xl text-forest-dark">{title}</h2>
            <button
              onClick={onClose}
              className="text-ink/50 hover:text-ink transition-colors text-2xl leading-none"
              aria-label="Close"
            >
              &times;
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
