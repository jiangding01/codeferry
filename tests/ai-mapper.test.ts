/**
 * ai-mapper tests — Claude API is mocked via vi.mock to avoid real API calls.
 *
 * Tests cover:
 *  - Graceful no-op when ANTHROPIC_API_KEY is absent
 *  - Successful batch suggestion parsing
 *  - Handling of malformed / empty JSON responses
 *  - Confidence filtering (< 0.5 suggestions discarded)
 *  - Empty input short-circuits without an API call
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentEntry, DriftConfig } from '../src/types/index.js';

// ── Mock the Anthropic SDK ────────────────────────────────────────────────────

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEntry(name: string, designFile = 'pages/Dashboard.jsx'): ComponentEntry {
  return {
    id: `${designFile}::${name}`,
    name,
    designFile,
    designStartLine: 1,
    designEndLine: 30,
    designHash: 'abc',
    codeFiles: [],
    codeHash: '',
    mappingType: 'auto',
    mappingConfidence: 0,
    lastSyncedAt: null,
    designHashAtSync: null,
    codeHashAtSync: null,
    kind: 'page',
  };
}

const MOCK_CONFIG: DriftConfig = {
  version: '2.0',
  design: { root: '/design', include: ['**/*.jsx'], exclude: [] },
  code: { root: '/code', include: ['**/*.tsx'], exclude: [] },
  ai: { model: 'claude-haiku-4-5', batchSize: 5, maxConcurrency: 3 },
};

const CODE_FILES = [
  'src/app/dashboard/page.tsx',
  'src/components/ui/Header.tsx',
  'src/components/Footer.tsx',
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('suggestMappings — no API key', () => {
  beforeEach(() => {
    delete process.env['ANTHROPIC_API_KEY'];
    mockCreate.mockReset();
  });

  it('returns empty map without calling the API', async () => {
    const { suggestMappings } = await import('../src/core/ai-mapper.js');
    const result = await suggestMappings([makeEntry('Dashboard')], CODE_FILES, MOCK_CONFIG);
    expect(result.size).toBe(0);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('suggestMappings — with API key', () => {
  beforeEach(() => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test-key';
    mockCreate.mockReset();
  });

  it('returns empty map for empty component list', async () => {
    const { suggestMappings } = await import('../src/core/ai-mapper.js');
    const result = await suggestMappings([], CODE_FILES, MOCK_CONFIG);
    expect(result.size).toBe(0);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('parses a successful batch response and returns mapping', async () => {
    const responseJson = JSON.stringify([
      {
        componentIndex: 1,
        codePath: 'src/app/dashboard/page.tsx',
        confidence: 0.92,
        reasoning: 'Directory and filename match component name',
      },
    ]);

    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: responseJson }],
    });

    const { suggestMappings } = await import('../src/core/ai-mapper.js');
    const result = await suggestMappings([makeEntry('Dashboard')], CODE_FILES, MOCK_CONFIG);

    expect(result.size).toBe(1);
    const suggestion = result.get('pages/Dashboard.jsx::Dashboard');
    expect(suggestion).toBeDefined();
    expect(suggestion!.codePath).toBe('src/app/dashboard/page.tsx');
    expect(suggestion!.confidence).toBeCloseTo(0.92);
    expect(suggestion!.reasoning).toContain('Directory and filename');
  });

  it('discards suggestions with confidence below 0.5', async () => {
    const responseJson = JSON.stringify([
      {
        componentIndex: 1,
        codePath: 'src/app/dashboard/page.tsx',
        confidence: 0.3,
        reasoning: 'Weak match',
      },
    ]);

    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: responseJson }],
    });

    const { suggestMappings } = await import('../src/core/ai-mapper.js');
    const result = await suggestMappings([makeEntry('Dashboard')], CODE_FILES, MOCK_CONFIG);
    expect(result.size).toBe(0);
  });

  it('handles malformed JSON gracefully (returns empty for that batch)', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'not valid json at all' }],
    });

    const { suggestMappings } = await import('../src/core/ai-mapper.js');
    const result = await suggestMappings([makeEntry('Dashboard')], CODE_FILES, MOCK_CONFIG);
    expect(result.size).toBe(0);
  });

  it('handles empty JSON array response (no matches found by AI)', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '[]' }],
    });

    const { suggestMappings } = await import('../src/core/ai-mapper.js');
    const result = await suggestMappings([makeEntry('Dashboard')], CODE_FILES, MOCK_CONFIG);
    expect(result.size).toBe(0);
  });

  it('strips markdown fences from response', async () => {
    const responseJson = JSON.stringify([
      {
        componentIndex: 1,
        codePath: 'src/components/ui/Header.tsx',
        confidence: 0.85,
        reasoning: 'Header component matches',
      },
    ]);

    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: `\`\`\`json\n${responseJson}\n\`\`\`` }],
    });

    const { suggestMappings } = await import('../src/core/ai-mapper.js');
    const result = await suggestMappings(
      [makeEntry('Header', 'components/Header.jsx')],
      CODE_FILES,
      MOCK_CONFIG,
    );
    expect(result.size).toBe(1);
    const suggestion = result.get('components/Header.jsx::Header');
    expect(suggestion!.codePath).toBe('src/components/ui/Header.tsx');
  });

  it('maps multiple components in a single batch', async () => {
    const responseJson = JSON.stringify([
      {
        componentIndex: 1,
        codePath: 'src/app/dashboard/page.tsx',
        confidence: 0.9,
        reasoning: 'Dashboard page match',
      },
      {
        componentIndex: 2,
        codePath: 'src/components/ui/Header.tsx',
        confidence: 0.8,
        reasoning: 'Header component match',
      },
    ]);

    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: responseJson }],
    });

    const { suggestMappings } = await import('../src/core/ai-mapper.js');
    const components = [
      makeEntry('Dashboard'),
      makeEntry('Header', 'components/Header.jsx'),
    ];
    const result = await suggestMappings(components, CODE_FILES, MOCK_CONFIG);

    expect(result.size).toBe(2);
    expect(result.get('pages/Dashboard.jsx::Dashboard')!.codePath).toBe('src/app/dashboard/page.tsx');
    expect(result.get('components/Header.jsx::Header')!.codePath).toBe('src/components/ui/Header.tsx');
  });

  it('swallows per-batch API errors without throwing', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Network error'));

    const { suggestMappings } = await import('../src/core/ai-mapper.js');
    // Should resolve (not throw), returning empty map
    await expect(
      suggestMappings([makeEntry('Dashboard')], CODE_FILES, MOCK_CONFIG),
    ).resolves.toEqual(new Map());
  });
});
