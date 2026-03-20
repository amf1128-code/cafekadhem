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
        <span className="font-arabic text-2xl text-forest">
          &#1603;&#1575;&#1601;&#1610;&#1607; &#1603;&#1575;&#1592;&#1605;
        </span>
      </div>
    </header>
  )
}
