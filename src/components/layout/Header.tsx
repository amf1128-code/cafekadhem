import { Link } from 'react-router-dom'

export function Header() {
  return (
    <header className="bg-cream border-b border-warm">
      <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
        <Link to="/" className="flex flex-col items-start">
          <h1 className="font-serif text-2xl text-forest-dark leading-tight">Cafe Kadhem</h1>
          <span className="font-script text-lg text-forest leading-tight">
            &#1603;&#1575;&#1601;&#1610;&#1607; &#1603;&#1575;&#1592;&#1605;
          </span>
        </Link>
      </div>
    </header>
  )
}
