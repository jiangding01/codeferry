import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath, 'utf8');
  return hashContent(content);
}

export function hashMultiple(contents: string[]): string {
  const combined = contents.join('\n---drift-separator---\n');
  return hashContent(combined);
}
