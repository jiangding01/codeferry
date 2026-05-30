import Anthropic from '@anthropic-ai/sdk';
import pLimit from 'p-limit';
import type {
  ComponentEntry,
  ComponentSyncStatus,
  DriftConfig,
  IntentType,
  AIAnalysisResult,
} from '../types/index.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AnalysisInput {
  entry: ComponentEntry;
  status: ComponentSyncStatus;
  designContent: string;
  codeContent: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Max characters of design/code content sent to the API per component.
 * Typical JSX component is 50-200 lines (~2-8 KB). 8 000 chars covers ~300 lines,
 * enough for even large page components. Beyond this the model's context quality
 * degrades and latency increases significantly.
 */
const MAX_CONTENT_CHARS = 8_000;

function truncateContent(content: string, label: string): { text: string; truncated: boolean } {
  if (content.length <= MAX_CONTENT_CHARS) return { text: content, truncated: false };
  const text = `${content.slice(0, MAX_CONTENT_CHARS)}\n\n... [${label} truncated at ${MAX_CONTENT_CHARS} chars — ${content.length - MAX_CONTENT_CHARS} chars omitted]`;
  return { text, truncated: true };
}

// ── Prompt construction ──────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a code synchronization analyzer for drift-cli, a tool that tracks changes between design prototypes (JSX) and production code.

Given a component's current design and code state, analyze the change and provide sync guidance.

ALWAYS respond with a single valid JSON object. No markdown fences, no extra text. Schema:
{
  "intent": "feature-add" | "style-change" | "interaction-change" | "layout-change" | "refactor" | "props-change" | "logic-change" | "content-change",
  "summary": "one concise sentence describing what changed",
  "impact": "high" | "medium" | "low",
  "syncGuide": ["step 1 for the sync", "step 2", "..."]
}

intent guidance:
- feature-add: new UI sections, new components, new user-facing functionality
- style-change: visual/styling changes only (colors, spacing, typography)
- interaction-change: click handlers, form behavior, state management
- layout-change: structural layout changes (grid, flex, positioning)
- refactor: code restructuring without visible behavior change
- props-change: component interface/API changes
- logic-change: business logic, data transformation
- content-change: text copy, labels, static content

impact guidance:
- high: affects core user flows, major structural changes
- medium: meaningful functional or visual change
- low: minor cosmetic or copy changes`;

function buildAnalysisPrompt(input: AnalysisInput): string {
  const { entry, status, designContent, codeContent } = input;

  const statusDesc: Record<ComponentSyncStatus, string> = {
    'design-ahead': 'The design has changed, code needs updating.',
    'code-ahead': 'The code has changed, design needs updating.',
    'both-changed': 'Both design and code have changed — potential conflict.',
    'never-synced': 'Component has never been synced.',
    synced: 'No changes.',
    'new-design': 'New design component.',
    'new-code': 'New code component.',
  };

  const design = truncateContent(designContent || '(empty or unreadable)', 'design content');
  const code = truncateContent(codeContent || '(no code file mapped)', 'code content');

  const notes: string[] = [];
  if (design.truncated) notes.push('design content was truncated due to size');
  if (code.truncated) notes.push('code content was truncated due to size');

  return [
    `Component: ${entry.name}`,
    `File: ${entry.designFile}:${entry.designStartLine}-${entry.designEndLine}`,
    `Status: ${status} — ${statusDesc[status]}`,
    ...(notes.length > 0 ? [`Note: ${notes.join('; ')}`] : []),
    '',
    '=== DESIGN CONTENT ===',
    design.text,
    '',
    '=== CODE CONTENT ===',
    code.text,
  ].join('\n');
}

// ── Default fallback result ──────────────────────────────────────────────────

function defaultResult(componentId: string, analysisNote?: string): AIAnalysisResult {
  return {
    componentId,
    intent: 'feature-add',
    summary: '变更详情需人工审查',
    impact: 'medium',
    syncGuide: ['查看 drift diff 中的结构 diff', '根据变更内容手动同步'],
    analysisNote,
  };
}

// ── Parse AI response ────────────────────────────────────────────────────────

const VALID_INTENTS = new Set<IntentType>([
  'feature-add', 'style-change', 'interaction-change', 'layout-change',
  'refactor', 'props-change', 'logic-change', 'content-change',
]);
const VALID_IMPACTS = new Set(['high', 'medium', 'low']);

function parseAnalysisResponse(raw: string, componentId: string): AIAnalysisResult {
  // Strip markdown fences if model ignores the instruction
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return defaultResult(componentId, `JSON 解析失败: ${raw.slice(0, 80)}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return defaultResult(componentId, '响应格式无效');
  }

  const obj = parsed as Record<string, unknown>;
  const intent = VALID_INTENTS.has(obj['intent'] as IntentType)
    ? (obj['intent'] as IntentType)
    : 'feature-add';
  const impact = VALID_IMPACTS.has(obj['impact'] as string)
    ? (obj['impact'] as 'high' | 'medium' | 'low')
    : 'medium';
  const summary = typeof obj['summary'] === 'string' ? obj['summary'] : '变更详情待审查';
  const syncGuide = Array.isArray(obj['syncGuide'])
    ? obj['syncGuide'].filter((s): s is string => typeof s === 'string')
    : ['根据 diff 内容手动同步'];

  return { componentId, intent, summary, impact, syncGuide };
}

// ── Retry with exponential backoff ───────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // Only retry on rate limit / server errors
      const status = (err as { status?: number }).status;
      if (status !== 429 && status !== 500 && status !== 529) throw err;
      const delay = Math.min(1000 * 2 ** attempt + Math.random() * 500, 8000);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ── Single component analysis ────────────────────────────────────────────────

async function analyzeOne(
  client: Anthropic,
  input: AnalysisInput,
  model: string,
): Promise<AIAnalysisResult> {
  const { entry } = input;

  const response = await withRetry(() =>
    client.messages.create({
      model,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildAnalysisPrompt(input) }],
    }),
  );

  const block = response.content[0];
  if (!block || block.type !== 'text') {
    return defaultResult(entry.id, '空响应');
  }

  return parseAnalysisResponse(block.text, entry.id);
}

// ── Batch analysis ───────────────────────────────────────────────────────────

/**
 * Analyze multiple components concurrently using Claude API.
 *
 * Returns a Map<componentId, AIAnalysisResult>.
 * If ANTHROPIC_API_KEY is not set, returns default fallback results for all.
 * Individual failures are caught and filled with fallbacks — never throws.
 */
export async function analyzeComponents(
  inputs: AnalysisInput[],
  config: DriftConfig,
): Promise<Map<string, AIAnalysisResult>> {
  const results = new Map<string, AIAnalysisResult>();

  if (inputs.length === 0) return results;

  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    for (const { entry } of inputs) {
      results.set(entry.id, defaultResult(entry.id, 'ANTHROPIC_API_KEY 未设置，跳过 AI 分析'));
    }
    return results;
  }

  const client = new Anthropic({ apiKey });
  // Default to Haiku for cost-effective batch analysis; override in drift.config.json
  const model = config.ai?.model ?? 'claude-haiku-4-5';
  const maxConcurrency = config.ai?.maxConcurrency ?? 3;
  const limit = pLimit(maxConcurrency);

  const tasks = inputs.map((input) =>
    limit(async () => {
      try {
        const result = await analyzeOne(client, input, model);
        results.set(input.entry.id, result);
      } catch (err) {
        results.set(
          input.entry.id,
          defaultResult(input.entry.id, `分析失败: ${String(err).slice(0, 80)}`),
        );
      }
    }),
  );

  await Promise.all(tasks);
  return results;
}
