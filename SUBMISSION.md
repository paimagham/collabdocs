# Submission: CollabDocs

**Candidate:** Saibhavitha Reddy Paimagham
**Live app:** <add Render URL>
**Walkthrough video:** see `VIDEO_URL.txt`
**Test accounts:** alice@ajaia.test, bob@ajaia.test, carol@ajaia.test (password: `password123`)

## Included
| Item | Location |
| --- | --- |
| Source code (React + TypeScript UI, Express API) | `src/`, `server/` |
| Local setup & run instructions | `README.md` |
| Architecture note | `ARCHITECTURE.md` |
| AI workflow note | `AI_WORKFLOW.md` |
| Automated tests (16 API tests) | `tests/` (`npm test`) |
| Deployment config | `render.yaml`, `.env.example` |
| Walkthrough video link | `VIDEO_URL.txt` |
| Screenshots | `screenshots/` |

## Status
**Working end to end:** login with seeded users; create/rename/edit/delete documents; rich text (bold, italic, underline, H1–H3, lists, undo/redo); autosave and reopen with formatting kept; import of .txt/.md/.docx as new documents; sharing with editor/viewer roles, role changes and revoke; owned vs. shared views; conflict detection on concurrent saves; optional AI assistant.

**Incomplete / intentionally out of scope:** real-time co-editing and presence, comments, version history, export, sign-up, durable storage on the free hosting tier (SQLite resets when the free instance restarts; seed data is recreated).

**Next 2–4 hours:** Postgres for durable hosted data, version history with restore, presence indicators, Playwright tests in CI.
