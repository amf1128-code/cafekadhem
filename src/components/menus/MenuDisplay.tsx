import type { MenuItem } from '../../lib/types'

interface MenuDisplayProps {
  items: MenuItem[]
}

export function MenuDisplay({ items }: MenuDisplayProps) {
  const categories = Array.from(new Set(items.map(i => i.category || 'Other')))

  return (
    <div className="space-y-6">
      {categories.map(cat => (
        <div key={cat}>
          <h3 className="font-serif text-lg text-forest-dark mb-3 border-b border-warm pb-1">
            {cat}
          </h3>
          <div className="space-y-3">
            {items
              .filter(i => (i.category || 'Other') === cat)
              .map(item => (
                <div key={item.id} className="flex justify-between items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-ink">{item.name}</p>
                    {item.description && (
                      <p className="text-sm text-ink/60 mt-0.5">{item.description}</p>
                    )}
                  </div>
                  {item.price != null && (
                    <p className="text-sm font-medium text-forest whitespace-nowrap">
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
