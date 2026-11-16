# Architecture note

## Shape of the system

```
Browser (React + TipTap)  ──/api──▶  Express (Node 22)  ──▶  SQLite (node:sqlite)
                                         │
                                         └──▶ Gemini API (optional, server-side key)
```

There's one deployable process. In production Express serves the built React app and the JSON API from the same origin, so there's no CORS setup and a single free web service is enough. In development Vite proxies `/api` to the API server.

## What I prioritized, and why

The brief says depth beats breadth, so I put most of the time into what reviewers will actually click through: **editing, persistence, sharing and import should work correctly end to end.**

1. **Access control lives in one place.** Every document route goes through `loadDoc(req, minRole)`, which resolves the caller's role (`owner > editor > viewer`) and enforces the minimum. Documents you can't see return **404, not 403**, so their existence isn't leaked. Only owners can share, change roles, revoke or delete.
2. **Formatting round-trips exactly.** Content is stored as HTML, which is the editor's native output. It's **sanitized on the server** with an allowlist of the tags the editor can produce, so a shared document can't carry stored XSS to collaborators. A test covers this.
3. **Saves are safe under concurrency.** Real-time collaboration (CRDTs/OT) was out of scope for the timebox, but silent data loss isn't acceptable. Each save sends the `updatedAt` it was based on. A stale save gets **409**, and the UI shows a "load latest version" banner.
4. **Upload is useful as a product feature.** Importing `.txt` / `.md` / `.docx` creates a new editable document. Conversion happens on the server (marked, mammoth), then goes through the same sanitizer. Type and size limits are checked on the client for fast feedback and again on the server.
5. **Autosave is careful.** It's debounced (800 ms), saves pending edits before switching documents or calling the AI, warns before closing the tab with unsaved changes, and keeps failed edits so the next attempt retries them.

## Key decisions and tradeoffs

| Decision | Why | Cost |
| --- | --- | --- |
| SQLite via built-in `node:sqlite` | Zero setup, no native build, real SQL constraints (FKs, `CHECK` on roles, composite PK on shares) | Free hosts have ephemeral disks. The data layer is small and SQL-shaped, so moving to Postgres is a contained change |
| Seeded users + bearer session tokens | Shows ownership and sharing without building sign-up or password reset | Not production auth: no registration, sessions don't expire |
| HTML as the storage format | Exact fidelity with the editor, trivial to render | Needs sanitization (done); harder to diff than structured JSON |
| Last-write detection instead of live co-editing | A correct, small guarantee instead of a half-built real-time system | Two editors can't type at the same moment; the second one is told to reload |
| AI behind a server endpoint, off unless configured | The key stays secret; reviewers never need to pay; the core app doesn't depend on it | Free-tier rate limits |

## Deliberately deprioritized

- Real-time cursors and presence, comments and suggestions, version history.
- Sign-up, password reset, sharing with people who don't have an account yet.
- Importing into an existing draft, and images inside imported .docx files.
- Export to PDF/Markdown.

## What I'd build next (2–4 hours)

1. Postgres (e.g. Neon free tier) behind the same query functions, for durable hosted data.
2. Version history: snapshot on each save, with a "restore" action. The 409 path already identifies conflicts, so the next step is showing a diff.
3. Real-time presence (who else is viewing), using server-sent events.
4. Browser end-to-end tests in CI. I ran a Playwright script locally during development but didn't commit it.
