import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { detectStack } from '../src/core/stack-detector.js';

const CODE_FIXTURES = join(import.meta.dirname, 'fixtures', 'mini-code');

describe('detectStack', () => {
  it('detects Next.js from package.json', async () => {
    const info = await detectStack(CODE_FIXTURES);
    expect(info.framework).toBeDefined();
    expect(info.framework!.value).toContain('Next.js');
    expect(info.framework!.confidence).toBe('high');
  });

  it('detects TypeScript from tsconfig.json', async () => {
    const info = await detectStack(CODE_FIXTURES);
    expect(info.language).toBeDefined();
    expect(info.language!.value).toBe('TypeScript');
    expect(info.language!.confidence).toBe('high');
  });

  it('generates design-to-code hints', async () => {
    const info = await detectStack(CODE_FIXTURES);
    expect(info.designToCodeHints.length).toBeGreaterThan(0);
    expect(info.designToCodeHints.some((h) => h.includes('TypeScript'))).toBe(true);
  });

  it('generates code-to-design hints', async () => {
    const info = await detectStack(CODE_FIXTURES);
    expect(info.codeToDesignHints.length).toBeGreaterThan(0);
    expect(info.codeToDesignHints.some((h) => h.includes('TypeScript'))).toBe(true);
  });
});
