import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { migrateToSupabase, preloadAllKeys } from '../lib/db'

export default function AuthGate({ children }) {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        await preloadAllKeys()
        migrateToSupabase()
      }
      setSession(session)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) return <div className="auth-loading">Loading…</div>
  if (!session) return <LoginScreen />
  return children
}

function LoginScreen() {
  async function signIn() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    })
  }

  return (
    <div className="login-screen">
      <h1 className="login-title">Life OS</h1>
      <button className="login-btn" onClick={signIn}>Sign in with Google</button>
    </div>
  )
}
