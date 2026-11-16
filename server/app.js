import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPassword } from './db.js';
import {
  sanitize,
  fileToDocument,
  ImportError,
  MAX_IMPORT_BYTES,
  MAX_CONTENT_BYTES,
  MAX_TITLE_LENGTH,
} from './content.js';
import { aiEnabled, buildPrompt, askAI as defaultAskAI, AI_ACTIONS } from './ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const now = () => new Date().toISOString();

export function createApp(db, { askAI = defaultAskAI } = {}) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMPORT_BYTES } });

  // ---------- helpers ----------

  const q = {
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    userBySession: db.prepare(
      'SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?'
    ),
    doc: db.prepare('SELECT * FROM documents WHERE id = ?'),
    share: db.prepare('SELECT role FROM document_shares WHERE document_id = ? AND user_id = ?'),
  };

  // Returns 'owner' | 'editor' | 'viewer' | null. Central place for access logic.
  function roleFor(doc, userId) {
    if (!doc) return null;
    if (doc.owner_id === userId) return 'owner';
    return q.share.get(doc.id, userId)?.role ?? null;
  }

  // Loads a document and enforces a minimum role. Documents the user cannot see
  // return 404 (not 403) so their existence is not leaked.
  function loadDoc(req, minRole = 'viewer') {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid document id');
    const doc = q.doc.get(id);
    const role = roleFor(doc, req.user.id);
    if (!role) throw new HttpError(404, 'Document not found');
    const rank = { viewer: 1, editor: 2, owner: 3 };
    if (rank[role] < rank[minRole]) {
      throw new HttpError(403, minRole === 'owner' ? 'Only the owner can do that' : 'You have view-only access');
    }
    return { doc, role };
  }

  function validateTitle(title) {
    if (typeof title !== 'string') throw new HttpError(400, 'Title must be a string');
    const t = title.trim();
    if (!t) throw new HttpError(400, 'Title cannot be empty');
    if (t.length > MAX_TITLE_LENGTH) throw new HttpError(400, `Title must be ${MAX_TITLE_LENGTH} characters or fewer`);
    return t;
  }

  function validateContent(content) {
    if (typeof content !== 'string') throw new HttpError(400, 'Content must be a string');
    if (Buffer.byteLength(content) > MAX_CONTENT_BYTES) throw new HttpError(413, 'Document is too large (1 MB limit)');
    return sanitize(content);
  }

  function serializeDoc(doc, role) {
    const owner = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(doc.owner_id);
    return {
      id: doc.id,
      title: doc.title,
      content: doc.content,
      owner,
      role,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
    };
  }

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  function requireAuth(req, _res, next) {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const user = token ? q.userBySession.get(token) : null;
    if (!user) return next(new HttpError(401, 'Please log in'));
    req.user = user;
    req.token = token;
    next();
  }

  // ---------- auth ----------

  app.post('/api/auth/login', (req, res, next) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      return next(new HttpError(400, 'Email and password are required'));
    }
    const user = q.userByEmail.get(email.trim().toLowerCase());
    if (!user || !verifyPassword(password, user.password_hash)) {
      return next(new HttpError(401, 'Invalid email or password'));
    }
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, user.id);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  });

  app.use('/api', (req, res, next) => (req.path === '/health' ? next() : requireAuth(req, res, next)));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.get('/api/auth/me', (req, res) => res.json({ user: req.user }));

  app.post('/api/auth/logout', (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
    res.status(204).end();
  });

  app.get('/api/users', (req, res) => {
    const users = db.prepare('SELECT id, name, email FROM users WHERE id != ? ORDER BY name').all(req.user.id);
    res.json({ users });
  });

  // ---------- documents ----------

  app.get('/api/documents', (req, res) => {
    const owned = db
      .prepare(
        `SELECT d.id, d.title, d.updated_at AS updatedAt,
                (SELECT COUNT(*) FROM document_shares s WHERE s.document_id = d.id) AS shareCount
         FROM documents d WHERE d.owner_id = ? ORDER BY d.updated_at DESC`
      )
      .all(req.user.id);
    const shared = db
      .prepare(
        `SELECT d.id, d.title, d.updated_at AS updatedAt, s.role, u.name AS ownerName
         FROM document_shares s
         JOIN documents d ON d.id = s.document_id
         JOIN users u ON u.id = d.owner_id
         WHERE s.user_id = ? ORDER BY d.updated_at DESC`
      )
      .all(req.user.id);
    res.json({ owned, shared });
  });

  app.post('/api/documents', (req, res) => {
    const body = req.body || {};
    const title = body.title === undefined ? 'Untitled document' : validateTitle(body.title);
    const content = body.content === undefined ? '<p></p>' : validateContent(body.content);
    const ts = now();
    const { lastInsertRowid } = db
      .prepare('INSERT INTO documents (owner_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(req.user.id, title, content, ts, ts);
    res.status(201).json(serializeDoc(q.doc.get(lastInsertRowid), 'owner'));
  });

  app.post(
    '/api/documents/import',
    upload.single('file'),
    wrap(async (req, res) => {
      if (!req.file) throw new HttpError(400, 'Choose a file to upload (field name "file")');
      const { title, content } = await fileToDocument(req.file.originalname, req.file.buffer);
      if (Buffer.byteLength(content) > MAX_CONTENT_BYTES) throw new HttpError(413, 'Imported document is too large');
      const ts = now();
      const { lastInsertRowid } = db
        .prepare('INSERT INTO documents (owner_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.id, title, content, ts, ts);
      res.status(201).json(serializeDoc(q.doc.get(lastInsertRowid), 'owner'));
    })
  );

  app.get('/api/documents/:id', (req, res) => {
    const { doc, role } = loadDoc(req, 'viewer');
    res.json(serializeDoc(doc, role));
  });

  app.patch('/api/documents/:id', (req, res) => {
    const { doc, role } = loadDoc(req, 'editor');
    const body = req.body || {};
    if (body.title === undefined && body.content === undefined) {
      throw new HttpError(400, 'Nothing to update');
    }
    // Optimistic concurrency: if the client says which version it edited and the
    // server has moved on (someone else saved), reject instead of silently overwriting.
    if (body.baseUpdatedAt && body.baseUpdatedAt !== doc.updated_at) {
      throw new HttpError(409, 'This document was changed by someone else. Reload to get the latest version.');
    }
    const title = body.title === undefined ? doc.title : validateTitle(body.title);
    const content = body.content === undefined ? doc.content : validateContent(body.content);
    db.prepare('UPDATE documents SET title = ?, content = ?, updated_at = ? WHERE id = ?').run(
      title,
      content,
      now(),
      doc.id
    );
    res.json(serializeDoc(q.doc.get(doc.id), role));
  });

  app.delete('/api/documents/:id', (req, res) => {
    const { doc } = loadDoc(req, 'owner');
    db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
    res.status(204).end();
  });

  // ---------- sharing ----------

  const listShares = (docId) =>
    db
      .prepare(
        `SELECT u.id, u.name, u.email, s.role FROM document_shares s
         JOIN users u ON u.id = s.user_id WHERE s.document_id = ? ORDER BY u.name`
      )
      .all(docId);

  app.get('/api/documents/:id/shares', (req, res) => {
    const { doc } = loadDoc(req, 'viewer');
    res.json({ shares: listShares(doc.id) });
  });

  app.post('/api/documents/:id/shares', (req, res) => {
    const { doc } = loadDoc(req, 'owner');
    const { email, role = 'editor' } = req.body || {};
    if (typeof email !== 'string' || !email.trim()) throw new HttpError(400, 'Email is required');
    if (!['viewer', 'editor'].includes(role)) throw new HttpError(400, 'Role must be "viewer" or "editor"');
    const target = q.userByEmail.get(email.trim().toLowerCase());
    if (!target) throw new HttpError(404, `No user found with email ${email.trim()}`);
    if (target.id === doc.owner_id) throw new HttpError(400, 'The owner already has full access');
    db.prepare(
      `INSERT INTO document_shares (document_id, user_id, role) VALUES (?, ?, ?)
       ON CONFLICT(document_id, user_id) DO UPDATE SET role = excluded.role`
    ).run(doc.id, target.id, role);
    res.status(201).json({ shares: listShares(doc.id) });
  });

  app.delete('/api/documents/:id/shares/:userId', (req, res) => {
    const { doc } = loadDoc(req, 'owner');
    db.prepare('DELETE FROM document_shares WHERE document_id = ? AND user_id = ?').run(
      doc.id,
      Number(req.params.userId)
    );
    res.json({ shares: listShares(doc.id) });
  });

  // ---------- AI assistant (optional) ----------

  app.get('/api/ai/status', (_req, res) => res.json({ enabled: aiEnabled() }));

  app.post(
    '/api/documents/:id/ai',
    wrap(async (req, res) => {
      const { doc } = loadDoc(req, 'viewer');
      if (!aiEnabled()) throw new HttpError(503, 'The AI assistant is not configured on this server');
      const { action, question } = req.body || {};
      if (action !== undefined && !Object.hasOwn(AI_ACTIONS, action)) throw new HttpError(400, 'Unknown AI action');
      if (action === undefined && (typeof question !== 'string' || !question.trim())) {
        throw new HttpError(400, 'Ask a question or pick an action');
      }
      if (typeof question === 'string' && question.length > 2000) throw new HttpError(400, 'Question is too long');
      const prompt = buildPrompt({ action, question: question?.trim(), title: doc.title, html: doc.content });
      try {
        res.json({ text: await askAI(prompt) });
      } catch (e) {
        throw new HttpError(e.status || 502, e.message || 'The AI service failed to respond');
      }
    })
  );

  // ---------- static client ----------

  const dist = path.resolve(__dirname, '../dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  // ---------- errors ----------

  app.use((err, _req, res, _next) => {
    let status = err.status || 500;
    let message = err.message;
    if (err instanceof multer.MulterError) {
      status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (2 MB limit)' : err.message;
    } else if (err.type === 'entity.parse.failed') {
      status = 400;
      message = 'Malformed JSON body';
    } else if (err.type === 'entity.too.large') {
      status = 413;
      message = 'Request body is too large';
    } else if (!(err instanceof HttpError) && !(err instanceof ImportError)) {
      console.error(err);
      message = 'Something went wrong on our side';
    }
    res.status(status).json({ error: message });
  });

  return app;
}
