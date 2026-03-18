import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Menu } from '../../lib/types'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { useToast } from '../../components/ui/Toast'
import { PageLoader } from '../../components/ui/LoadingSpinner'

export function AdminMenuList() {
  const { addToast } = useToast()
  const [menus, setMenus] = useState<(Menu & { item_count: number })[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadMenus()
  }, [])

  async function loadMenus() {
    const { data } = await supabase.from('menus').select('*').order('created_at', { ascending: false })
    if (data) {
      const withCounts = await Promise.all(
        data.map(async (menu) => {
          const { count } = await supabase
            .from('menu_items')
            .select('*', { count: 'exact', head: true })
            .eq('menu_id', menu.id)
          return { ...menu, item_count: count || 0 }
        })
      )
      setMenus(withCounts)
    }
    setLoading(false)
  }

  async function handleDuplicate(menuId: string) {
    const { data: original } = await supabase.from('menus').select('*').eq('id', menuId).single()
    if (!original) return

    const { data: newMenu } = await supabase
      .from('menus')
      .insert({ name: `${original.name} (Copy)`, description: original.description, is_template: false })
      .select('*')
      .single()

    if (!newMenu) {
      addToast('Failed to duplicate menu', 'error')
      return
    }

    // Copy items
    const { data: items } = await supabase.from('menu_items').select('*').eq('menu_id', menuId)
    if (items && items.length > 0) {
      await supabase.from('menu_items').insert(
        items.map(({ id: _, menu_id: __, created_at: ___, ...item }) => ({
          ...item,
          menu_id: newMenu.id,
        }))
      )
    }

    addToast('Menu duplicated')
    loadMenus()
  }

  async function handleDelete(menuId: string) {
    // Check if linked to any event
    const { count } = await supabase
      .from('events')
      .select('*', { count: 'exact', head: true })
      .eq('menu_id', menuId)

    if (count && count > 0) {
      addToast('Cannot delete: menu is linked to an event', 'error')
      return
    }

    const { error } = await supabase.from('menus').delete().eq('id', menuId)
    if (error) {
      addToast('Failed to delete menu', 'error')
    } else {
      addToast('Menu deleted')
      loadMenus()
    }
  }

  if (loading) return <PageLoader />

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-serif text-2xl text-forest-dark">Menus</h1>
        <Link to="/admin/menus/new">
          <Button>Create Menu</Button>
        </Link>
      </div>

      {menus.length === 0 ? (
        <p className="text-ink/60">No menus yet. Create your first menu to get started.</p>
      ) : (
        <div className="space-y-3">
          {menus.map(menu => (
            <div key={menu.id} className="bg-white border border-warm rounded-lg p-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-ink">{menu.name}</h3>
                  {menu.is_template && <Badge variant="info">Template</Badge>}
                </div>
                <p className="text-sm text-ink/60">{menu.item_count} items</p>
              </div>
              <div className="flex gap-2">
                <Link to={`/admin/menus/${menu.id}/edit`}>
                  <Button variant="outline" size="sm">Edit</Button>
                </Link>
                <Button variant="ghost" size="sm" onClick={() => handleDuplicate(menu.id)}>
                  Duplicate
                </Button>
                <Button variant="danger" size="sm" onClick={() => handleDelete(menu.id)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
