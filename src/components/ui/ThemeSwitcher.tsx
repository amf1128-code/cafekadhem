import { useTheme, type ThemeId } from '../../lib/theme/ThemeContext'

export function ThemeSwitcher() {
  const { theme, setTheme, themes } = useTheme()

  return (
    <div
      role="group"
      aria-label="Theme"
      className="inline-flex items-center border border-warm rounded-full overflow-hidden"
    >
      {themes.map((t, i) => {
        const active = t.id === theme
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setTheme(t.id as ThemeId)}
            aria-pressed={active}
            title={`${t.name} — ${t.tagline}`}
            className={[
              'px-2.5 py-1 text-[10px] tracking-[0.2em] uppercase transition-colors',
              i > 0 ? 'border-l border-warm' : '',
              active
                ? 'bg-forest text-cream'
                : 'text-ink-muted hover:text-forest',
            ].join(' ')}
          >
            {t.name}
          </button>
        )
      })}
    </div>
  )
}
