import fs from 'node:fs/promises';
import path from 'node:path';

export const supportedExtensions = new Set(['.txt', '.md', '.markdown', '.html', '.htm', '.csv', '.json', '.pdf', '.docx']);

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = await fs.readFile(filePath);

  if (['.txt', '.md', '.markdown', '.csv', '.json'].includes(ext)) {
    return normalizeText(buffer.toString('utf8'));
  }

  if (['.html', '.htm'].includes(ext)) {
    return normalizeText(buffer.toString('utf8').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
  }

  if (ext === '.pdf') {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    try {
      const parsed = await parser.getText();
      return normalizeText(parsed.text ?? '');
    } finally {
      await parser.destroy();
    }
  }

  if (ext === '.docx') {
    const mammoth = await import('mammoth');
    const parsed = await mammoth.extractRawText({ buffer });
    return normalizeText(parsed.value ?? '');
  }

  return '';
}

export function chunkText(text: string, maxChars: number, overlapChars: number): string[] {
  const clean = normalizeText(text);
  if (!clean) return [];

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < clean.length) {
    let end = Math.min(cursor + maxChars, clean.length);

    if (end < clean.length) {
      const paragraphBreak = clean.lastIndexOf('\n\n', end);
      const sentenceBreak = Math.max(clean.lastIndexOf('.', end), clean.lastIndexOf('؟', end), clean.lastIndexOf('!', end));
      const breakPoint = paragraphBreak > cursor + maxChars * 0.55 ? paragraphBreak : sentenceBreak;
      if (breakPoint > cursor + maxChars * 0.45) end = breakPoint + 1;
    }

    const chunk = clean.slice(cursor, end).trim();
    if (chunk.length > 50) chunks.push(chunk);

    if (end >= clean.length) break;
    cursor = Math.max(0, end - overlapChars);
  }

  return chunks;
}
