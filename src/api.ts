// Thin typed client for the CollabDocs API. All requests go to /api (same origin
// in production; proxied by Vite in development).

export type User = { id: number; name: string; email: string }
export type Role = 'owner' | 'editor' | 'viewer'

export type DocSummary = {
  id: number
  title: string
  updatedAt: string
  shareCount?: number
  role?: Exclude<Role, 'owner'>
  ownerName?: string
}

export type Doc = {
  id: number
  title: string
  content: string
  owner: User
  role: Role
  createdAt: string
  updatedAt: string
}

export type Share = User & { role: Exclude<Role, 'owner'> }

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const TOKEN_KEY = 'collabdocs-token'
export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (t: string | null) =>
  t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY)

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')

  let res: Response
  try {
    res = await fetch(`/api${path}`, { ...options, headers })
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection.')
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`)
  return data as T
}

const json = (body: unknown) => JSON.stringify(body)

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>('/auth/login', { method: 'POST', body: json({ email, password }) }),
  me: () => request<{ user: User }>('/auth/me'),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),

  listDocs: () => request<{ owned: DocSummary[]; shared: DocSummary[] }>('/documents'),
  getDoc: (id: number) => request<Doc>(`/documents/${id}`),
  createDoc: () => request<Doc>('/documents', { method: 'POST', body: json({}) }),
  updateDoc: (id: number, patch: { title?: string; content?: string; baseUpdatedAt?: string }) =>
    request<Doc>(`/documents/${id}`, { method: 'PATCH', body: json(patch) }),
  deleteDoc: (id: number) => request<void>(`/documents/${id}`, { method: 'DELETE' }),
  importFile: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<Doc>('/documents/import', { method: 'POST', body: form })
  },

  listShares: (id: number) => request<{ shares: Share[] }>(`/documents/${id}/shares`),
  share: (id: number, email: string, role: Share['role']) =>
    request<{ shares: Share[] }>(`/documents/${id}/shares`, { method: 'POST', body: json({ email, role }) }),
  unshare: (id: number, userId: number) =>
    request<{ shares: Share[] }>(`/documents/${id}/shares/${userId}`, { method: 'DELETE' }),
  listUsers: () => request<{ users: User[] }>('/users'),

  aiStatus: () => request<{ enabled: boolean }>('/ai/status'),
  askAI: (id: number, body: { action?: string; question?: string }) =>
    request<{ text: string }>(`/documents/${id}/ai`, { method: 'POST', body: json(body) }),
}
