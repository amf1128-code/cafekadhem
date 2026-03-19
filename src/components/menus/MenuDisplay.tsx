import type { MenuItem } from '../../lib/types'

interface MenuDisplayProps {
  items: MenuItem[]
}

export function MenuDisplay({ items }: MenuDisplayProps) {
  const categories = Array.from(new Set(items.map(i => i.category || 'Other')))

  return (
    <div className="space-y-8">
      {categories.map(cat => (
        <div key={cat}>
          <p className="text-[10px] tracking-[0.2em] uppercase text-ink-muted mb-4">{cat}</p>
          <div className="space-y-3">
            {items
              .filter(i => (i.category || 'Other') === cat)
              .map(item => (
                <div key={item.id} className="flex justify-between items-baseline gap-4 border-b border-stone/50 pb-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-serif text-lg text-ink">{item.name}</p>
                    {item.description && (
                      <p className="font-serif text-sm text-ink-muted italic mt-0.5">{item.description}</p>
                    )}
                  </div>
                  {item.price != null && (
                    <p className="font-serif text-ink whitespace-nowrap">
                      ${item.price.toFixed(2)}
                    </p>
                  )}
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  )
}
