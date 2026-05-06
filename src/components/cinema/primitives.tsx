export function RegMark({ size = 18, color = 'var(--ck-ink)' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'inline-block' }}>
      <circle cx="12" cy="12" r="10" fill="none" stroke={color} strokeWidth="1.5" />
      <line x1="12" y1="0" x2="12" y2="24" stroke={color} strokeWidth="1.5" />
      <line x1="0" y1="12" x2="24" y2="12" stroke={color} strokeWidth="1.5" />
    </svg>
  )
}

export function KadhemLockup({
  size = 1,
  color = 'currentColor',
  stacked = true,
}: {
  size?: number
  color?: string
  stacked?: boolean
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: stacked ? 'column' : 'row',
        alignItems: 'center',
        gap: 6 * size,
        color,
        lineHeight: 1,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--ck-arabic-display)',
          fontSize: 36 * size,
          direction: 'rtl',
          letterSpacing: '0.02em',
        }}
      >
        كافيه كاظم
      </div>
      <div
        style={{
          fontFamily: 'var(--ck-serif)',
          fontWeight: 800,
          fontSize: 22 * size,
          letterSpacing: '0.18em',
        }}
      >
        CAFE KADHEM
      </div>
    </div>
  )
}

export function Marquee({
  items,
  speed = 38,
  sep = '✦',
  invert = false,
}: {
  items: string[]
  speed?: number
  sep?: string
  invert?: boolean
}) {
  const text = items.join(`   ${sep}   `)
  return (
    <div
      style={{
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        borderTop: '2px solid var(--ck-ink)',
        borderBottom: '2px solid var(--ck-ink)',
        background: invert ? 'var(--ck-ink)' : 'var(--ck-cream)',
        color: invert ? 'var(--ck-cream)' : 'var(--ck-ink)',
      }}
    >
      <div
        style={{
          display: 'inline-block',
          animation: `ck-marquee ${speed}s linear infinite`,
          padding: '14px 0',
        }}
      >
        <span
          style={{
            paddingRight: 56,
            fontFamily: 'var(--ck-serif-edit)',
            fontStyle: 'italic',
            fontSize: 24,
          }}
        >
          {text}   {sep}   {text}   {sep}&nbsp;
        </span>
      </div>
    </div>
  )
}

