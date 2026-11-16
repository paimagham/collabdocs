import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  FileText, Plus, Search, Upload, Share2, Trash2,
  Bold, Italic, Underline as UnderlineIcon,
  List, ListOrdered, Heading1, Heading2, Heading3, Undo2, Redo2,
  Clock, FilePlus2, Check, Users, LogOut, Sparkles, Eye, TriangleAlert, LoaderCircle, X,
} from 'lucide-react'
import { api, ApiError, getToken, setToken, type Doc, type DocSummary, type User } from './api'
import { Login } from './components/Login'
import { ShareDialog } from './components/ShareDialog'
import { AIPanel } from './components/AIPanel'
import './App.css'

type View = 'mine' | 'shared'
type SaveState = 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict'

const AUTOSAVE_MS = 800
const SUPPORTED_UPLOADS = '.txt,.md,.docx'

const docIdFromHash = () => {
  const m = window.location.hash.match(/^#\/doc\/(\d+)$/)
  return m ? Number(m[1]) : null
}

// Hash routing (#/doc/12) lets a refresh reopen the same document.
const setHash = (h: string) => {
  window.location.hash = h
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function formatDate(date: string) {
  return new Date(date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authChecked, setAuthChecked] = useState(!getToken())

  useEffect(() => {
    if (!getToken()) return
    api.me()
      .then((r) => setUser(r.user))
      .catch(() => setToken(null))
      .finally(() => setAuthChecked(true))
  }, [])

  async function logout() {
    await api.logout().catch(() => {})
    setToken(null)
    setHash('')
    setUser(null)
  }

  if (!authChecked) return <div className="loading-screen"><LoaderCircle className="spin" size={28} /></div>
  if (!user) return <Login onLogin={setUser} />
  return <Workspace key={user.id} user={user} onLogout={logout} />
}

function Workspace({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [owned, setOwned] = useState<DocSummary[]>([])
  const [shared, setShared] = useState<DocSummary[]>([])
  const [view, setView] = useState<View>('mine')
  const [doc, setDoc] = useState<Doc | null>(null)
  const [loadingDoc, setLoadingDoc] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [search, setSearch] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [titleInput, setTitleInput] = useState('')
  const [shareOpen, setShareOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)

  // Refs hold the values the autosave timer needs, so it never sees stale state.
  const docRef = useRef<Doc | null>(null)
  const pendingContent = useRef<string | null>(null)
  const saveTimer = useRef<number | undefined>(undefined)
  const inflight = useRef<Promise<void> | null>(null)

  const canEdit = doc ? doc.role !== 'viewer' : false
  const isOwner = doc?.role === 'owner'

  const showError = (e: unknown) => setNotice({ kind: 'error', text: (e as Error).message })

  const refreshLists = useCallback(async () => {
    try {
      const r = await api.listDocs()
      setOwned(r.owned)
      setShared(r.shared)
      return r
    } catch (e) {
      showError(e)
      return null
    }
  }, [])

  // ---------- saving ----------

  const save = useCallback(async () => {
    const current = docRef.current
    const content = pendingContent.current
    if (!current || content === null) return
    pendingContent.current = null
    setSaveState('saving')
    try {
      const updated = await api.updateDoc(current.id, { content, baseUpdatedAt: current.updatedAt })
      if (docRef.current?.id === updated.id) {
        docRef.current = { ...docRef.current, updatedAt: updated.updatedAt, content: updated.content }
        setDoc(docRef.current)
      }
      setOwned((list) => list.map((d) => (d.id === updated.id ? { ...d, updatedAt: updated.updatedAt } : d)))
      setSaveState(pendingContent.current === null ? 'saved' : 'unsaved')
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setSaveState('conflict')
      } else {
        pendingContent.current ??= content // keep the edit so the next attempt retries it
        setSaveState('error')
        showError(e)
      }
    }
  }, [])

  const flushSave = useCallback(async () => {
    window.clearTimeout(saveTimer.current)
    if (inflight.current) await inflight.current
    if (pendingContent.current !== null) {
      inflight.current = save().finally(() => (inflight.current = null))
      await inflight.current
    }
  }, [save])

  const scheduleSave = useCallback(() => {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => void flushSave(), AUTOSAVE_MS)
  }, [flushSave])

  // Warn before closing the tab with unsaved edits.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (pendingContent.current !== null) e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // ---------- editor ----------

  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false } })],
    content: '',
    editable: false,
    onUpdate: ({ editor }) => {
      if (!docRef.current || docRef.current.role === 'viewer') return
      pendingContent.current = editor.getHTML()
      setSaveState('unsaved')
      scheduleSave()
    },
  })

  // Re-render the toolbar when the selection or marks change.
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive('bold') ?? false,
      italic: e?.isActive('italic') ?? false,
      underline: e?.isActive('underline') ?? false,
      h1: e?.isActive('heading', { level: 1 }) ?? false,
      h2: e?.isActive('heading', { level: 2 }) ?? false,
      h3: e?.isActive('heading', { level: 3 }) ?? false,
      bullet: e?.isActive('bulletList') ?? false,
      ordered: e?.isActive('orderedList') ?? false,
    }),
  })

  // ---------- loading documents ----------

  const openDoc = useCallback(
    async (id: number | null) => {
      await flushSave()
      setRenaming(false)
      setShareOpen(false)
      if (id === null) {
        docRef.current = null
        setDoc(null)
        return
      }
      setLoadingDoc(true)
      try {
        const loaded = await api.getDoc(id)
        docRef.current = loaded
        setDoc(loaded)
        setSaveState('saved')
        setView(loaded.role === 'owner' ? 'mine' : 'shared')
        if (window.location.hash !== `#/doc/${id}`) setHash(`/doc/${id}`)
      } catch (e) {
        docRef.current = null
        setDoc(null)
        setHash('')
        showError(e instanceof ApiError && e.status === 404 ? new Error('That document does not exist or you do not have access.') : e)
      } finally {
        setLoadingDoc(false)
      }
    },
    [flushSave]
  )

  // Push the loaded document into the editor without triggering a save.
  useEffect(() => {
    // The editor is only mounted on the page while a document is open; touching
    // it before that throws in TipTap (seen in Safari).
    if (!editor || editor.isDestroyed || !doc) return
    editor.commands.setContent(doc.content, { emitUpdate: false })
    editor.setEditable(doc.role !== 'viewer', false)
    // Only when switching documents, not on every save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, doc?.id])

  // Initial load: lists, then the doc in the URL (or the most recent one).
  useEffect(() => {
    // Fetching on mount is the intended use of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshLists().then((r) => {
      if (!r) return
      const fromHash = docIdFromHash()
      const first = r.owned[0]?.id ?? r.shared[0]?.id ?? null
      void openDoc(fromHash ?? first)
    })
    const onHash = () => {
      const id = docIdFromHash()
      if (id !== null && id !== docRef.current?.id) void openDoc(id)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [refreshLists, openDoc])

  // ---------- actions ----------

  async function createDocument() {
    try {
      const created = await api.createDoc()
      await refreshLists()
      await openDoc(created.id)
      setTitleInput(created.title)
      setRenaming(true)
    } catch (e) {
      showError(e)
    }
  }

  async function saveTitle() {
    if (!doc) return
    const title = titleInput.trim()
    setRenaming(false)
    if (!title || title === doc.title) return
    try {
      await flushSave()
      const updated = await api.updateDoc(doc.id, { title })
      docRef.current = { ...doc, title: updated.title, updatedAt: updated.updatedAt }
      setDoc(docRef.current)
      await refreshLists()
    } catch (e) {
      showError(e)
    }
  }

  async function deleteDocument(id: number, title: string) {
    if (!window.confirm(`Delete “${title}”? This cannot be undone.`)) return
    try {
      await api.deleteDoc(id)
      if (docRef.current?.id === id) {
        pendingContent.current = null
        docRef.current = null
        setDoc(null)
        setHash('')
      }
      const r = await refreshLists()
      if (r && !docRef.current) void openDoc(r.owned[0]?.id ?? r.shared[0]?.id ?? null)
    } catch (e) {
      showError(e)
    }
  }

  async function importFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    if (!SUPPORTED_UPLOADS.split(',').includes(ext)) {
      setNotice({ kind: 'error', text: `“${file.name}” is not supported. Upload a .txt, .md, or .docx file.` })
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setNotice({ kind: 'error', text: 'File is too large (2 MB limit).' })
      return
    }
    setImporting(true)
    try {
      const created = await api.importFile(file)
      await refreshLists()
      await openDoc(created.id)
      setNotice({ kind: 'info', text: `Imported “${file.name}” as a new document.` })
    } catch (e) {
      showError(e)
    } finally {
      setImporting(false)
    }
  }

  async function reloadAfterConflict() {
    if (!doc) return
    pendingContent.current = null
    const fresh = await api.getDoc(doc.id).catch((e) => (showError(e), null))
    if (!fresh) return
    docRef.current = fresh
    setDoc(fresh)
    editor?.commands.setContent(fresh.content, { emitUpdate: false })
    setSaveState('saved')
  }

  function insertAIText(text: string) {
    if (!editor || !canEdit) return
    const html = text
      .split(/\n{2,}/)
      .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
      .join('')
    editor.chain().focus('end').insertContent(html).run()
  }

  // ---------- render ----------

  const list = view === 'mine' ? owned : shared
  const filtered = list.filter((d) => d.title.toLowerCase().includes(search.toLowerCase()))

  const status = {
    saved: { icon: <Check size={15} />, text: 'All changes saved' },
    unsaved: { icon: <Clock size={15} />, text: 'Unsaved changes' },
    saving: { icon: <LoaderCircle size={15} className="spin" />, text: 'Saving…' },
    error: { icon: <TriangleAlert size={15} />, text: 'Save failed, retrying on next edit' },
    conflict: { icon: <TriangleAlert size={15} />, text: 'Out of date' },
  }[saveState]

  const tool = (title: string, isActive: boolean, onClick: () => void, icon: React.ReactNode) => (
    <button title={title} aria-label={title} aria-pressed={isActive} className={isActive ? 'tool-active' : ''} disabled={!canEdit} onClick={onClick}>
      {icon}
    </button>
  )

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon"><FileText size={21} /></div>
          <span>Collab<span className="brand-accent">Docs</span></span>
        </div>

        <button className="new-button" onClick={createDocument}>
          <Plus size={18} /> <span>New document</span>
        </button>

        <div className="sidebar-label">WORKSPACE</div>
        <button className={`workspace-item ${view === 'mine' ? 'active' : ''}`} onClick={() => setView('mine')}>
          <FileText size={17} /> <span>My documents</span>
          <span className="count">{owned.length}</span>
        </button>
        <button className={`workspace-item ${view === 'shared' ? 'active' : ''}`} onClick={() => setView('shared')}>
          <Users size={17} /> <span>Shared with me</span>
          <span className="count">{shared.length}</span>
        </button>

        <div className="sidebar-divider" />
        <div className="sidebar-label">{view === 'mine' ? 'OWNED BY YOU' : 'SHARED WITH YOU'}</div>

        <div className="search-box">
          <Search size={15} />
          <input placeholder="Search documents..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <div className="document-list">
          {filtered.map((d) => (
            <div
              key={d.id}
              role="button"
              tabIndex={0}
              className={`document-item ${doc?.id === d.id ? 'selected' : ''}`}
              onClick={() => openDoc(d.id)}
              onKeyDown={(e) => e.key === 'Enter' && openDoc(d.id)}
              title={view === 'shared' ? `Owned by ${d.ownerName} · ${d.role === 'editor' ? 'can edit' : 'view only'}` : d.title}
            >
              {view === 'shared' ? <Users size={16} /> : <FileText size={16} />}
              <span className="doc-name">
                {d.title}
                {view === 'shared' && <small>{d.ownerName} · {d.role === 'editor' ? 'Can edit' : 'View only'}</small>}
                {view === 'mine' && !!d.shareCount && <small>Shared with {d.shareCount}</small>}
              </span>
              {view === 'mine' && (
                <button
                  className="delete-button"
                  title="Delete document"
                  aria-label={`Delete ${d.title}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteDocument(d.id, d.title)
                  }}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="empty-message">
              {search ? 'No documents match your search.' : view === 'mine' ? 'You have no documents yet.' : 'Nothing has been shared with you yet.'}
            </p>
          )}
        </div>

        <div className="sidebar-footer">
          <div className="avatar">{user.name[0]}</div>
          <div>
            <strong>{user.name}</strong>
            <small>{user.email}</small>
          </div>
          <button className="ai-close logout" title="Sign out" aria-label="Sign out" onClick={onLogout}><LogOut size={16} /></button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            {doc && doc.role !== 'owner' ? 'Shared with me' : 'My documents'} <span>/</span>
            <strong>{doc?.title ?? 'No document selected'}</strong>
          </div>
          {doc && (
            <div className="topbar-actions">
              {canEdit ? (
                <span className={`saved-status ${saveState}`}>{status.icon} {status.text}</span>
              ) : (
                <span className="saved-status readonly"><Eye size={15} /> View only</span>
              )}
              <button className={`share-button ${aiOpen ? 'on' : ''}`} onClick={() => setAiOpen((o) => !o)}>
                <Sparkles size={16} /> AI
              </button>
              <button className="share-button primary" onClick={() => setShareOpen(true)}>
                <Share2 size={16} /> {isOwner ? 'Share' : 'Access'}
              </button>
            </div>
          )}
        </header>

        {notice && (
          <div className={`notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
            {notice.text}
            <button aria-label="Dismiss" onClick={() => setNotice(null)}><X size={14} /></button>
          </div>
        )}

        {saveState === 'conflict' && (
          <div className="notice error" role="alert">
            Someone else saved a newer version of this document. Your latest edits were not saved.
            <button className="text-button" onClick={reloadAfterConflict}>Load latest version</button>
          </div>
        )}

        {doc && editor ? (
          <section className="editor-area">
            <div className="document-heading">
              <div className="title-row">
                {renaming ? (
                  <input
                    className="title-input"
                    value={titleInput}
                    maxLength={200}
                    autoFocus
                    aria-label="Document title"
                    onChange={(e) => setTitleInput(e.target.value)}
                    onBlur={saveTitle}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveTitle()
                      if (e.key === 'Escape') setRenaming(false)
                    }}
                  />
                ) : (
                  <h1 onClick={() => canEdit && (setTitleInput(doc.title), setRenaming(true))}>{doc.title}</h1>
                )}
                {canEdit && !renaming && (
                  <button className="rename-hint" onClick={() => (setTitleInput(doc.title), setRenaming(true))}>Rename</button>
                )}
              </div>
              <div className="document-meta">
                <Clock size={14} /> Last edited {formatDate(doc.updatedAt)}
                <span className="meta-sep">·</span>
                {doc.role === 'owner' ? 'You own this document' : `Owned by ${doc.owner.name} · you ${doc.role === 'editor' ? 'can edit' : 'can view'}`}
              </div>
            </div>

            <div className="toolbar">
              {tool('Undo', false, () => editor.chain().focus().undo().run(), <Undo2 size={17} />)}
              {tool('Redo', false, () => editor.chain().focus().redo().run(), <Redo2 size={17} />)}
              <span className="tool-divider" />
              {tool('Bold (⌘B)', active.bold, () => editor.chain().focus().toggleBold().run(), <Bold size={17} />)}
              {tool('Italic (⌘I)', active.italic, () => editor.chain().focus().toggleItalic().run(), <Italic size={17} />)}
              {tool('Underline (⌘U)', active.underline, () => editor.chain().focus().toggleUnderline().run(), <UnderlineIcon size={17} />)}
              <span className="tool-divider" />
              {tool('Heading 1', active.h1, () => editor.chain().focus().toggleHeading({ level: 1 }).run(), <Heading1 size={18} />)}
              {tool('Heading 2', active.h2, () => editor.chain().focus().toggleHeading({ level: 2 }).run(), <Heading2 size={18} />)}
              {tool('Heading 3', active.h3, () => editor.chain().focus().toggleHeading({ level: 3 }).run(), <Heading3 size={18} />)}
              <span className="tool-divider" />
              {tool('Bulleted list', active.bullet, () => editor.chain().focus().toggleBulletList().run(), <List size={18} />)}
              {tool('Numbered list', active.ordered, () => editor.chain().focus().toggleOrderedList().run(), <ListOrdered size={18} />)}
              <span className="toolbar-spacer" />
              <label className={`upload-button ${importing ? 'disabled' : ''}`} title="Create a new document from a .txt, .md or .docx file (max 2 MB)">
                {importing ? <LoaderCircle size={16} className="spin" /> : <Upload size={16} />} Import file
                <input type="file" accept={SUPPORTED_UPLOADS} hidden disabled={importing} onChange={importFile} />
              </label>
              <span className="upload-hint">.txt · .md · .docx</span>
            </div>

            <div className="page-background">
              <div className={`document-page ${canEdit ? '' : 'readonly'}`}>
                <EditorContent editor={editor} />
              </div>
            </div>
          </section>
        ) : loadingDoc ? (
          <div className="empty-state"><LoaderCircle className="spin" size={28} /></div>
        ) : (
          <div className="empty-state">
            <div className="empty-icon"><FilePlus2 size={34} /></div>
            <h2>Your workspace is ready</h2>
            <p>Create a document or import a .txt, .md, or .docx file to get started.</p>
            <div className="empty-actions">
              <button className="new-button" onClick={createDocument}><Plus size={17} /> Create document</button>
              <label className="upload-button">
                <Upload size={16} /> Import file
                <input type="file" accept={SUPPORTED_UPLOADS} hidden onChange={importFile} />
              </label>
            </div>
          </div>
        )}
      </main>

      {aiOpen && doc && (
        <AIPanel key={doc.id} doc={doc} canEdit={canEdit} flushSave={flushSave} onInsert={insertAIText} onClose={() => setAiOpen(false)} />
      )}

      {shareOpen && doc && <ShareDialog doc={doc} onClose={() => setShareOpen(false)} onChanged={refreshLists} />}
    </div>
  )
}
