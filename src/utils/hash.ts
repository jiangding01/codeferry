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
  // Use a streaming hasher with null-byte separators to eliminate any collision
  // risk from text-based separators that could appear in file content.
  const hasher = createHash('sha256');
  for (const c of contents) {
    hasher.update(c, 'utf8');
    hasher.update('\0'); // null byte cannot appear in text source files
  }
  return hasher.digest('hex');
}
