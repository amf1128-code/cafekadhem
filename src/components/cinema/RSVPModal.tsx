import { useState, type CSSProperties } from 'react'

export interface CinemaEventLite {
  no: string
  title: string
  short: string
  day: string
  date: string
  time: string
  loc: string
  price: number
  ar: string
}

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '2px solid var(--ck-ink)',
  background: 'transparent',
  fontFamily: 'var(--ck-sans)',
  fontSize: 14,
  outline: 'none',
}

const stepBtn: CSSProperties = {
  width: 36,
  height: 36,
  border: '2px solid var(--ck-ink)',
  background: 'var(--ck-cream)',
  fontSize: 18,
  cursor: 'pointer',
  fontFamily: 'var(--ck-serif)',
}

export function RSVPModal({
  open,
  onClose,
  event,
}: {
  open: boolean
  onClose: () => void
  event: CinemaEventLite | null
}) {
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [count, setCount] = useState(2)

  const handleClose = () => {
    setStep(0)
    onClose()
  }

  if (!open || !event) return null

  const total = (event.price ?? 0) * count
  const titleSingleLine = event.title.replace(/\n/g, ' ')

  const handleReserve = () => {
    // Placeholder: wire to Supabase RSVP / Edge function later.
    // The existing app already has /events/:id/order and ticketing flows;
    // we'll plumb this modal through to those once we decide on the
    // event-id mapping for the cinema landing.
    console.log('cinema-rsvp', { event: event.no, name, email, count, total })
    setStep(1)
  }

  return (
    <div
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(13,13,15,0.85)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--ck-cream)',
          border: '3px solid var(--ck-ink)',
          padding: 28,
          width: 'min(540px, 100%)',
          boxShadow: '8px 8px 0 var(--ck-ink)',
          color: 'var(--ck-ink)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 18,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--ck-mono)',
              fontSize: 11,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
            }}
          >{`TICKET / 0${step + 1}`}</div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            style={{
              border: 'none',
              background: 'transparent',
              fontSize: 26,
              lineHeight: 1,
              cursor: 'pointer',
              color: 'var(--ck-ink)',
            }}
          >
            ×
          </button>
        </div>

        {step === 0 && (
          <>
            <div
              style={{
                fontFamily: 'var(--ck-serif)',
                fontSize: 'clamp(32px, 5vw, 44px)',
                lineHeight: 0.9,
                fontWeight: 900,
                marginBottom: 6,
                whiteSpace: 'pre-line',
              }}
            >
              {titleSingleLine}
            </div>
            <div
              style={{
                fontFamily: 'var(--ck-mono)',
                fontSize: 11,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                marginBottom: 18,
                opacity: 0.75,
              }}
            >
              {event.day} {event.date} · {event.time} · {event.loc}
            </div>
            <label
              style={{
                display: 'block',
                fontFamily: 'var(--ck-mono)',
                fontSize: 10,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                marginBottom: 4,
              }}
            >
              Your name
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ismail Yassin"
              style={inputStyle}
            />
            <label
              style={{
                display: 'block',
                fontFamily: 'var(--ck-mono)',
                fontSize: 10,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                marginTop: 14,
                marginBottom: 4,
              }}
            >
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="hi@cafekadhem.nyc"
              style={inputStyle}
            />
            <label
              style={{
                display: 'block',
                fontFamily: 'var(--ck-mono)',
                fontSize: 10,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                marginTop: 14,
                marginBottom: 4,
              }}
            >
              How many
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                type="button"
                onClick={() => setCount(c => Math.max(1, c - 1))}
                style={stepBtn}
                aria-label="Decrease seats"
              >
                −
              </button>
              <span
                style={{
                  fontFamily: 'var(--ck-serif)',
                  fontSize: 32,
                  fontWeight: 800,
                  minWidth: 30,
                  textAlign: 'center',
                }}
              >
                {count}
              </span>
              <button
                type="button"
                onClick={() => setCount(c => Math.min(8, c + 1))}
                style={stepBtn}
                aria-label="Increase seats"
              >
                +
              </button>
              <span
                style={{
                  marginLeft: 'auto',
                  fontFamily: 'var(--ck-mono)',
                  fontSize: 11,
                  letterSpacing: '0.14em',
                }}
              >
                ${total}.00
              </span>
            </div>
            <button
              type="button"
              onClick={handleReserve}
              disabled={!name.trim() || !email.trim()}
              style={{
                marginTop: 22,
                width: '100%',
                padding: 14,
                border: '2px solid var(--ck-ink)',
                background: 'var(--ck-cobalt)',
                color: 'var(--ck-cream)',
                fontFamily: 'var(--ck-sans)',
                fontWeight: 700,
                fontSize: 12,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                cursor: !name.trim() || !email.trim() ? 'not-allowed' : 'pointer',
                opacity: !name.trim() || !email.trim() ? 0.6 : 1,
              }}
            >
              {event.price > 0 ? `Reserve · $${total}.00` : 'Save my seat'} →
            </button>
          </>
        )}

        {step === 1 && (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <div
              style={{
                fontFamily: 'var(--ck-arabic-display)',
                fontSize: 64,
                color: 'var(--ck-cobalt)',
                direction: 'rtl',
                lineHeight: 1,
              }}
            >
              أهلاً
            </div>
            <div
              style={{
                fontFamily: 'var(--ck-serif)',
                fontSize: 36,
                fontWeight: 900,
                lineHeight: 1,
                marginTop: 8,
              }}
            >
              SEE YOU THERE,
            </div>
            <div
              style={{
                fontFamily: 'var(--ck-serif)',
                fontSize: 36,
                fontWeight: 900,
                lineHeight: 1,
              }}
            >
              {(name || 'HABIBI').toUpperCase()}
            </div>
            <div
              style={{
                fontFamily: 'var(--ck-mono)',
                fontSize: 11,
                margin: '16px 0',
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
              }}
            >
              Confirmation sent to {email || 'your inbox'}
            </div>
            <div
              style={{
                borderTop: '1px dashed var(--ck-ink)',
                paddingTop: 14,
                fontFamily: 'var(--ck-mono)',
                fontSize: 10,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
              }}
            >
              CK-{event.no} · {count} SEAT{count > 1 ? 'S' : ''}
            </div>
            <button
              type="button"
              onClick={handleClose}
              style={{
                marginTop: 18,
                padding: '12px 22px',
                border: '2px solid var(--ck-ink)',
                background: 'var(--ck-cream)',
                color: 'var(--ck-ink)',
                fontFamily: 'var(--ck-sans)',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function InlineRSVP({
  event,
  onOpenFull,
}: {
  event: CinemaEventLite
  onOpenFull: () => void
}) {
  const [count, setCount] = useState(2)
  const [email, setEmail] = useState('')
  const total = event.price * count
  const stepStyle: CSSProperties = {
    width: 32,
    height: 32,
    border: '2px solid var(--ck-ink)',
    background: 'var(--ck-cream)',
    fontSize: 16,
    cursor: 'pointer',
    fontFamily: 'var(--ck-serif)',
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            fontFamily: 'var(--ck-mono)',
            fontSize: 10,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
          }}
        >
          Seats
        </span>
        <button
          type="button"
          onClick={() => setCount(c => Math.max(1, c - 1))}
          style={stepStyle}
          aria-label="Decrease seats"
        >
          −
        </button>
        <span
          style={{
            fontFamily: 'var(--ck-serif)',
            fontSize: 22,
            fontWeight: 800,
            minWidth: 24,
            textAlign: 'center',
          }}
        >
          {count}
        </span>
        <button
          type="button"
          onClick={() => setCount(c => Math.min(8, c + 1))}
          style={stepStyle}
          aria-label="Increase seats"
        >
          +
        </button>
        <span
          style={{
            marginLeft: 'auto',
            fontFamily: 'var(--ck-serif)',
            fontSize: 22,
            fontWeight: 800,
          }}
        >
          ${total}
        </span>
      </div>
      <input
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="hi@cafekadhem.nyc"
        style={{
          padding: '10px 12px',
          border: '2px solid var(--ck-ink)',
          background: 'transparent',
          fontFamily: 'var(--ck-sans)',
          fontSize: 13,
          outline: 'none',
          color: 'var(--ck-ink)',
        }}
      />
      <button
        type="button"
        onClick={onOpenFull}
        style={{
          width: '100%',
          padding: '14px 22px',
          border: '2px solid var(--ck-ink)',
          background: 'var(--ck-cobalt)',
          color: 'var(--ck-cream)',
          fontFamily: 'var(--ck-sans)',
          fontWeight: 700,
          fontSize: 13,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
        }}
      >
        Reserve · ${total} →
      </button>
    </div>
  )
}
