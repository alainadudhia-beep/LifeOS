import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { migrateToSupabase } from '../lib/db'

export default function AuthGate({ children }) {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) migrateToSupabase()
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) migrateToSupabase()
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
