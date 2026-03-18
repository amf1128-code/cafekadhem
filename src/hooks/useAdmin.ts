import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Session } from '@supabase/supabase-js'

export function useAdmin() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  async function login(email: string, password: string) {
    console.log('[auth] Attempting login for:', email)
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        console.error('[auth] Login error:', error.message, error.status, error)
        throw error
      }
      console.log('[auth] Login successful, session:', !!data.session)
    } catch (err) {
      console.error('[auth] Login exception:', err)
      throw err
    }
  }

  async function logout() {
    await supabase.auth.signOut()
  }

  return {
    session,
    isAuthenticated: !!session,
    loading,
    login,
    logout,
  }
}
