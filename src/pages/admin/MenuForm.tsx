import { useState, useEffect, type FormEvent } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { MenuItem } from '../../lib/types'
import { Button } from '../../components/ui/Button'
import { Input, Textarea } from '../../components/ui/Input'
import { useToast } from '../../components/ui/Toast'
import { PageLoader } from '../../components/ui/LoadingSpinner'

interface ItemDraft {
  id?: string
  name: string
  description: string
  price: string
  unit_cost: string
  category: string
  display_arabic: string
  sort_order: number
  is_available: boolean
}

const emptyItem: ItemDraft = {
  name: '',
  description: '',
  price: '',
  unit_cost: '',
  category: '',
  display_arabic: '',
  sort_order: 0,
  is_available: true,
}

export function AdminMenuForm() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { addToast } = useToast()
  const isEdit = !!id

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isTemplate, setIsTemplate] = useState(false)
  const [items, setItems] = useState<ItemDraft[]>([{ ...emptyItem }])
  // IDs that came back from the DB on load — anything in this set that is no
  // longer in `items` should be DELETEd; anything still present should be
  // UPDATEd in place so its UUID (and any FKs that reference it) survives.
  const [originalItemIds, setOriginalItemIds] = useState<string[]>([])
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (id) loadMenu()
  }, [id])

  async function loadMenu() {
    const [menuResult, itemsResult] = await Promise.all([
      supabase.from('menus').select('*').eq('id', id!).single(),
      supabase.from('menu_items').select('*').eq('menu_id', id!).order('sort_order'),
    ])

    if (menuResult.data) {
      setName(menuResult.data.name)
      setDescription(menuResult.data.description || '')
      setIsTemplate(menuResult.data.is_template)
    }

    if (itemsResult.data && itemsResult.data.length > 0) {
      setOriginalItemIds(itemsResult.data.map((item: MenuItem) => item.id))
      setItems(
        itemsResult.data.map((item: MenuItem) => ({
          id: item.id,
          name: item.name,
          description: item.description || '',
          price: item.price != null ? String(item.price) : '',
          unit_cost: item.unit_cost != null ? String(item.unit_cost) : '',
          category: item.category || '',
          display_arabic: item.display_arabic || '',
          sort_order: item.sort_order,
          is_available: item.is_available,
        }))
      )
    }

    setLoading(false)
  }

  function addItem() {
    setItems(prev => [...prev, { ...emptyItem, sort_order: prev.length }])
  }

  function updateItem(index: number, field: keyof ItemDraft, value: string | boolean) {
    setItems(prev => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)))
  }

  function removeItem(index: number) {
    setItems(prev => prev.filter((_, i) => i !== index))
  }

  function moveItem(index: number, direction: -1 | 1) {
    const newIndex = index + direction
    if (newIndex < 0 || newIndex >= items.length) return
    setItems(prev => {
      const copy = [...prev]
      ;[copy[index], copy[newIndex]] = [copy[newIndex], copy[index]]
      return copy.map((item, i) => ({ ...item, sort_order: i }))
    })
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      addToast('Menu name is required', 'error')
      return
    }

    setSaving(true)

    try {
      let menuId = id

      if (isEdit) {
        await supabase.from('menus').update({
          name: name.trim(),
          description: description.trim() || null,
          is_template: isTemplate,
        }).eq('id', id!)
      } else {
        const { data } = await supabase.from('menus').insert({
          name: name.trim(),
          description: description.trim() || null,
          is_template: isTemplate,
        }).select('id').single()

        if (!data) throw new Error('Failed to create menu')
        menuId = data.id
      }

      // Reconcile items with a diff. Existing rows are UPDATEd in place so
      // their UUID (and any orders / limits referencing them) survive.
      // Newly added rows are INSERTed. Rows the admin removed from the form
      // are DELETEd — that will fail if there are orders against them, in
      // which case we surface a clear message.
      const validItems = items.filter(item => item.name.trim())

      const keptIds = new Set(
        validItems.map(i => i.id).filter((v): v is string => !!v)
      )
      const toDelete = originalItemIds.filter(origId => !keptIds.has(origId))

      if (toDelete.length > 0) {
        const { error: delErr } = await supabase
          .from('menu_items')
          .delete()
          .in('id', toDelete)
        if (delErr) {
          throw new Error(
            'Some removed items have orders attached. Cancel those orders first, or mark the items unavailable instead of removing them.'
          )
        }
      }

      const updates = validItems
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.id && originalItemIds.includes(item.id))
      for (const { item, index } of updates) {
        const { error: upErr } = await supabase
          .from('menu_items')
          .update({
            name: item.name.trim(),
            description: item.description.trim() || null,
            price: item.price ? parseFloat(item.price) : null,
            unit_cost: item.unit_cost ? parseFloat(item.unit_cost) : null,
            category: item.category.trim() || null,
            display_arabic: item.display_arabic.trim() || null,
            sort_order: index,
            is_available: item.is_available,
          })
          .eq('id', item.id!)
        if (upErr) throw new Error(`Failed to update item: ${upErr.message}`)
      }

      const inserts = validItems
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => !item.id || !originalItemIds.includes(item.id))
      if (inserts.length > 0) {
        const { error: insErr } = await supabase.from('menu_items').insert(
          inserts.map(({ item, index }) => ({
            menu_id: menuId!,
            name: item.name.trim(),
            description: item.description.trim() || null,
            price: item.price ? parseFloat(item.price) : null,
            unit_cost: item.unit_cost ? parseFloat(item.unit_cost) : null,
            category: item.category.trim() || null,
            display_arabic: item.display_arabic.trim() || null,
            sort_order: index,
            is_available: item.is_available,
          }))
        )
        if (insErr) throw new Error(`Failed to add new items: ${insErr.message}`)
      }

      addToast(isEdit ? 'Menu updated' : 'Menu created')
      navigate('/admin/menus')
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save menu', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <PageLoader />

  return (
    <div>
      <h1 className="font-serif text-2xl text-forest-dark mb-6">
        {isEdit ? 'Edit Menu' : 'Create Menu'}
      </h1>

      <form onSubmit={handleSave} className="max-w-2xl space-y-6">
        <div className="space-y-3">
          <Input
            label="Menu Name"
            value={name}
            onChange={e => setName(e.target.value)}
            required
          />
          <Textarea
            label="Description"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Optional description"
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isTemplate}
              onChange={e => setIsTemplate(e.target.checked)}
              className="rounded border-warm text-forest focus:ring-forest"
            />
            Save as template (reusable for future events)
          </label>
        </div>

        {/* Menu Items */}
        <div>
          <h2 className="font-serif text-lg text-forest-dark mb-3">Menu Items</h2>
          <div className="space-y-4">
            {items.map((item, index) => (
              <div key={index} className="bg-white border border-warm rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-ink/50">Item {index + 1}</span>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => moveItem(index, -1)} className="text-ink/40 hover:text-ink text-sm px-1" disabled={index === 0}>Up</button>
                    <button type="button" onClick={() => moveItem(index, 1)} className="text-ink/40 hover:text-ink text-sm px-1" disabled={index === items.length - 1}>Down</button>
                    <button type="button" onClick={() => removeItem(index)} className="text-red-500 hover:text-red-700 text-sm px-1">Remove</button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <Input
                    label="Name"
                    value={item.name}
                    onChange={e => updateItem(index, 'name', e.target.value)}
                    required
                  />
                  <Input
                    label="Price"
                    type="number"
                    step="0.01"
                    min="0"
                    value={item.price}
                    onChange={e => updateItem(index, 'price', e.target.value)}
                    placeholder="Optional"
                  />
                  <Input
                    label="Unit cost"
                    type="number"
                    step="0.01"
                    min="0"
                    value={item.unit_cost}
                    onChange={e => updateItem(index, 'unit_cost', e.target.value)}
                    placeholder="Internal"
                  />
                </div>
                <Input
                  label="Description"
                  value={item.description}
                  onChange={e => updateItem(index, 'description', e.target.value)}
                  placeholder="Optional"
                />
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Category"
                    value={item.category}
                    onChange={e => updateItem(index, 'category', e.target.value)}
                    placeholder="e.g., Sweet, Savory, Drinks"
                  />
                  <Input
                    label="Arabic display word"
                    value={item.display_arabic}
                    onChange={e => updateItem(index, 'display_arabic', e.target.value)}
                    placeholder="e.g. كنافة (optional)"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={item.is_available}
                    onChange={e => updateItem(index, 'is_available', e.target.checked)}
                    className="rounded border-warm text-forest focus:ring-forest"
                  />
                  Available
                </label>
              </div>
            ))}
          </div>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={addItem}>
            Add Item
          </Button>
        </div>

        <div className="flex gap-3">
          <Button type="submit" loading={saving}>
            {isEdit ? 'Update Menu' : 'Create Menu'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => navigate('/admin/menus')}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
