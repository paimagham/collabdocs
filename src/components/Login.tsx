import { useState } from 'react'
import { FileText, LogIn } from 'lucide-react'
import { api, setToken, type User } from '../api'

// Seeded demo accounts (see server/db.js). Shown on the login screen so
// reviewers can switch users quickly to test sharing.
const DEMO_USERS = [
  { email: 'alice@ajaia.test', name: 'Alice Owner', hint: 'Owns the welcome doc' },
  { email: 'bob@ajaia.test', name: 'Bob Collaborator', hint: 'Has editor access to it' },
  { email: 'carol@ajaia.test', name: 'Carol Reviewer', hint: 'Has no access yet' },
]
const DEMO_PASSWORD = 'password123'

export function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e?: React.FormEvent, override?: { email: string; password: string }) {
    e?.preventDefault()
    const creds = override ?? { email, password }
    if (!creds.email.trim() || !creds.password) {
      setError('Enter your email and password')
      return
    }
    setBusy(true)
    setError('')
    try {
      const { token, user } = await api.login(creds.email, creds.password)
      setToken(token)
      onLogin(user)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="brand login-brand">
          <div className="brand-icon"><FileText size={21} /></div>
          <span>Collab<span className="brand-accent">Docs</span></span>
        </div>
        <h2>Sign in</h2>
        <p className="login-sub">Use a demo account to try document sharing.</p>

        <form onSubmit={submit} className="login-form">
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="alice@ajaia.test" autoComplete="username" />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password123" autoComplete="current-password" />
          </label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="new-button" type="submit" disabled={busy}>
            <LogIn size={17} /> {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="sidebar-label">OR CONTINUE AS</div>
        <div className="demo-users">
          {DEMO_USERS.map((u) => (
            <button key={u.email} type="button" disabled={busy} onClick={() => submit(undefined, { email: u.email, password: DEMO_PASSWORD })}>
              <div className="avatar">{u.name[0]}</div>
              <div>
                <strong>{u.name}</strong>
                <small>{u.email} · {u.hint}</small>
              </div>
            </button>
          ))}
        </div>
        <p className="login-foot">All demo accounts use the password <code>{DEMO_PASSWORD}</code>.</p>
      </div>
    </div>
  )
}
