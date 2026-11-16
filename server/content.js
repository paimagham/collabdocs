// Content handling: HTML sanitization and file -> HTML conversion for imports.
import sanitizeHtml from 'sanitize-html';
import { marked } from 'marked';
import mammoth from 'mammoth';
import path from 'node:path';

export const SUPPORTED_IMPORT_TYPES = ['.txt', '.md', '.docx'];
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_CONTENT_BYTES = 1024 * 1024; // 1 MB of stored HTML
export const MAX_TITLE_LENGTH = 200;

// Only the tags the editor can actually produce are allowed through. Anything
// else (scripts, styles, event handlers, iframes) is stripped server-side, so
// stored content is safe to render for every user the doc is shared with.
const SANITIZE_OPTIONS = {
  allowedTags: [
    'p', 'br', 'h1', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'u', 's',
    'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'hr', 'a',
  ],
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }),
  },
};

export function sanitize(html) {
  return sanitizeHtml(String(html ?? ''), SANITIZE_OPTIONS);
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function textToHtml(text) {
  // Blank lines separate paragraphs; single newlines become <br>.
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export class ImportError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function fileToDocument(originalName, buffer) {
  const ext = path.extname(originalName || '').toLowerCase();
  if (!SUPPORTED_IMPORT_TYPES.includes(ext)) {
    throw new ImportError(
      `Unsupported file type "${ext || 'none'}". Supported: ${SUPPORTED_IMPORT_TYPES.join(', ')}`,
      415
    );
  }

  let html;
  if (ext === '.txt') {
    html = textToHtml(buffer.toString('utf8'));
  } else if (ext === '.md') {
    html = await marked.parse(buffer.toString('utf8'));
  } else {
    try {
      const result = await mammoth.convertToHtml({ buffer });
      html = result.value;
    } catch {
      throw new ImportError('Could not read this .docx file. Is it a valid Word document?');
    }
  }

  const title = path.basename(originalName, ext).trim().slice(0, MAX_TITLE_LENGTH) || 'Imported document';
  return { title, content: sanitize(html) || '<p></p>' };
}
