import { useEffect, useState } from 'react'
import QRCodeLib from 'qrcode'

interface QRCodeProps {
  value: string
  size?: number
  className?: string
}

export function QRCode({ value, size = 280, className = '' }: QRCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    QRCodeLib.toDataURL(value, {
      width: size * 2,
      margin: 1,
      color: { dark: '#1a2e1f', light: '#fdfaf3' },
      errorCorrectionLevel: 'M',
    })
      .then(url => {
        if (!cancelled) setDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [value, size])

  if (!dataUrl) {
    return (
      <div
        className={`bg-warm/30 animate-pulse ${className}`}
        style={{ width: size, height: size }}
      />
    )
  }

  return (
    <img
      src={dataUrl}
      alt="Ticket QR code"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size }}
    />
  )
}
