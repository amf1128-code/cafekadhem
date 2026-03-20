import { Link } from 'react-router-dom'

export function Header() {
  return (
    <header className="bg-cream">
      <div className="max-w-3xl mx-auto px-6 py-6 flex items-center justify-between">
        <Link to="/" className="group">
          <span className="font-serif text-xl text-forest-dark">
            Cafe Kadhem
          </span>
        </Link>
        <div className="flex items-center gap-4">
          <a
            href="https://instagram.com/cafekadhem"
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink-muted hover:text-forest transition-colors"
            aria-label="Instagram"
          >
            <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="5" />
              <circle cx="12" cy="12" r="5" />
              <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
            </svg>
          </a>
          <span className="font-arabic text-2xl text-forest">
            &#1603;&#1575;&#1601;&#1610;&#1607; &#1603;&#1575;&#1592;&#1605;
          </span>
        </div>
      </div>
    </header>
  )
}
