import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import type { ExtractionResult, ComponentSyncStatus } from '../types/index.js';
import { log } from '../utils/logger.js';

export function spinner(text: string): Ora {
  return ora({ text, color: 'cyan' });
}

export function printExtractionSummary(results: ExtractionResult[]): void {
  const totalFiles = results.length;
  const totalComponents = results.reduce((sum, r) => sum + r.components.length, 0);

  const pages = results.flatMap((r) => r.components.filter((c) => c.kind === 'page')).length;
  const shared = results.flatMap((r) => r.components.filter((c) => c.kind === 'shared')).length;
  const helpers = results.flatMap((r) => r.components.filter((c) => c.kind === 'helper')).length;

  log.success(`扫描了 ${chalk.bold(totalFiles)} 个文件，提取了 ${chalk.bold(totalComponents)} 个组件`);
  log.dim(`  分类：${pages} pages, ${shared} shared, ${helpers} helpers`);
}

export function printScanSummary(side: string, fileCount: number): void {
  log.success(`${side} 侧扫描完成：${chalk.bold(fileCount)} 个文件`);
}

export function statusIcon(status: ComponentSyncStatus): string {
  switch (status) {
    case 'synced': return chalk.green('✔');
    case 'design-ahead': return chalk.yellow('◐');
    case 'code-ahead': return chalk.blue('◑');
    case 'both-changed': return chalk.red('⚠');
    case 'never-synced': return chalk.gray('○');
    case 'new-design': return chalk.green('+');
    case 'new-code': return chalk.cyan('+');
  }
}

export function statusLabel(status: ComponentSyncStatus): string {
  switch (status) {
    case 'synced': return chalk.green('synced');
    case 'design-ahead': return chalk.yellow('design-ahead');
    case 'code-ahead': return chalk.blue('code-ahead');
    case 'both-changed': return chalk.red('conflict');
    case 'never-synced': return chalk.gray('never-synced');
    case 'new-design': return chalk.green('new-design');
    case 'new-code': return chalk.cyan('new-code');
  }
}

export function printInitComplete(componentCount: number, snapshotId: string): void {
  log.blank();
  log.success(`初始化完成`);
  log.dim(`  组件注册：${componentCount} 个`);
  log.dim(`  初始快照：${snapshotId}`);
  log.blank();
  log.info(`运行 ${chalk.bold('drift status')} 查看同步状态`);
}
