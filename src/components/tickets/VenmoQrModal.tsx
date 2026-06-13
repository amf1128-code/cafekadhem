import { Modal } from '../ui/Modal'
import { QRCode } from './QRCode'
import { venmoProfileUrl } from '../../lib/utils/door'
import { formatUsd } from '../../lib/utils/money'

interface VenmoQrModalProps {
  open: boolean
  onClose: () => void
  venmoHandle: string
  // Uploaded Venmo QR image (admin_settings.venmo_qr_url). Preferred over
  // the generated fallback because it's the official, reliably-scannable
  // code from the Venmo app.
  qrImageUrl?: string | null
  amount?: number | null
  // Optional: who you're collecting from, shown as a heading.
  guestName?: string
}

// Full-screen-ish Venmo code for collecting payment at the door. Shows the
// uploaded QR image when present, otherwise generates one from the Venmo
// profile URL so the door is never stuck without something to scan.
export function VenmoQrModal({
  open,
  onClose,
  venmoHandle,
  qrImageUrl,
  amount,
  guestName,
}: VenmoQrModalProps) {
  const handle = venmoHandle.trim().replace(/^@/, '')
  return (
    <Modal open={open} onClose={onClose} title="Pay with Venmo">
      <div className="text-center">
        {guestName && (
          <p className="text-sm text-ink/70 mb-1">
            Collecting from <span className="font-medium">{guestName}</span>
          </p>
        )}
        {amount != null && amount > 0 && (
          <p className="font-serif text-3xl text-forest-dark mb-3">{formatUsd(amount)}</p>
        )}

        {!handle ? (
          <p className="text-red-700 py-8">
            No Venmo handle set. Add one in Settings.
          </p>
        ) : qrImageUrl ? (
          <img
            src={qrImageUrl}
            alt="Venmo QR code"
            className="mx-auto rounded-lg max-w-[280px] w-full"
          />
        ) : (
          <div className="flex flex-col items-center">
            <QRCode value={venmoProfileUrl(handle)} size={260} className="rounded-lg" />
            <p className="text-xs text-ink/50 mt-2">
              Generated from the Venmo profile. Upload your own QR in Settings for
              a more reliable scan.
            </p>
          </div>
        )}

        {handle && (
          <p className="mt-4 text-ink/70">
            or pay <span className="font-medium">@{handle}</span> on Venmo
          </p>
        )}
      </div>
    </Modal>
  )
}
