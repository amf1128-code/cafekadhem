export function Footer() {
  return (
    <footer className="bg-cream mt-auto">
      <div className="max-w-3xl mx-auto px-6 py-12 text-center">
        <p className="font-arabic text-3xl text-forest mb-3">
          &#1603;&#1575;&#1601;&#1610;&#1607; &#1603;&#1575;&#1592;&#1605;
        </p>
        <p className="text-xs tracking-[0.2em] uppercase text-ink-muted mb-5">
          A little sweet, a little home
        </p>
        <a
          href="https://instagram.com/cafekadhem"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-forest transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="5" />
            <circle cx="12" cy="12" r="5" />
            <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
          </svg>
          @cafekadhem
        </a>
      </div>
    </footer>
  )
}
