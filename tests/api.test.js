// API tests: run with `npm test`. Each test file gets a fresh in-memory database.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';

const app = createApp(openDb(':memory:'));

async function login(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'password123' });
  assert.equal(res.status, 200);
  return { Authorization: `Bearer ${res.body.token}` };
}

let alice, bob, carol;
before(async () => {
  alice = await login('alice@ajaia.test');
  bob = await login('bob@ajaia.test');
  carol = await login('carol@ajaia.test');
});

describe('auth', () => {
  test('rejects bad credentials and unauthenticated requests', async () => {
    const bad = await request(app).post('/api/auth/login').send({ email: 'alice@ajaia.test', password: 'nope' });
    assert.equal(bad.status, 401);
    const anon = await request(app).get('/api/documents');
    assert.equal(anon.status, 401);
  });
});

describe('documents', () => {
  test('create, rename, edit, and reopen preserves formatting', async () => {
    const created = await request(app).post('/api/documents').set(alice).send({});
    assert.equal(created.status, 201);
    assert.equal(created.body.title, 'Untitled document');
    const id = created.body.id;

    const html = '<h2>Plan</h2><p><strong>Bold</strong> <em>it</em> <u>under</u></p><ul><li><p>one</p></li></ul>';
    const saved = await request(app).patch(`/api/documents/${id}`).set(alice).send({ title: 'Q3 Plan', content: html });
    assert.equal(saved.status, 200);

    const reopened = await request(app).get(`/api/documents/${id}`).set(alice);
    assert.equal(reopened.body.title, 'Q3 Plan');
    assert.equal(reopened.body.content, html);
  });

  test('strips unsafe HTML before storing', async () => {
    const res = await request(app)
      .post('/api/documents')
      .set(alice)
      .send({ title: 'XSS', content: '<p onclick="x()">hi</p><script>alert(1)</script><img src=x onerror=alert(1)>' });
    assert.equal(res.body.content, '<p>hi</p>');
  });

  test('validates title', async () => {
    const res = await request(app).post('/api/documents').set(alice).send({ title: '   ' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /empty/);
  });

  test('rejects stale saves with 409 instead of overwriting', async () => {
    const { body: doc } = await request(app).post('/api/documents').set(alice).send({ title: 'Race' });
    const first = await request(app)
      .patch(`/api/documents/${doc.id}`)
      .set(alice)
      .send({ content: '<p>v2</p>', baseUpdatedAt: doc.updatedAt });
    assert.equal(first.status, 200);
    const stale = await request(app)
      .patch(`/api/documents/${doc.id}`)
      .set(alice)
      .send({ content: '<p>stale</p>', baseUpdatedAt: doc.updatedAt });
    assert.equal(stale.status, 409);
  });
});

describe('sharing and access control', () => {
  let docId;
  before(async () => {
    const res = await request(app).post('/api/documents').set(alice).send({ title: 'Private notes' });
    docId = res.body.id;
  });

  test('non-shared users cannot see or edit the document', async () => {
    assert.equal((await request(app).get(`/api/documents/${docId}`).set(bob)).status, 404);
    assert.equal((await request(app).patch(`/api/documents/${docId}`).set(bob).send({ title: 'x' })).status, 404);
  });

  test('owner shares as viewer: doc appears under "shared", read-only', async () => {
    const share = await request(app)
      .post(`/api/documents/${docId}/shares`)
      .set(alice)
      .send({ email: 'bob@ajaia.test', role: 'viewer' });
    assert.equal(share.status, 201);

    const list = await request(app).get('/api/documents').set(bob);
    const entry = list.body.shared.find((d) => d.id === docId);
    assert.ok(entry, 'doc should be in Bob\'s shared list');
    assert.equal(entry.role, 'viewer');
    assert.equal(entry.ownerName, 'Alice Owner');
    assert.ok(!list.body.owned.some((d) => d.id === docId));

    assert.equal((await request(app).get(`/api/documents/${docId}`).set(bob)).status, 200);
    assert.equal((await request(app).patch(`/api/documents/${docId}`).set(bob).send({ title: 'x' })).status, 403);
  });

  test('upgrading to editor allows edits, but not re-sharing or deleting', async () => {
    await request(app).post(`/api/documents/${docId}/shares`).set(alice).send({ email: 'bob@ajaia.test', role: 'editor' });
    const edit = await request(app).patch(`/api/documents/${docId}`).set(bob).send({ content: '<p>Bob was here</p>' });
    assert.equal(edit.status, 200);

    const reshare = await request(app).post(`/api/documents/${docId}/shares`).set(bob).send({ email: 'carol@ajaia.test' });
    assert.equal(reshare.status, 403);
    assert.equal((await request(app).delete(`/api/documents/${docId}`).set(bob)).status, 403);
    assert.equal((await request(app).get(`/api/documents/${docId}`).set(carol)).status, 404);
  });

  test('sharing with an unknown user or the owner fails clearly', async () => {
    const unknown = await request(app).post(`/api/documents/${docId}/shares`).set(alice).send({ email: 'nobody@x.com' });
    assert.equal(unknown.status, 404);
    const self = await request(app).post(`/api/documents/${docId}/shares`).set(alice).send({ email: 'alice@ajaia.test' });
    assert.equal(self.status, 400);
  });

  test('revoking access removes it', async () => {
    const { body: me } = await request(app).get('/api/auth/me').set(bob);
    const res = await request(app).delete(`/api/documents/${docId}/shares/${me.user.id}`).set(alice);
    assert.equal(res.status, 200);
    assert.equal((await request(app).get(`/api/documents/${docId}`).set(bob)).status, 404);
  });
});

describe('file import', () => {
  test('imports markdown into a new formatted document', async () => {
    const md = '# Meeting notes\n\nSome **bold** text.\n\n- first\n- second\n';
    const res = await request(app)
      .post('/api/documents/import')
      .set(alice)
      .attach('file', Buffer.from(md), 'meeting-notes.md');
    assert.equal(res.status, 201);
    assert.equal(res.body.title, 'meeting-notes');
    assert.match(res.body.content, /<h1>Meeting notes<\/h1>/);
    assert.match(res.body.content, /<strong>bold<\/strong>/);
    assert.match(res.body.content, /<li>first<\/li>/);
  });

  test('imports plain text as paragraphs', async () => {
    const res = await request(app)
      .post('/api/documents/import')
      .set(alice)
      .attach('file', Buffer.from('Line one\n\nLine <two>'), 'notes.txt');
    assert.equal(res.status, 201);
    assert.equal(res.body.content, '<p>Line one</p><p>Line &lt;two&gt;</p>');
  });

  test('rejects unsupported file types', async () => {
    const res = await request(app)
      .post('/api/documents/import')
      .set(alice)
      .attach('file', Buffer.from('%PDF-1.4'), 'report.pdf');
    assert.equal(res.status, 415);
    assert.match(res.body.error, /Supported: \.txt, \.md, \.docx/);
  });
});
