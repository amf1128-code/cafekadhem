import { Link } from 'react-router-dom'

export function Header() {
  return (
    <header className="bg-cream">
      <div className="max-w-3xl mx-auto px-6 py-6 flex items-center justify-between">
        <Link to="/" className="relative group">
          {/* Arabic behind at half opacity */}
          <span className="absolute inset-0 flex items-center font-arabic text-3xl text-ink/50 select-none pointer-events-none" aria-hidden="true">
            &#1603;&#1575;&#1601;&#1610;&#1607; &#1603;&#1575;&#1592;&#1605;
          </span>
          <span className="relative text-sm tracking-[0.3em] uppercase text-ink font-medium">
            Cafe Kadhem
          </span>
        </Link>
        <span className="font-arabic text-2xl text-forest">
          &#1603;&#1575;&#1601;&#1610;&#1607; &#1603;&#1575;&#1592;&#1605;
        </span>
      </div>
    </header>
  )
}
