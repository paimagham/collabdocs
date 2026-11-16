import { useEffect, useState } from 'react'
import { UserPlus, X, Trash2, Lock } from 'lucide-react'
import { api, type Doc, type Share, type User } from '../api'

type Props = { doc: Doc; onClose: () => void; onChanged: () => void }

export function ShareDialog({ doc, onClose, onChanged }: Props) {
  const isOwner = doc.role === 'owner'
  const [shares, setShares] = useState<Share[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Share['role']>('editor')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.listShares(doc.id).then((r) => setShares(r.shares)).catch((e) => setError(e.message))
    if (isOwner) api.listUsers().then((r) => setUsers(r.users)).catch(() => {})
  }, [doc.id, isOwner])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function run(fn: () => Promise<{ shares: Share[] }>) {
    setBusy(true)
    setError('')
    try {
      setShares((await fn()).shares)
      onChanged()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return setError('Enter an email address')
    if (await run(() => api.share(doc.id, email, role))) setEmail('')
  }

  const suggestions = users.filter((u) => u.id !== doc.owner.id && !shares.some((s) => s.id === u.id))

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="share-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 id="share-title">Share “{doc.title}”</h3>
          <button className="ai-close" onClick={onClose} aria-label="Close"><X size={17} /></button>
        </div>

        {isOwner ? (
          <form className="share-form" onSubmit={add}>
            <input
              list="share-users"
              type="email"
              placeholder="Add people by email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
            <datalist id="share-users">
              {suggestions.map((u) => <option key={u.id} value={u.email}>{u.name}</option>)}
            </datalist>
            <select value={role} onChange={(e) => setRole(e.target.value as Share['role'])} aria-label="Access level">
              <option value="editor">Can edit</option>
              <option value="viewer">Can view</option>
            </select>
            <button className="share-button primary" type="submit" disabled={busy}><UserPlus size={15} /> Share</button>
          </form>
        ) : (
          <p className="modal-note"><Lock size={13} /> Only the owner can change who has access.</p>
        )}
        {error && <div className="form-error" role="alert">{error}</div>}

        <div className="sidebar-label">PEOPLE WITH ACCESS</div>
        <ul className="share-list">
          <li>
            <div className="avatar">{doc.owner.name[0]}</div>
            <div className="share-person"><strong>{doc.owner.name}</strong><small>{doc.owner.email}</small></div>
            <span className="role-pill owner">Owner</span>
          </li>
          {shares.map((s) => (
            <li key={s.id}>
              <div className="avatar">{s.name[0]}</div>
              <div className="share-person"><strong>{s.name}</strong><small>{s.email}</small></div>
              {isOwner ? (
                <>
                  <select
                    value={s.role}
                    disabled={busy}
                    aria-label={`Access for ${s.name}`}
                    onChange={(e) => run(() => api.share(doc.id, s.email, e.target.value as Share['role']))}
                  >
                    <option value="editor">Can edit</option>
                    <option value="viewer">Can view</option>
                  </select>
                  <button className="delete-button visible" title="Remove access" disabled={busy} onClick={() => run(() => api.unshare(doc.id, s.id))}>
                    <Trash2 size={14} />
                  </button>
                </>
              ) : (
                <span className="role-pill">{s.role === 'editor' ? 'Can edit' : 'Can view'}</span>
              )}
            </li>
          ))}
          {shares.length === 0 && <li className="empty-message">Not shared with anyone yet.</li>}
        </ul>
      </div>
    </div>
  )
}
