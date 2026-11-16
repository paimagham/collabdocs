// Optional AI writing assistant. Runs server-side so the API key never reaches
// the browser. Uses Google Gemini's free tier; if GEMINI_API_KEY is not set the
// feature reports itself as disabled and the rest of the app works normally.

const MAX_DOC_CHARS = 12000;

export const AI_ACTIONS = {
  summarize: 'Summarize this document in 3-5 concise bullet points.',
  improve: 'Rewrite the document to be clearer and more concise. Keep the meaning and structure. Return only the rewritten text.',
  grammar: 'Fix spelling and grammar mistakes in the document. Return only the corrected text.',
  continue: 'Continue writing the document with one or two natural next paragraphs in the same tone. Return only the new text.',
};

export function aiEnabled() {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function htmlToPlainText(html) {
  return String(html)
    .replace(/<\/(p|h[1-6]|li|blockquote|pre)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildPrompt({ action, question, title, html }) {
  const text = htmlToPlainText(html).slice(0, MAX_DOC_CHARS);
  const task = action ? AI_ACTIONS[action] : `Answer the user's request about the document: ${question}`;
  return [
    'You are a writing assistant inside a document editor. Be concise. Use plain text, no markdown headings.',
    `Task: ${task}`,
    `Document title: ${title}`,
    '--- DOCUMENT START ---',
    text || '(the document is empty)',
    '--- DOCUMENT END ---',
  ].join('\n');
}

export async function askAI(prompt, fetchImpl = fetch) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('Gemini error', res.status, detail.slice(0, 500));
    const err = new Error(res.status === 429 ? 'AI rate limit reached, try again in a minute' : 'The AI service failed to respond');
    err.status = 502;
    throw err;
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  if (!text.trim()) {
    const err = new Error('The AI returned an empty response');
    err.status = 502;
    throw err;
  }
  return text.trim();
}
