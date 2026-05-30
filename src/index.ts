import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { mapListCommand, mapAutoCommand, mapSetCommand, mapUnsetCommand } from './commands/map.js';
import { statusCommand } from './commands/status.js';
import { diffCommand } from './commands/diff.js';
import { syncCommand } from './commands/sync.js';
import { snapshotCommand } from './commands/snapshot.js';
import { logCommand } from './commands/log.js';
import type { ComponentSyncStatus } from './types/index.js';

const program = new Command();

program
  .name('drift')
  .description('CLI tool for bidirectional sync between Claude Design and Claude Code')
  .version('0.4.0');

// ── drift init ───────────────────────────────────────────────────────────────

program
  .command('init')
  .description('初始化 drift-cli，创建 .drift/ 目录和初始快照')
  .requiredOption('--design <path>', '设计稿根目录路径')
  .requiredOption('--code <path>', '代码项目根目录路径')
  .option('--force', '强制重新初始化', false)
  .option('--skip-detect', '跳过技术栈自动检测', false)
  .action(async (opts) => {
    try {
      await initCommand(opts);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ── drift map ────────────────────────────────────────────────────────────────

const mapCmd = program
  .command('map')
  .description('管理设计组件与代码文件的映射关系');

// drift map (default: list)
mapCmd
  .command('list', { isDefault: true })
  .description('显示所有映射关系')
  .option('--unmapped', '仅显示未映射的组件', false)
  .action(async (opts) => {
    try {
      await mapListCommand(opts);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// drift map auto
mapCmd
  .command('auto')
  .description('运行自动映射策略（文件名匹配 + 导出名匹配）')
  .action(async () => {
    try {
      await mapAutoCommand();
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// drift map set <id> <path>
mapCmd
  .command('set <id> <path>')
  .description('手动设置组件到代码文件的映射')
  .action(async (id: string, path: string) => {
    try {
      await mapSetCommand(id, path);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// drift map unset <id>
mapCmd
  .command('unset <id>')
  .description('移除组件映射')
  .action(async (id: string) => {
    try {
      await mapUnsetCommand(id);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ── drift status ─────────────────────────────────────────────────────────────

const VALID_STATUSES: ComponentSyncStatus[] = [
  'synced', 'design-ahead', 'code-ahead', 'both-changed',
  'never-synced', 'new-design', 'new-code',
];

program
  .command('status')
  .description('查看所有组件的同步状态总览')
  .option('--refresh', '重新扫描文件系统以获取最新哈希', false)
  .option('--filter <status>', `按状态过滤：${VALID_STATUSES.join(' | ')}`)
  .action(async (opts) => {
    try {
      if (opts.filter && !VALID_STATUSES.includes(opts.filter)) {
        console.error(`无效的状态过滤值：${opts.filter}`);
        console.error(`有效值：${VALID_STATUSES.join(', ')}`);
        process.exit(1);
      }
      await statusCommand({
        filter: opts.filter as ComponentSyncStatus | undefined,
        refresh: opts.refresh,
      });
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ── drift diff ───────────────────────────────────────────────────────────────

program
  .command('diff')
  .description('扫描双目录变更并展示 diff，含 AI 语义分析（使用 --no-ai 跳过）')
  .option('--no-ai', '跳过 AI 语义分析，仅展示结构 diff')
  .option('--side <side>', '仅检测指定侧变更：design | code')
  .option('--component <name>', '仅检测指定组件')
  .action(async (opts) => {
    if (opts.side && !['design', 'code'].includes(opts.side)) {
      console.error(`--side 只接受 "design" 或 "code"，收到：${opts.side}`);
      process.exit(1);
    }
    try {
      await diffCommand({
        noAi: !opts.ai, // commander converts --no-ai to opts.ai = false
        side: opts.side as 'design' | 'code' | undefined,
        component: opts.component,
      });
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ── drift sync ───────────────────────────────────────────────────────────────

program
  .command('sync')
  .description('生成双向同步 Prompt（复制到剪贴板或写入文件），直接交给 Claude Code / Claude Design')
  .requiredOption('--to <target>', '同步方向：code（设计 → 代码）或 design（代码 → 设计）')
  .option('--copy', '将 Prompt 复制到剪贴板（默认行为）', false)
  .option('--out <dir>', '将 Prompt 写入指定目录（每组件一个 .md 文件）')
  .option('--component <name>', '仅为指定组件生成 Prompt')
  .option('--no-ai', '跳过 AI 语义分析，使用通用同步指引')
  .action(async (opts) => {
    if (!['code', 'design'].includes(opts.to)) {
      console.error(`--to 只接受 "code" 或 "design"，收到：${opts.to}`);
      process.exit(1);
    }
    try {
      await syncCommand({
        to: opts.to as 'code' | 'design',
        copy: opts.copy || !opts.out,
        out: opts.out,
        component: opts.component,
        noAi: !opts.ai, // commander inverts --no-ai to opts.ai = false
      });
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ── drift snapshot ───────────────────────────────────────────────────────────

program
  .command('snapshot')
  .description('将当前双侧状态标记为新基线，闭合同步循环')
  .option('--component <name>', '只更新指定组件的基线')
  .option('--after-sync', '仅更新同步队列中 in-progress 状态的组件（drift sync 执行后使用）', false)
  .action(async (opts) => {
    try {
      await snapshotCommand({
        component: opts.component,
        afterSync: opts.afterSync,
      });
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ── drift log ────────────────────────────────────────────────────────────────

const VALID_QUEUE_STATUSES = ['pending', 'in-progress', 'done', 'skipped', 'conflict'];

program
  .command('log')
  .description('查看同步操作历史记录和队列状态')
  .option('--component <name>', '仅显示指定组件的记录')
  .option('--last <n>', '仅显示最新 N 条记录', (v) => parseInt(v, 10))
  .option('--status <status>', `按状态过滤：${VALID_QUEUE_STATUSES.join(' | ')}`)
  .action(async (opts) => {
    if (opts.status && !VALID_QUEUE_STATUSES.includes(opts.status)) {
      console.error(`无效的状态：${opts.status}`);
      console.error(`有效值：${VALID_QUEUE_STATUSES.join(', ')}`);
      process.exit(1);
    }
    try {
      await logCommand({
        component: opts.component,
        last: opts.last,
        status: opts.status,
      });
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program.parse();
