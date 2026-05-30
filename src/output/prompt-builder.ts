import type {
  ComponentEntry,
  ComponentSyncStatus,
  SyncDirection,
  DriftConfig,
  StackInfo,
  AIAnalysisResult,
  IntentType,
} from '../types/index.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PromptContext {
  entry: ComponentEntry;
  direction: SyncDirection;
  designContent: string;
  codeContent: string;
  status: ComponentSyncStatus;
  config: DriftConfig;
  stackInfo?: StackInfo | null;
  analysis?: AIAnalysisResult | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const INTENT_LABEL: Record<IntentType, string> = {
  'feature-add': '新增功能',
  'style-change': '样式调整',
  'interaction-change': '交互变化',
  'layout-change': '布局调整',
  'refactor': '代码重构',
  'props-change': '接口变化',
  'logic-change': '逻辑变化',
  'content-change': '内容变更',
};

const IMPACT_LABEL: Record<'high' | 'medium' | 'low', string> = {
  high: '高（影响核心流程）',
  medium: '中（功能/视觉变化）',
  low: '低（细节调整）',
};

function buildStackContext(config: DriftConfig, stackInfo?: StackInfo | null): string {
  const parts: string[] = [];

  // StackDetector results take priority when fields are populated
  const hasDetectedFields = !!(
    stackInfo?.framework || stackInfo?.language ||
    stackInfo?.styling || stackInfo?.routing
  );

  if (hasDetectedFields && stackInfo) {
    const detected: string[] = [];
    if (stackInfo.framework) detected.push(`框架: ${stackInfo.framework.value}`);
    if (stackInfo.language) detected.push(`语言: ${stackInfo.language.value}`);
    if (stackInfo.styling) detected.push(`样式: ${stackInfo.styling.value}`);
    if (stackInfo.routing) detected.push(`路由: ${stackInfo.routing.value}`);
    if (detected.length > 0) parts.push(detected.join(' · '));
  } else if (config.project?.stack) {
    // Fall back to the plain stack string stored in config
    parts.push(`技术栈: ${config.project.stack}`);
  }

  // User-defined conventions
  const conventions = config.project?.conventions;
  if (conventions && conventions.length > 0) {
    parts.push('');
    parts.push('项目约定:');
    for (const c of conventions) parts.push(`- ${c}`);
  }

  // Design notes
  const designNotes = config.project?.designNotes;
  if (designNotes && designNotes.length > 0) {
    parts.push('');
    parts.push('设计稿约定:');
    for (const n of designNotes) parts.push(`- ${n}`);
  }

  return parts.length > 0 ? parts.join('\n') : '（未配置，AI 将从代码内容自行推断）';
}

function buildConversionHints(direction: SyncDirection, stackInfo?: StackInfo | null): string {
  const hints = direction === 'design-to-code'
    ? stackInfo?.designToCodeHints
    : stackInfo?.codeToDesignHints;

  if (!hints || hints.length === 0) {
    if (direction === 'design-to-code') {
      return [
        '- 将设计稿中的内联样式或 CSS 变量转换为代码侧使用的样式方案',
        '- 保留代码侧现有的工程结构、命名规范和工具函数调用',
        '- 如有 TypeScript 类型缺失，根据代码侧约定补全',
        '- 不要直接复制设计稿中的 import 语句（设计稿无 import）',
      ].join('\n');
    } else {
      return [
        '- 将代码侧的框架特定语法还原为设计稿可用的 plain JSX',
        '- 移除 TypeScript 类型注解（设计稿为 plain JavaScript）',
        '- 将数据获取逻辑（API 调用、hooks）替换为硬编码的示例数据',
        '- 将样式方案（Tailwind/CSS Modules）转换为内联样式或 CSS 变量',
        '- 移除所有 import/export 语句（设计稿不需要）',
      ].join('\n');
    }
  }

  return hints.map((h) => `- ${h}`).join('\n');
}

function buildAnalysisSection(analysis: AIAnalysisResult): string {
  const lines: string[] = [];
  lines.push(`- 变更类型：${INTENT_LABEL[analysis.intent]} (\`${analysis.intent}\`)`);
  lines.push(`- 影响范围：${IMPACT_LABEL[analysis.impact]}`);
  lines.push(`- 摘要：${analysis.summary}`);

  if (analysis.analysisNote) {
    lines.push(`- 备注：${analysis.analysisNote}`);
  }

  return lines.join('\n');
}

function buildSyncGuide(analysis?: AIAnalysisResult | null): string {
  if (!analysis || analysis.syncGuide.length === 0) {
    return [
      '1. 仔细对比上方的设计内容与代码实现',
      '2. 识别差异并评估是否需要同步',
      '3. 在代码侧应用必要的更改',
      '4. 完成后运行 `drift snapshot` 更新同步基线',
    ].join('\n');
  }
  return analysis.syncGuide.map((step, i) => `${i + 1}. ${step}`).join('\n');
}

// ── Main builder ─────────────────────────────────────────────────────────────

/**
 * Build a structured Markdown prompt suitable for pasting into Claude Code or Claude Design.
 *
 * The prompt is self-contained — includes all context needed for the AI to
 * perform the sync without referring back to this tool.
 */
export function buildSyncPrompt(ctx: PromptContext): string {
  const { entry, direction, designContent, codeContent, config, stackInfo, analysis } = ctx;

  const dirLabel = direction === 'design-to-code'
    ? 'Design → Code（将设计稿变更同步到代码）'
    : 'Code → Design（将代码变更同步到设计稿）';

  const sourceSide = direction === 'design-to-code' ? '设计稿' : '代码';
  const targetSide = direction === 'design-to-code' ? '代码实现' : '设计稿';
  const sourceLang = direction === 'design-to-code' ? 'jsx' : 'tsx';
  const targetLang = direction === 'design-to-code' ? 'tsx' : 'jsx';

  const codeTarget = entry.codeFiles.length > 0
    ? entry.codeFiles.join(', ')
    : '（尚未映射代码文件）';

  const sections: string[] = [];

  // ── Header ──
  sections.push(`# drift-cli 同步任务 · ${dirLabel}`);
  sections.push('');

  // ── Overview ──
  sections.push('## 概要');
  sections.push('');
  sections.push(`- **组件**：\`${entry.name}\``);
  sections.push(`- **设计稿**：\`${entry.designFile}:${entry.designStartLine}-${entry.designEndLine}\``);
  sections.push(`- **代码文件**：\`${codeTarget}\``);

  if (analysis) {
    sections.push('');
    sections.push(buildAnalysisSection(analysis));
  } else {
    sections.push(`- **变更类型**：待分析`);
  }
  sections.push('');

  // ── Tech context ──
  sections.push('## 项目技术上下文');
  sections.push('');
  sections.push(buildStackContext(config, stackInfo));
  sections.push('');

  // ── Source content (the side that changed and needs to be mirrored) ──
  // For design-to-code: source = design file content
  // For code-to-design: source = code file content
  const sourceContent = direction === 'design-to-code' ? designContent : codeContent;
  const targetContent = direction === 'design-to-code' ? codeContent : designContent;
  const targetEmptyMsg = direction === 'design-to-code'
    ? '（尚无代码实现，请根据设计稿从头创建）'
    : '（尚无设计稿内容，请根据代码从头创建）';

  sections.push(`## ${sourceSide}当前内容`);
  sections.push('');
  sections.push(`\`\`\`${sourceLang}`);
  sections.push(sourceContent.trim() || '（内容为空或无法读取）');
  sections.push('```');
  sections.push('');

  // ── Target content (the side that needs to be updated) ──
  sections.push(`## ${targetSide}当前实现`);
  sections.push('');

  if (targetContent.trim()) {
    sections.push(`\`\`\`${targetLang}`);
    sections.push(targetContent.trim());
    sections.push('```');
  } else {
    sections.push(targetEmptyMsg);
  }
  sections.push('');

  // ── Conversion hints ──
  sections.push('## 转换指引');
  sections.push('');
  sections.push(buildConversionHints(direction, stackInfo));
  sections.push('');

  // ── Sync guide ──
  sections.push('## 同步步骤');
  sections.push('');
  sections.push(buildSyncGuide(analysis));
  sections.push('');

  // ── Footer ──
  sections.push('## 注意事项');
  sections.push('');
  sections.push([
    '- **只同步意图**，不直接复制代码 — 理解变更的目的，用目标侧的惯用方式实现',
    '- **保持目标侧的工程结构**和命名规范，不要引入新的架构模式',
    '- 如有不确定的地方，**保留目标侧的现有实现**，并在回复中说明',
    '- 完成后请告知已完成，用户将运行 `drift snapshot` 更新同步基线',
  ].join('\n'));
  sections.push('');

  return sections.join('\n');
}

/**
 * Generate a safe filename for a prompt output file.
 * Example: "AccountPage_design-to-code_20260530.md"
 */
export function buildPromptFilename(entry: ComponentEntry, direction: SyncDirection): string {
  const dirShort = direction === 'design-to-code' ? 'd2c' : 'c2d';
  const date = new Date().toISOString().slice(0, 10);
  const safeName = entry.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${safeName}_${dirShort}_${date}.md`;
}
