# AI workflow note

## Tools used
- **Claude (Anthropic)** as a pair programmer: reviewing my first version, building the backend, wiring the React UI to it, writing tests and drafting docs.
- **Google Gemini** as the model behind the in-app AI assistant feature.
- <!-- EDIT: add any other tools you used, e.g. GitHub Copilot in VS Code for the initial UI -->

## Where AI materially sped things up
- **Gap analysis.** My first version was a polished UI that stored everything in `localStorage`. An AI review against the brief quickly showed what that meant: no backend, no real sharing, no persistence across browsers. Those are the core requirements, so I re-planned around them.
- **Boilerplate with clear specs.** The Express routes, SQLite schema, typed API client and share dialog were generated from a spec I wrote (roles, status codes, validation rules), then reviewed.
- **Test scaffolding.** The supertest suite was drafted quickly, and I adjusted the assertions to the behavior I actually wanted (for example, a 404 rather than a 403 for docs you can't see).

## AI output I changed or rejected
- **Rejected client-only storage.** It looked "done" but couldn't demonstrate sharing or persistence across users.
- **Rejected letting the AI feature drive the scope.** The brief doesn't ask for AI, and requiring a paid key would break the "reviewers don't pay" constraint. It's optional, server-side, and the app works fully without it.
- **Fixed a spurious-save bug.** The generated code called `editor.setEditable(...)`, which emits an update event in TipTap, so every document open triggered a save and bumped "last edited". Changed to `setEditable(x, false)`.
- **Removed a duplicate extension.** TipTap v3's StarterKit already includes Underline, so registering it separately caused a duplicate-extension warning.
- **Fixed layout and italics.** The leftover Vite template CSS centered all editor text and squeezed the layout. A global `font-synthesis: none` made italic text render upright. Both were caught by looking at screenshots, not by tests.
- **Tightened security defaults.** Server-side HTML sanitization with an allowlist (not trusting the client), the AI key kept server-side only, and file type/size checks on the server as well as in the UI.

## How I verified correctness and quality
- **Automated API tests (16)** cover auth, create/rename/edit/reopen with formatting preserved, XSS stripping, title validation, 409 on stale saves, viewer vs. editor vs. owner permissions, revoke, unknown-user sharing, .md/.txt import, unsupported types, and the AI endpoint (with a fake model, so tests are free and offline).
- **End-to-end browser run** (Playwright, local): Alice edits and the edit survives a reload, she creates and renames a doc, shares it with Carol as viewer, and imports a .md file; Carol sees it read-only under "Shared with me"; Bob edits as an editor. No console errors.
- **Manual UX pass** on screenshots of each state: login, share dialog, import notice, view-only mode, AI panel without a key.
- `tsc`, ESLint (React Hooks rules) and a production build all pass.
