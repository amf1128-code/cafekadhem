import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { PickupConfig, PickupSlot, Menu, MenuItem } from '../../lib/types'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { PageLoader } from '../../components/ui/LoadingSpinner'
import { formatTime } from '../../lib/utils/date'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface SlotForm {
  day_of_week: number
  start_time: string
  end_time: string
  max_orders: string
}

export function AdminPickupConfig() {
  const { addToast } = useToast()
  const [config, setConfig] = useState<PickupConfig | null>(null)
  const [slots, setSlots] = useState<PickupSlot[]>([])
  const [menus, setMenus] = useState<Menu[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Config form
  const [menuId, setMenuId] = useState('')
  const [isActive, setIsActive] = useState(false)

  // Per-item quantity limits for the active pickup config. Keyed by menu_item_id.
  const [menuItemsForLimits, setMenuItemsForLimits] = useState<MenuItem[]>([])
  const [limits, setLimits] = useState<Record<string, string>>({})
  const [savingLimits, setSavingLimits] = useState(false)

  // New slot form
  const [newSlot, setNewSlot] = useState<SlotForm>({
    day_of_week: 1,
    start_time: '10:00',
    end_time: '14:00',
    max_orders: '',
  })

  useEffect(() => {
    loadData()
  }, [])

  // When the selected menu changes (or after the config first loads with one),
  // pull the menu's items so we can render the per-item limit inputs.
  useEffect(() => {
    let cancelled = false
    async function run() {
      if (!menuId) {
        setMenuItemsForLimits([])
        return
      }
      const { data } = await supabase
        .from('menu_items')
        .select('*')
        .eq('menu_id', menuId)
        .order('sort_order')
      if (!cancelled && data) setMenuItemsForLimits(data)
    }
    run()
    return () => {
      cancelled = true
    }
  }, [menuId])

  async function loadData() {
    const [configResult, menusResult] = await Promise.all([
      supabase.from('pickup_config').select('*').limit(1).single(),
      supabase.from('menus').select('*').order('name'),
    ])

    if (configResult.data) {
      setConfig(configResult.data)
      setMenuId(configResult.data.menu_id || '')
      setIsActive(configResult.data.is_active)

      const [{ data: slotsData }, { data: limitRows }] = await Promise.all([
        supabase
          .from('pickup_slots')
          .select('*')
          .eq('pickup_config_id', configResult.data.id)
          .order('day_of_week')
          .order('start_time'),
        supabase
          .from('pickup_menu_item_limits')
          .select('menu_item_id, max_quantity')
          .eq('pickup_config_id', configResult.data.id),
      ])
      if (slotsData) setSlots(slotsData)
      if (limitRows) {
        const map: Record<string, string> = {}
        for (const row of limitRows) map[row.menu_item_id] = String(row.max_quantity)
        setLimits(map)
      }
    }

    if (menusResult.data) setMenus(menusResult.data)
    setLoading(false)
  }

  async function handleSaveConfig() {
    setSaving(true)
    try {
      let configId = config?.id
      const previousMenuId = config?.menu_id || ''
      if (config) {
        const { error } = await supabase
          .from('pickup_config')
          .update({
            menu_id: menuId || null,
            is_active: isActive,
          })
          .eq('id', config.id)
        if (error) throw error
      } else {
        const { data, error } = await supabase
          .from('pickup_config')
          .insert({
            menu_id: menuId || null,
            is_active: isActive,
          })
          .select('*')
          .single()
        if (error) throw error
        setConfig(data)
        configId = data.id
      }

      // Switching the active menu triggers a server-side wipe of existing
      // limits (so re-using a menu later starts fresh). Drop any local state
      // tied to the previous menu so the UI doesn't try to upsert stale rows.
      if (configId && previousMenuId && previousMenuId !== menuId) {
        setLimits({})
      } else if (configId && menuId) {
        await persistLimits(configId)
      }
      addToast('Pickup config saved')
    } catch {
      addToast('Failed to save config', 'error')
    }
    setSaving(false)
  }

  async function persistLimits(configId: string) {
    if (!menuId) return
    setSavingLimits(true)
    try {
      const upsertRows: { pickup_config_id: string; menu_item_id: string; max_quantity: number }[] = []
      const clearedItemIds: string[] = []
      for (const item of menuItemsForLimits) {
        const raw = (limits[item.id] || '').trim()
        if (raw === '') {
          clearedItemIds.push(item.id)
          continue
        }
        const parsed = parseInt(raw, 10)
        if (Number.isFinite(parsed) && parsed >= 0) {
          upsertRows.push({
            pickup_config_id: configId,
            menu_item_id: item.id,
            max_quantity: parsed,
          })
        }
      }
      if (upsertRows.length > 0) {
        const { error } = await supabase
          .from('pickup_menu_item_limits')
          .upsert(upsertRows, { onConflict: 'pickup_config_id,menu_item_id' })
        if (error) console.error('[Pickup Limits] upsert failed:', error)
      }
      if (clearedItemIds.length > 0) {
        const { error } = await supabase
          .from('pickup_menu_item_limits')
          .delete()
          .eq('pickup_config_id', configId)
          .in('menu_item_id', clearedItemIds)
        if (error) console.error('[Pickup Limits] delete failed:', error)
      }
    } finally {
      setSavingLimits(false)
    }
  }

  async function handleSaveLimits() {
    if (!config?.id) {
      addToast('Save the config first', 'error')
      return
    }
    await persistLimits(config.id)
    addToast('Limits saved')
  }

  async function handleAddSlot() {
    if (!config) {
      addToast('Save the config first', 'error')
      return
    }

    try {
      const { data, error } = await supabase
        .from('pickup_slots')
        .insert({
          pickup_config_id: config.id,
          day_of_week: newSlot.day_of_week,
          start_time: newSlot.start_time,
          end_time: newSlot.end_time,
          max_orders: newSlot.max_orders ? parseInt(newSlot.max_orders) : null,
        })
        .select('*')
        .single()
      if (error) throw error
      setSlots(prev => [...prev, data].sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time)))
      addToast('Slot added')
    } catch {
      addToast('Failed to add slot', 'error')
    }
  }

  async function handleToggleSlot(slot: PickupSlot) {
    const { error } = await supabase
      .from('pickup_slots')
      .update({ is_active: !slot.is_active })
      .eq('id', slot.id)

    if (error) {
      addToast('Failed to update slot', 'error')
    } else {
      setSlots(prev => prev.map(s => s.id === slot.id ? { ...s, is_active: !s.is_active } : s))
    }
  }

  async function handleDeleteSlot(slotId: string) {
    const { error } = await supabase.from('pickup_slots').delete().eq('id', slotId)
    if (error) {
      addToast('Failed to delete slot', 'error')
    } else {
      setSlots(prev => prev.filter(s => s.id !== slotId))
      addToast('Slot removed')
    }
  }

  if (loading) return <PageLoader />

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-serif text-2xl text-forest-dark">Pick-Up Orders</h1>
        <Link to="/admin/pickup/orders">
          <Button variant="outline">View Orders</Button>
        </Link>
      </div>

      {/* Config */}
      <div className="bg-white border border-warm rounded-lg p-6 mb-6">
        <h2 className="font-serif text-lg text-forest-dark mb-4">Configuration</h2>

        <div className="space-y-4 max-w-md">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Active Menu</label>
            <select
              value={menuId}
              onChange={e => setMenuId(e.target.value)}
              className="w-full rounded-lg border border-warm bg-white px-4 py-2.5 text-ink focus:border-forest focus:ring-1 focus:ring-forest outline-none transition-colors"
            >
              <option value="">— No menu selected —</option>
              {menus.map(m => (
                <option key={m.id} value={m.id}>{m.name}{m.is_template ? ' (template)' : ''}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={isActive}
                onChange={e => setIsActive(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-warm rounded-full peer peer-checked:bg-forest transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
            </label>
            <span className="text-sm text-ink">
              {isActive ? 'Pickup ordering is live' : 'Pickup ordering is off'}
            </span>
          </div>

          <Button onClick={handleSaveConfig} loading={saving}>Save Config</Button>
        </div>
      </div>

      {/* Per-item limits */}
      {config?.id && menuId && menuItemsForLimits.length > 0 && (
        <div className="bg-white border border-warm rounded-lg p-6 mb-6">
          <h2 className="font-serif text-lg text-forest-dark mb-1">Per-item Limits</h2>
          <p className="text-xs text-ink-muted mb-4">
            Cap how many of each item can be ordered for the current pickup session.
            Leave blank for no limit. Switching menus resets all limits.
          </p>
          <div className="space-y-2 mb-4">
            {menuItemsForLimits.map(item => (
              <div key={item.id} className="flex items-center gap-3">
                <span className="flex-1 text-sm text-ink">{item.name}</span>
                <input
                  type="number"
                  min="0"
                  value={limits[item.id] || ''}
                  onChange={e =>
                    setLimits(prev => ({ ...prev, [item.id]: e.target.value }))
                  }
                  placeholder="No limit"
                  className="w-24 rounded-lg border border-warm bg-white px-3 py-2 text-sm text-ink focus:border-forest outline-none"
                />
              </div>
            ))}
          </div>
          <Button size="sm" onClick={handleSaveLimits} loading={savingLimits}>Save Limits</Button>
        </div>
      )}

      {/* Slots */}
      <div className="bg-white border border-warm rounded-lg p-6 mb-6">
        <h2 className="font-serif text-lg text-forest-dark mb-4">Available Pickup Slots</h2>

        {slots.length === 0 ? (
          <p className="text-ink/60 text-sm mb-4">No slots configured yet.</p>
        ) : (
          <div className="space-y-2 mb-6">
            {slots.map(slot => (
              <div key={slot.id} className={`flex items-center justify-between border rounded-lg px-4 py-3 ${slot.is_active ? 'border-warm bg-white' : 'border-warm/50 bg-warm/20 opacity-60'}`}>
                <div>
                  <span className="font-medium text-sm text-ink">{DAY_NAMES[slot.day_of_week]}</span>
                  <span className="text-sm text-ink/70 ml-3">
                    {formatTime(slot.start_time)} - {formatTime(slot.end_time)}
                  </span>
                  {slot.max_orders && (
                    <span className="text-xs text-ink/50 ml-3">max {slot.max_orders} orders</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggleSlot(slot)}
                    className="text-xs text-forest hover:text-forest-dark transition-colors"
                  >
                    {slot.is_active ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    onClick={() => handleDeleteSlot(slot.id)}
                    className="text-xs text-red-600 hover:text-red-800 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add new slot */}
        <div className="border-t border-warm pt-4">
          <p className="text-sm font-medium text-ink mb-3">Add Slot</p>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs text-ink/60 mb-1">Day</label>
              <select
                value={newSlot.day_of_week}
                onChange={e => setNewSlot(prev => ({ ...prev, day_of_week: parseInt(e.target.value) }))}
                className="rounded-lg border border-warm bg-white px-3 py-2 text-sm text-ink focus:border-forest outline-none"
              >
                {DAY_NAMES.map((name, i) => (
                  <option key={i} value={i}>{name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-ink/60 mb-1">Start</label>
              <input
                type="time"
                value={newSlot.start_time}
                onChange={e => setNewSlot(prev => ({ ...prev, start_time: e.target.value }))}
                className="rounded-lg border border-warm bg-white px-3 py-2 text-sm text-ink focus:border-forest outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-ink/60 mb-1">End</label>
              <input
                type="time"
                value={newSlot.end_time}
                onChange={e => setNewSlot(prev => ({ ...prev, end_time: e.target.value }))}
                className="rounded-lg border border-warm bg-white px-3 py-2 text-sm text-ink focus:border-forest outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-ink/60 mb-1">Max Orders</label>
              <input
                type="number"
                value={newSlot.max_orders}
                onChange={e => setNewSlot(prev => ({ ...prev, max_orders: e.target.value }))}
                placeholder="No limit"
                className="w-24 rounded-lg border border-warm bg-white px-3 py-2 text-sm text-ink focus:border-forest outline-none"
              />
            </div>
            <Button size="sm" onClick={handleAddSlot} disabled={!config}>Add</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
