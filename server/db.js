// SQLite persistence using Node's built-in driver (node:sqlite, Node >= 22.13).
// No native build step, so it deploys cleanly on any Node 22 host.
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SEED_USERS = [
  { email: 'alice@ajaia.test', name: 'Alice Owner' },
  { email: 'bob@ajaia.test', name: 'Bob Collaborator' },
  { email: 'carol@ajaia.test', name: 'Carol Reviewer' },
];
export const SEED_PASSWORD = 'password123';

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 32);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

export function openDb(file = process.env.DB_PATH || path.resolve('data/collabdocs.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS document_shares (
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (document_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id);
    CREATE INDEX IF NOT EXISTS idx_shares_user ON document_shares(user_id);
  `);
  seed(db);
  return db;
}

function seed(db) {
  const exists = db.prepare('SELECT 1 FROM users WHERE email = ?');
  const insert = db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)');
  for (const u of SEED_USERS) {
    if (!exists.get(u.email)) insert.run(u.email, u.name, hashPassword(SEED_PASSWORD));
  }

  // One welcome document owned by Alice and shared with Bob, so the sharing
  // flow is demonstrable the moment a reviewer logs in.
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM documents').get();
  if (n === 0) {
    const alice = db.prepare('SELECT id FROM users WHERE email = ?').get('alice@ajaia.test');
    const bob = db.prepare('SELECT id FROM users WHERE email = ?').get('bob@ajaia.test');
    const html =
      '<h1>Welcome to CollabDocs</h1>' +
      '<p>This document is owned by <strong>Alice</strong> and shared with <em>Bob</em> as an editor.</p>' +
      '<h2>Try it out</h2>' +
      '<ul><li><p>Format text with <u>underline</u>, bold, italic</p></li><li><p>Use headings and lists</p></li></ul>' +
      '<ol><li><p>Log in as Bob to see this under "Shared with me"</p></li><li><p>Log in as Carol to confirm she cannot open it</p></li></ol>';
    const { lastInsertRowid } = db
      .prepare('INSERT INTO documents (owner_id, title, content) VALUES (?, ?, ?)')
      .run(alice.id, 'Welcome to CollabDocs', html);
    db.prepare('INSERT INTO document_shares (document_id, user_id, role) VALUES (?, ?, ?)').run(
      lastInsertRowid,
      bob.id,
      'editor'
    );
  }
}
