# CollabDocs

A lightweight collaborative document editor inspired by Google Docs, built for the Ajaia AI-Native Full Stack Developer assignment.

**Live demo:** https://collabdocs-1w6r.onrender.com (free tier: first load after idle can take ~50s)

## Demo accounts

All accounts use the password **`password123`**. The login screen also has one-click buttons for each account.

| User | Email | Starting state |
| --- | --- | --- |
| Alice Owner | alice@ajaia.test | Owns "Welcome to CollabDocs" |
| Bob Collaborator | bob@ajaia.test | Has **editor** access to Alice's welcome doc |
| Carol Reviewer | carol@ajaia.test | No access yet; share something with her to test viewer access |

### 2-minute review script
1. Sign in as **Alice**. Edit the welcome doc with bold, a heading and a list. "All changes saved" appears, and a refresh keeps everything.
2. Click **New document**, rename it, and type something. Click **Share**, add `carol@ajaia.test` as **Can view**.
3. Click **Import file** and upload a `.md`, `.txt` or `.docx` file. It becomes a new document with its formatting kept.
4. Sign out and sign in as **Carol**. Under **Shared with me** the doc is read-only, and the toolbar and rename are disabled.
5. Sign in as **Bob**. He can edit the welcome doc, but he can't re-share it or delete it.

## Features

- **Documents:** create, rename, delete (owner only), rich-text editing (bold, italic, underline, H1–H3, bulleted/numbered lists, undo/redo), autosave with a save-status indicator, and URL routing (`#/doc/12`) so a refresh reopens the same document.
- **File upload:** import `.txt`, `.md`, or `.docx` (max 2 MB) as a new editable document. Markdown and Word formatting (headings, bold/italic, lists) is kept. Other file types are rejected with a clear message, both in the UI and on the server.
- **Sharing:** each document has an owner, who can grant **editor** or **viewer** access by email, change roles, and revoke access. The sidebar separates **My documents** from **Shared with me** (with owner name and access level). Everyone else gets a 404 for the document, which doesn't reveal that it exists.
- **Persistence:** SQLite on the server. Content is stored as sanitized HTML, so formatting round-trips exactly.
- **Conflict safety:** saves carry the version they were based on. If someone else saved in between, the server returns `409` and the UI offers to load the latest version instead of silently overwriting.
- **AI assistant (optional):** summarize, improve writing, fix grammar, continue writing, or ask questions about the current doc. Editors can insert a response into the document. It runs server-side on Google Gemini's free tier, and if no key is configured the panel says so and everything else works normally.

## Run locally

Requires **Node.js 22.13 or newer** (the server uses Node's built-in `node:sqlite`, so there are no native modules to compile).

```bash
npm install
cp .env.example .env        # optional; only needed for the AI assistant
npm run dev:api             # API on http://localhost:3001
npm run dev                 # in a second terminal: UI on http://localhost:5173
```

Open http://localhost:5173. Vite proxies `/api` to the API server. The database is created at `data/collabdocs.db` and seeded on first start. Delete the `data/` folder to reset.

Production-style run (one process serves both the API and the built UI):

```bash
npm run build && npm start  # http://localhost:3001
```

### Tests

```bash
npm test     # 16 API tests: auth, CRUD, sanitization, sharing/roles, import, AI endpoint, conflicts
npm run lint
```

## Deploy (Render, free)

1. Push this folder to a GitHub repository.
2. On https://render.com, choose **New + → Blueprint** and select the repo (it uses `render.yaml`). Alternatively, create a **Web Service** with build command `npm ci --include=dev && npm run build`, start command `npm start`, and env var `NODE_VERSION=22.13.0`.
3. Optional: add `GEMINI_API_KEY` (a free key from https://aistudio.google.com/apikey) to enable the AI assistant.

**Note on the free plan:** Render's free disk is ephemeral, so the SQLite file resets when the service restarts or redeploys (for example after about 15 minutes idle). Seed data is recreated on every start, so the demo always works, but documents created by reviewers don't survive a restart. For durable hosting, attach a Render persistent disk and set `DB_PATH` to it, or swap the data layer for Postgres (see ARCHITECTURE.md).

## Project layout

```
server/          Express API
  app.js         routes, access control, validation, error handling
  db.js          SQLite schema + seed users/doc
  content.js     HTML sanitization, .txt/.md/.docx → HTML
  ai.js          optional Gemini assistant
src/             React + TypeScript UI (Vite)
  App.tsx        workspace: sidebar, editor, autosave
  api.ts         typed API client
  components/    Login, ShareDialog, AIPanel
tests/           node:test + supertest API tests
```

## Known limitations

- No real-time co-editing. Concurrent edits are detected (409) rather than merged.
- Demo auth only: seeded users with server-side session tokens and no sign-up.
- Import creates a new document. It doesn't merge into an existing draft, and images in .docx files are dropped.
