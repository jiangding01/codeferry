/**
 * Tests for src/core/analyzer.ts
 *
 * We test the pure/internal logic (response parsing, truncation, default results)
 * without calling the actual Claude API. The exported analyzeComponents function
 * is tested with a mocked Anthropic client.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';

// ── Mock Anthropic SDK at module scope ────────────────────────────────────────
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(),
}));

const MockAnthropic = vi.mocked(Anthropic);

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_ENTRY = {
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

const MOCK_CONFIG = {
  version: '2.0' as const,
  design: { root: '/design', include: ['**/*.jsx'], exclude: [] },
  code: { root: '/code', include: ['**/*.tsx'], exclude: [] },
  ai: { model: 'claude-haiku-4-5', batchSize: 5, maxConcurrency: 3 },
};

function makeInput(overrides: Partial<{ designContent: string; codeContent: string }> = {}) {
  return {
    entry: MOCK_ENTRY,
    status: 'design-ahead' as const,
    designContent: overrides.designContent ?? 'function A() { return <div />; }',
    codeContent: overrides.codeContent ?? 'export default function A() { return <div />; }',
  };
}

function mockApiResponse(text: string) {
  const create = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text }],
  });
  MockAnthropic.mockImplementation(() => ({ messages: { create } } as unknown as Anthropic));
  return create;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('analyzeComponents', () => {
  const originalKey = process.env['ANTHROPIC_API_KEY'];

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['ANTHROPIC_API_KEY'];
  });

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env['ANTHROPIC_API_KEY'] = originalKey;
    } else {
      delete process.env['ANTHROPIC_API_KEY'];
    }
  });

  it('returns empty map for empty input', async () => {
    const { analyzeComponents } = await import('../src/core/analyzer.js');
    const result = await analyzeComponents([], MOCK_CONFIG);
    expect(result.size).toBe(0);
  });

  it('returns fallback results when ANTHROPIC_API_KEY is not set', async () => {
    const { analyzeComponents } = await import('../src/core/analyzer.js');
    const result = await analyzeComponents([makeInput()], MOCK_CONFIG);

    expect(result.size).toBe(1);
    const r = result.get(MOCK_ENTRY.id)!;
    expect(r.componentId).toBe(MOCK_ENTRY.id);
    expect(r.analysisNote).toContain('ANTHROPIC_API_KEY');
  });

  it('returns valid result when API responds with correct JSON', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    mockApiResponse(JSON.stringify({
      intent: 'style-change',
      summary: '将主色调从红色改为蓝色',
      impact: 'low',
      syncGuide: ['更新代码侧 Tailwind 颜色类', '测试各浅色/深色模式'],
    }));

    const { analyzeComponents } = await import('../src/core/analyzer.js');
    const result = await analyzeComponents([makeInput()], MOCK_CONFIG);

    expect(result.size).toBe(1);
    const r = result.get(MOCK_ENTRY.id)!;
    expect(r.intent).toBe('style-change');
    expect(r.impact).toBe('low');
    expect(r.summary).toBe('将主色调从红色改为蓝色');
    expect(r.syncGuide).toHaveLength(2);
  });

  it('falls back gracefully when API responds with invalid JSON', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    mockApiResponse('not valid json at all');

    const { analyzeComponents } = await import('../src/core/analyzer.js');
    const result = await analyzeComponents([makeInput()], MOCK_CONFIG);

    const r = result.get(MOCK_ENTRY.id)!;
    // Should have a valid fallback intent
    const VALID_INTENTS = [
      'feature-add', 'style-change', 'interaction-change', 'layout-change',
      'refactor', 'props-change', 'logic-change', 'content-change',
    ];
    expect(VALID_INTENTS).toContain(r.intent);
    expect(r.analysisNote).toBeDefined();
  });

  it('strips markdown fences from API response', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    mockApiResponse('```json\n{"intent":"refactor","summary":"重构","impact":"low","syncGuide":["step1"]}\n```');

    const { analyzeComponents } = await import('../src/core/analyzer.js');
    const result = await analyzeComponents([makeInput()], MOCK_CONFIG);

    const r = result.get(MOCK_ENTRY.id)!;
    expect(r.intent).toBe('refactor');
    expect(r.impact).toBe('low');
    expect(r.syncGuide).toContain('step1');
  });

  it('uses medium impact and feature-add as fallback for unknown enum values', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    mockApiResponse(JSON.stringify({
      intent: 'unknown-future-intent',
      summary: 'test',
      impact: 'critical',
      syncGuide: [],
    }));

    const { analyzeComponents } = await import('../src/core/analyzer.js');
    const result = await analyzeComponents([makeInput()], MOCK_CONFIG);

    const r = result.get(MOCK_ENTRY.id)!;
    expect(r.intent).toBe('feature-add');
    expect(r.impact).toBe('medium');
  });

  it('does not throw when one component fails — other results still returned', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    const entry2 = { ...MOCK_ENTRY, id: 'extras.jsx::OtherPage', name: 'OtherPage' };

    let callCount = 0;
    const create = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('API error'));
      return Promise.resolve({
        content: [{ type: 'text', text: '{"intent":"style-change","summary":"ok","impact":"low","syncGuide":[]}' }],
      });
    });
    MockAnthropic.mockImplementation(() => ({ messages: { create } } as unknown as Anthropic));

    const { analyzeComponents } = await import('../src/core/analyzer.js');
    const inputs = [
      makeInput(),
      { entry: entry2, status: 'design-ahead' as const, designContent: 'a', codeContent: 'b' },
    ];

    // Should not throw — both entries should have results
    const result = await analyzeComponents(inputs, MOCK_CONFIG);
    expect(result.size).toBe(2);
    expect(result.has(MOCK_ENTRY.id)).toBe(true);
    expect(result.has(entry2.id)).toBe(true);
  });
});

describe('content truncation', () => {
  const originalKey = process.env['ANTHROPIC_API_KEY'];

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
  });

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env['ANTHROPIC_API_KEY'] = originalKey;
    } else {
      delete process.env['ANTHROPIC_API_KEY'];
    }
  });

  it('does not truncate short content', async () => {
    const create = mockApiResponse('{"intent":"feature-add","summary":"test","impact":"medium","syncGuide":[]}');

    const { analyzeComponents } = await import('../src/core/analyzer.js');
    const shortContent = 'function Btn() { return <button>Click</button>; }';
    await analyzeComponents([makeInput({ designContent: shortContent, codeContent: shortContent })], MOCK_CONFIG);

    const callArg = create.mock.calls[0][0] as { messages: Array<{ content: string }> };
    expect(callArg.messages[0].content).toContain(shortContent);
    expect(callArg.messages[0].content).not.toContain('truncated at');
  });

  it('truncates large content and adds a note', async () => {
    const create = mockApiResponse('{"intent":"feature-add","summary":"test","impact":"medium","syncGuide":[]}');

    const { analyzeComponents } = await import('../src/core/analyzer.js');
    const largeContent = 'x'.repeat(9_000);
    await analyzeComponents([makeInput({ designContent: largeContent })], MOCK_CONFIG);

    const callArg = create.mock.calls[0][0] as { messages: Array<{ content: string }> };
    expect(callArg.messages[0].content).toContain('truncated at 8000 chars');
  });
});
