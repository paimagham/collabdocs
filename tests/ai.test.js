// AI assistant tests use a fake model so they run offline and for free.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { htmlToPlainText } from '../server/ai.js';

const prompts = [];
const app = createApp(openDb(':memory:'), {
  askAI: async (prompt) => {
    prompts.push(prompt);
    return 'fake summary';
  },
});

async function login(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'password123' });
  return { Authorization: `Bearer ${res.body.token}` };
}

test('AI is reported disabled and refuses requests without an API key', async () => {
  delete process.env.GEMINI_API_KEY;
  const alice = await login('alice@ajaia.test');
  assert.deepEqual((await request(app).get('/api/ai/status').set(alice)).body, { enabled: false });
  const res = await request(app).post('/api/documents/1/ai').set(alice).send({ action: 'summarize' });
  assert.equal(res.status, 503);
});

test('AI uses the document text and respects access control', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  const alice = await login('alice@ajaia.test');
  const carol = await login('carol@ajaia.test');
  const { body: doc } = await request(app)
    .post('/api/documents')
    .set(alice)
    .send({ title: 'Roadmap', content: '<h1>Q3</h1><p>Ship <strong>sharing</strong></p>' });

  const ok = await request(app).post(`/api/documents/${doc.id}/ai`).set(alice).send({ action: 'summarize' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.text, 'fake summary');
  assert.match(prompts.at(-1), /Q3\nShip sharing/);

  const bad = await request(app).post(`/api/documents/${doc.id}/ai`).set(alice).send({ action: 'hack' });
  assert.equal(bad.status, 400);
  const forbidden = await request(app).post(`/api/documents/${doc.id}/ai`).set(carol).send({ action: 'summarize' });
  assert.equal(forbidden.status, 404);
  delete process.env.GEMINI_API_KEY;
});

test('htmlToPlainText keeps structure readable', () => {
  assert.equal(htmlToPlainText('<h2>A</h2><ul><li>x &amp; y</li></ul>'), 'A\n- x & y');
});
