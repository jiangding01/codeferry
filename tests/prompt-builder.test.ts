/**
 * Tests for src/output/prompt-builder.ts
 *
 * Validates that buildSyncPrompt produces correctly structured Markdown prompts,
 * with special focus on the design-to-code vs code-to-design direction swap bug
 * that was identified and fixed in the Phase 3 code review.
 */

import { describe, it, expect } from 'vitest';
import { buildSyncPrompt, buildPromptFilename } from '../src/output/prompt-builder.js';
import type { PromptContext } from '../src/output/prompt-builder.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const ENTRY = {
  id: 'extras.jsx::AccountPage',
  name: 'AccountPage',
  designFile: 'extras.jsx',
  designStartLine: 3,
  designEndLine: 162,
  designHash: 'abc123',
  codeFiles: ['src/app/account/page.tsx'],
  codeHash: 'def456',
  mappingType: 'auto' as const,
  mappingConfidence: 0.95,
  lastSyncedAt: null,
  designHashAtSync: null,
  codeHashAtSync: null,
  kind: 'page' as const,
};

const CONFIG = {
  version: '2.0' as const,
  design: { root: '/design', include: ['**/*.jsx'], exclude: [] },
  code: { root: '/code', include: ['**/*.tsx'], exclude: [] },
  ai: { model: 'claude-haiku-4-5', batchSize: 5, maxConcurrency: 3 },
};

const DESIGN_CONTENT = `function AccountPage() {
  return (
    <div style={{ color: 'red' }}>
      <h1>账户设置</h1>
    </div>
  );
}`;

const CODE_CONTENT = `export default function AccountPage() {
  return (
    <div className="text-red-500">
      <h1>账户设置</h1>
    </div>
  );
}`;

function makeCtx(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    entry: ENTRY,
    direction: 'design-to-code',
    designContent: DESIGN_CONTENT,
    codeContent: CODE_CONTENT,
    status: 'design-ahead',
    config: CONFIG,
    stackInfo: null,
    analysis: null,
    ...overrides,
  };
}

// ── buildSyncPrompt ───────────────────────────────────────────────────────────

describe('buildSyncPrompt', () => {
  it('contains component name in header', () => {
    const prompt = buildSyncPrompt(makeCtx());
    expect(prompt).toContain('AccountPage');
    expect(prompt).toContain('drift-cli 同步任务');
  });

  it('design-to-code: places designContent under "设计稿当前内容"', () => {
    const prompt = buildSyncPrompt(makeCtx({ direction: 'design-to-code' }));

    const designSection = prompt.indexOf('设计稿当前内容');
    const codeSection = prompt.indexOf('代码实现当前实现');

    // Design section should appear first
    expect(designSection).toBeGreaterThanOrEqual(0);
    expect(codeSection).toBeGreaterThanOrEqual(0);
    expect(designSection).toBeLessThan(codeSection);

    // Design content should appear in the design section
    const designIdx = prompt.indexOf('color: \'red\'');
    expect(designIdx).toBeGreaterThan(designSection);
    expect(designIdx).toBeLessThan(codeSection);

    // Code content (className) should appear after the design section
    const codeIdx = prompt.indexOf('text-red-500');
    expect(codeIdx).toBeGreaterThan(designSection);
  });

  it('code-to-design: places codeContent under "代码当前内容", designContent under "设计稿当前实现"', () => {
    const prompt = buildSyncPrompt(makeCtx({ direction: 'code-to-design' }));

    const codeSourceSection = prompt.indexOf('代码当前内容');
    const designTargetSection = prompt.indexOf('设计稿当前实现');

    expect(codeSourceSection).toBeGreaterThanOrEqual(0);
    expect(designTargetSection).toBeGreaterThanOrEqual(0);

    // Code content (className) should appear in the code source section
    const classNameIdx = prompt.indexOf('text-red-500');
    expect(classNameIdx).toBeGreaterThan(codeSourceSection);
    expect(classNameIdx).toBeLessThan(designTargetSection);

    // Design content (inline style) should appear in the design target section
    const inlineStyleIdx = prompt.indexOf('color: \'red\'');
    expect(inlineStyleIdx).toBeGreaterThan(designTargetSection);
  });

  it('code-to-design: uses tsx as source language, jsx as target language', () => {
    const prompt = buildSyncPrompt(makeCtx({ direction: 'code-to-design' }));
    // First code fence should be tsx (source = code)
    const firstFenceIdx = prompt.indexOf('```tsx');
    const secondFenceIdx = prompt.indexOf('```jsx');
    expect(firstFenceIdx).toBeGreaterThanOrEqual(0);
    expect(secondFenceIdx).toBeGreaterThanOrEqual(0);
    expect(firstFenceIdx).toBeLessThan(secondFenceIdx);
  });

  it('design-to-code: uses jsx as source language, tsx as target language', () => {
    const prompt = buildSyncPrompt(makeCtx({ direction: 'design-to-code' }));
    const firstFenceIdx = prompt.indexOf('```jsx');
    const secondFenceIdx = prompt.indexOf('```tsx');
    expect(firstFenceIdx).toBeGreaterThanOrEqual(0);
    expect(secondFenceIdx).toBeGreaterThanOrEqual(0);
    expect(firstFenceIdx).toBeLessThan(secondFenceIdx);
  });

  it('includes AI analysis when provided', () => {
    const analysis = {
      componentId: ENTRY.id,
      intent: 'style-change' as const,
      summary: '将主色调改为品牌蓝色',
      impact: 'low' as const,
      syncGuide: ['更新 Tailwind 颜色类', '检查暗色模式兼容性'],
    };
    const prompt = buildSyncPrompt(makeCtx({ analysis }));

    expect(prompt).toContain('样式调整');
    expect(prompt).toContain('将主色调改为品牌蓝色');
    expect(prompt).toContain('更新 Tailwind 颜色类');
    expect(prompt).toContain('检查暗色模式兼容性');
  });

  it('shows "待分析" when no analysis is provided', () => {
    const prompt = buildSyncPrompt(makeCtx({ analysis: null }));
    expect(prompt).toContain('待分析');
  });

  it('shows config.project.stack when stackInfo has no detected fields', () => {
    const configWithStack = {
      ...CONFIG,
      project: { stack: 'Next.js 15 + Tailwind + TypeScript' },
    };
    const prompt = buildSyncPrompt(makeCtx({ config: configWithStack, stackInfo: null }));
    expect(prompt).toContain('Next.js 15 + Tailwind + TypeScript');
  });

  it('shows conventions from config', () => {
    const configWithConventions = {
      ...CONFIG,
      project: {
        stack: 'Next.js',
        conventions: ['使用 CSS Modules', '组件按 feature 分组'],
      },
    };
    const prompt = buildSyncPrompt(makeCtx({ config: configWithConventions, stackInfo: null }));
    expect(prompt).toContain('使用 CSS Modules');
    expect(prompt).toContain('组件按 feature 分组');
  });

  it('shows generic fallback message when no project context configured', () => {
    const prompt = buildSyncPrompt(makeCtx());
    expect(prompt).toContain('未配置');
  });

  it('shows "（尚无代码实现）" when codeContent is empty and direction is design-to-code', () => {
    const prompt = buildSyncPrompt(makeCtx({ codeContent: '' }));
    expect(prompt).toContain('尚无代码实现');
  });

  it('shows "（尚无设计稿内容）" when designContent is empty and direction is code-to-design', () => {
    const prompt = buildSyncPrompt(makeCtx({ direction: 'code-to-design', designContent: '' }));
    expect(prompt).toContain('尚无设计稿内容');
  });

  it('includes the target code file path in overview', () => {
    const prompt = buildSyncPrompt(makeCtx());
    expect(prompt).toContain('src/app/account/page.tsx');
  });

  it('shows design line range in overview', () => {
    const prompt = buildSyncPrompt(makeCtx());
    expect(prompt).toContain('extras.jsx:3-162');
  });

  it('includes design-to-code conversion hints when no stack info', () => {
    const prompt = buildSyncPrompt(makeCtx({ direction: 'design-to-code' }));
    expect(prompt).toContain('import 语句');
  });

  it('includes code-to-design conversion hints when no stack info', () => {
    const prompt = buildSyncPrompt(makeCtx({ direction: 'code-to-design' }));
    expect(prompt).toContain('plain JSX');
  });

  it('includes 注意事项 footer', () => {
    const prompt = buildSyncPrompt(makeCtx());
    expect(prompt).toContain('注意事项');
    expect(prompt).toContain('只同步意图');
    expect(prompt).toContain('drift snapshot');
  });
});

// ── buildPromptFilename ───────────────────────────────────────────────────────

describe('buildPromptFilename', () => {
  it('generates correct filename for design-to-code', () => {
    const filename = buildPromptFilename(ENTRY, 'design-to-code');
    expect(filename).toMatch(/^AccountPage_d2c_\d{4}-\d{2}-\d{2}\.md$/);
  });

  it('generates correct filename for code-to-design', () => {
    const filename = buildPromptFilename(ENTRY, 'code-to-design');
    expect(filename).toMatch(/^AccountPage_c2d_\d{4}-\d{2}-\d{2}\.md$/);
  });

  it('sanitizes special characters in component name', () => {
    const entryWithSpecialChars = { ...ENTRY, name: 'My/Component:Test' };
    const filename = buildPromptFilename(entryWithSpecialChars, 'design-to-code');
    expect(filename).not.toContain('/');
    expect(filename).not.toContain(':');
    expect(filename).toMatch(/\.md$/);
  });
});
