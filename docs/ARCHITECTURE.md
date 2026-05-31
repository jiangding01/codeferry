[← Back to README](../README.md)

# drift-sync — Architecture & Technical Design

> Internal design document describing the architecture, data model, and module breakdown of drift-sync.
> For user-facing documentation, see the [README](../README.md).

---

# drift-sync 技术方案

> 设计稿与生产代码双向同步的 CLI 桥接工具

---

## 目录

1. [项目背景与目标](#1-项目背景与目标)
2. [核心设计原则](#2-核心设计原则)
3. [整体架构](#3-整体架构)
4. [目录结构](#4-目录结构)
5. [数据模型](#5-数据模型)
6. [命令设计](#6-命令设计)
7. [核心模块设计](#7-核心模块设计)
8. [AI 分析层](#8-ai-分析层)
9. [输出层](#9-输出层)
10. [配置系统](#10-配置系统)
11. [状态管理](#11-状态管理)
12. [错误处理](#12-错误处理)
13. [技术选型](#13-技术选型)
14. [开发路线图](#14-开发路线图)
15. [使用流程示例](#15-使用流程示例)

---

## 1. 项目背景与目标

### 问题描述

在使用 Claude Design 和 Claude Code 进行产品开发时，存在以下核心矛盾：

- Claude Design 输出的是高保真交互式 React/HTML 设计稿，是产品的**视觉与交互意图**的表达
- Claude Code 基于设计稿进行生产实现，关注**工程质量与业务逻辑**
- 两侧本质上是**同一产品意图的两种代码形态**，但存放于独立的项目文件夹中
- 任意一侧发生迭代，另一侧无法感知，导致**双向漂移（drift）**

### 目标

构建一个 CLI 工具 `drift-sync`，作为两侧之间的智能桥接层，实现：

- 自动检测两侧文件的变更
- 区分**结构变更**（文件增删改名）和**语义变更**（代码意图变化）
- 通过 AI 理解变更意图，生成可直接使用的同步 prompt
- 维护完整的变更历史，确保任何一侧的修改最终都能被另一侧感知

### 核心约束

- 同步决策**必须由人工确认**，工具不自动修改代码
- AI 分析只处理**真正有内容变化**的文件，控制 API 成本
- 工具需适配**多文件项目**，而非单文件粘贴模式

---

## 2. 核心设计原则

**原则一：变更意图优先于代码行**

两侧代码不是同一份代码的副本，不能做字面 diff。工具分析的对象是"这个变更想表达什么"，而不是"哪几行代码改了"。

**原则二：机器做结构，AI 做语义**

文件的增删、重命名、hash 对比——机器判断，快速且准确。代码内容变化的意图理解——交给 Claude API，批量聚合处理。

**原则三：人是最终决策者**

`sync` 命令只生成 prompt，不自动写入任何文件。工具是**辅助决策工具**，不是自动化流水线。

**原则四：增量优先，控制成本**

每次分析只处理自上次快照以来变更的文件。未变更文件不消耗 API token。

**原则五：配置即文档**

`.sync/config.json` 记录文件映射关系，本身就是"哪个设计文件对应哪个实现文件"的活文档。

---

## 3. 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                      命令层 (CLI)                         │
│         init    diff    sync    status    log            │
└──────────────┬──────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────┐
│                      核心层 (Core)                        │
│                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │   Scanner   │→ │   Differ    │→ │   AI Analyzer   │  │
│  │ 文件树扫描   │  │ 结构/语义分层│  │  Claude API    │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
│                          │                               │
│                 ┌────────▼────────┐                      │
│                 │   State Store   │                      │
│                 │ snapshot/queue  │                      │
│                 └─────────────────┘                      │
└──────────────────────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────┐
│                      输出层 (Output)                      │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │  Reporter   │  │PromptBuilder │  │   Exporter     │  │
│  │  终端输出    │  │  生成 prompt  │  │ Markdown/JSON  │  │
│  └─────────────┘  └──────────────┘  └────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## 4. 目录结构

### 项目仓库结构

```
drift-sync/
├── package.json
├── tsconfig.json
├── README.md
│
├── src/
│   ├── index.ts                  # CLI 入口，注册 commander 子命令
│   │
│   ├── commands/                 # 命令层
│   │   ├── init.ts
│   │   ├── diff.ts
│   │   ├── sync.ts
│   │   ├── status.ts
│   │   └── log.ts
│   │
│   ├── core/                     # 核心层
│   │   ├── scanner.ts            # 文件树扫描 + hash 生成
│   │   ├── differ.ts             # 结构 diff（纯机器判断）
│   │   ├── analyzer.ts           # 语义分析（Claude API）
│   │   └── mapper.ts             # 设计文件 ↔ 实现文件映射解析
│   │
│   ├── output/                   # 输出层
│   │   ├── reporter.ts           # 终端彩色输出
│   │   ├── prompt-builder.ts     # 同步 prompt 生成
│   │   └── exporter.ts           # Markdown / JSON 导出
│   │
│   ├── state/                    # 状态管理
│   │   ├── store.ts              # 读写 .sync/ 目录
│   │   └── snapshot.ts           # 快照生成与比对
│   │
│   └── utils/
│       ├── hash.ts               # 文件 hash 工具
│       ├── glob.ts               # 文件过滤规则
│       └── logger.ts             # 日志工具（基于 chalk + ora）
│
└── tests/
    ├── scanner.test.ts
    ├── differ.test.ts
    └── analyzer.test.ts
```

### 使用工具的项目目录（运行时生成）

```
your-project/
├── design/                       # Claude Design 项目文件夹
│   ├── components/
│   │   ├── Button.tsx
│   │   └── Modal.tsx
│   └── pages/
│       └── Home.tsx
│
├── src/                          # Claude Code 实现文件夹
│   ├── components/
│   │   └── ui/
│   │       ├── Button.tsx
│   │       └── Modal.tsx
│   └── pages/
│       └── Home.tsx
│
└── .sync/                        # drift-sync 状态目录（建议加入 .gitignore）
    ├── config.json               # 配置：路径、映射规则、排除规则
    ├── snapshot.json             # 最近一次快照（两侧文件 hash）
    ├── queue.json                # 待处理的同步队列
    └── history/
        ├── 2026-05-30T10-00.md   # 每次 diff 的报告归档
        └── 2026-05-28T15-30.md
```

---

## 5. 数据模型

### FileSnapshot — 文件快照

```typescript
interface FileSnapshot {
  path: string            // 相对于项目根目录的路径
  hash: string            // SHA-256 内容 hash
  lastModified: number    // Unix timestamp
  size: number            // 字节数
}

interface ProjectSnapshot {
  capturedAt: number
  design: Record<string, FileSnapshot>   // key: 相对路径
  code: Record<string, FileSnapshot>
}
```

### FileChange — 变更记录

```typescript
type ChangeType =
  | 'added'            // 新文件（另一侧没有对应文件）
  | 'deleted'          // 文件删除
  | 'renamed'          // hash 相同但路径变化（重命名/移动）
  | 'content-changed'  // 内容变更，需要 AI 语义分析

interface FileChange {
  type: ChangeType
  side: 'design' | 'code'
  path: string
  oldPath?: string     // renamed 时记录原路径
  diff?: string        // unified diff 内容（content-changed 时生成）
}
```

### SyncSuggestion — AI 同步建议

```typescript
type IntentType =
  | 'feature-add'       // 新增功能/组件
  | 'style-change'      // 样式/视觉调整
  | 'interaction-change'// 交互行为变化
  | 'refactor'          // 重构，无功能变化
  | 'props-change'      // 组件 API 变化（props/interface）
  | 'logic-change'      // 业务逻辑变化

interface SyncSuggestion {
  changeId: string
  sourceSide: 'design' | 'code'
  targetSide: 'design' | 'code'
  intent: IntentType
  summary: string           // 一句话总结变更意图
  impact: 'high' | 'medium' | 'low'
  affectedFiles: string[]   // 目标侧需要关注的文件
  syncPrompt: string        // 生成的同步 prompt（完整可用）
}
```

### SyncQueueItem — 待同步队列项

```typescript
type QueueStatus = 'pending' | 'in-progress' | 'done' | 'skipped'

interface SyncQueueItem {
  id: string
  createdAt: number
  suggestion: SyncSuggestion
  status: QueueStatus
  note?: string             // 用户手动添加的备注
}
```

### Config — 项目配置

```typescript
interface FileMapping {
  design: string     // glob 或具体路径，相对于 design 根目录
  code: string       // glob 或具体路径，相对于 code 根目录
  note?: string      // 备注说明
}

interface DriftConfig {
  version: string
  design: {
    root: string                 // 设计稿根目录，相对于项目根
    exclude: string[]            // glob 排除规则
  }
  code: {
    root: string                 // 实现代码根目录
    exclude: string[]
  }
  mappings: FileMapping[]        // 显式文件映射关系
  ai: {
    model: string                // 默认 claude-sonnet-4-20250514
    batchSize: number            // 每批 AI 分析的文件数，默认 5
    maxConcurrency: number       // 并发请求数，默认 3
  }
}
```

---

## 6. 命令设计

### `drift init`

初始化项目，记录两侧当前状态作为基准快照。

```bash
drift init --design ./design --code ./src
drift init  # 如果已有 config.json，直接从配置读取
```

执行流程：

1. 检测 `.sync/` 目录是否存在，不存在则创建
2. 引导用户填写配置（交互式 prompt，或从参数读取）
3. 扫描两侧文件树，生成初始 `snapshot.json`
4. 输出摘要：扫描了多少文件、发现了多少映射关系

选项：

| 选项 | 说明 |
|------|------|
| `--design <path>` | 设计稿根目录 |
| `--code <path>` | 实现代码根目录 |
| `--force` | 强制重新初始化（覆盖现有快照） |

---

### `drift diff`

核心命令。检测自上次快照以来的所有变更，调用 AI 分析语义，生成同步建议并写入队列。

```bash
drift diff                    # 分析两侧所有变更
drift diff --side design      # 只分析设计侧的变更
drift diff --side code        # 只分析实现侧的变更
drift diff --no-ai            # 只做结构 diff，跳过 AI 分析
```

执行流程：

1. 读取上次快照（`snapshot.json`）
2. 扫描两侧当前文件树，生成新快照
3. 对比快照，生成 `FileChange[]`（结构层 diff）
4. 过滤出 `content-changed` 类型，按映射关系分组
5. 批量调用 AI Analyzer 分析语义意图
6. 生成 `SyncSuggestion[]`，追加写入 `queue.json`
7. 更新 `snapshot.json`
8. 终端输出分析报告

输出示例：

```
✔ 扫描完成  design: 24 文件  code: 31 文件

变更摘要
  design 侧  3 处变更
    ● Button.tsx          content-changed
    ● Modal.tsx           content-changed
    + LoadingSpinner.tsx  added

  code 侧    1 处变更
    ● Home.tsx            content-changed

AI 语义分析
  ✔ Button.tsx     → [样式调整] hover 状态颜色从 blue-500 改为 blue-600，需同步到 code
  ✔ Modal.tsx      → [交互变化] 新增 onBackdropClick 回调，需同步到 code
  ✔ LoadingSpinner → [新增组件] design 侧新增，code 侧尚未实现
  ✔ Home.tsx       → [逻辑变化] 新增分页逻辑，design 侧未反映

已写入 4 条同步建议到队列  运行 drift status 查看详情
```

---

### `drift sync`

从队列中取出待处理项，生成结构化的同步 prompt，可直接发送给 Claude Code 或 Claude Design。

```bash
drift sync --to code           # 生成"将 design 变更同步到 code"的 prompt
drift sync --to design         # 生成"将 code 变更同步到 design"的 prompt
drift sync --id <changeId>     # 只处理指定的变更项
drift sync --to code --copy    # 生成后自动复制到剪贴板
drift sync --to code --out ./prompt.md  # 输出到文件
```

执行流程：

1. 读取 `queue.json`，过滤目标侧的 pending 项
2. 交互式展示待同步项，让用户选择本次要处理哪些（多选）
3. 调用 PromptBuilder 生成完整 prompt（含相关文件内容）
4. 输出到终端 / 剪贴板 / 文件
5. 将选中项状态更新为 `in-progress`

生成的 prompt 结构（见第 9 节详细说明）。

---

### `drift status`

查看当前同步队列状态，支持标记完成或跳过。

```bash
drift status                   # 展示所有待处理项
drift status --all             # 包含已完成和已跳过的历史
drift status done <id>         # 标记某项为完成
drift status skip <id>         # 标记某项为跳过，附加原因
```

输出示例：

```
同步队列  4 pending  1 done

● PENDING  [high]   Button.tsx → code     样式调整：hover 颜色变更
● PENDING  [high]   Modal.tsx → code      交互变化：新增 onBackdropClick
● PENDING  [medium] LoadingSpinner → code 新增组件：design 侧已有，code 侧未实现
● PENDING  [low]    Home.tsx → design     逻辑变化：分页逻辑需在设计稿反映
✔ DONE     [medium] NavBar.tsx → code     已于 2026-05-28 完成同步
```

---

### `drift log`

查看历史 diff 报告。

```bash
drift log                      # 列出所有历史报告
drift log --last               # 查看最近一次报告
drift log 2026-05-30           # 查看指定日期的报告
```

---

## 7. 核心模块设计

### Scanner

职责：遍历目标目录，生成文件快照。

```typescript
// src/core/scanner.ts

interface ScanOptions {
  root: string
  exclude: string[]    // glob 排除规则，如 ['**/*.test.tsx', '**/node_modules/**']
  extensions: string[] // 只扫描指定扩展名，默认 ['.tsx', '.ts', '.jsx', '.js', '.css', '.html']
}

async function scan(options: ScanOptions): Promise<Record<string, FileSnapshot>>
```

关键实现细节：

- 使用 `fast-glob` 进行高性能文件遍历
- hash 采用 `SHA-256`，对内容 hash（不对路径 hash），确保重命名检测准确
- 跳过 `.sync/`、`node_modules/`、`dist/`、`.git/` 等目录
- 支持增量扫描：对比上次快照，只读取 `lastModified` 变化的文件

---

### Differ

职责：对比两次快照，分类变更类型。不调用 AI，纯机器判断。

```typescript
// src/core/differ.ts

interface DiffResult {
  changes: FileChange[]
  summary: {
    added: number
    deleted: number
    renamed: number
    contentChanged: number
  }
}

function diff(previous: ProjectSnapshot, current: ProjectSnapshot): DiffResult
```

分类逻辑：

```
hash 相同，路径相同  → 未变更，跳过
hash 相同，路径不同  → renamed（重命名/移动）
hash 不同            → content-changed
旧快照有，新快照没有 → deleted（先检查是否是 renamed 的源头）
新快照有，旧快照没有 → added
```

重命名检测算法：

先收集所有 `deleted` 和 `added` 项，尝试用 hash 做交叉匹配。`hash(deleted) ∈ hash(added)` 即判定为 `renamed`，从 deleted/added 中移除，添加为 renamed。

---

### Mapper

职责：根据配置中的 `mappings`，建立设计文件与实现文件之间的对应关系。

```typescript
// src/core/mapper.ts

interface MappedPair {
  designPath: string | null
  codePath: string | null
  isMapped: boolean    // false 表示只在一侧存在，没有映射关系
}

function resolveMappings(
  designFiles: string[],
  codeFiles: string[],
  config: DriftConfig
): MappedPair[]
```

映射解析策略（优先级从高到低）：

1. `config.mappings` 中的**显式映射**：精确匹配，优先级最高
2. **路径相似度自动推断**：`components/Button.tsx` ↔ `components/ui/Button.tsx`，用文件名 + 目录层级计算相似度
3. **未匹配文件**：标记为孤立文件（orphan），在报告中单独列出

---

## 8. AI 分析层

### Analyzer 整体设计

```typescript
// src/core/analyzer.ts

interface AnalyzeOptions {
  changes: FileChange[]
  mappedPairs: MappedPair[]
  config: DriftConfig
}

async function analyze(options: AnalyzeOptions): Promise<SyncSuggestion[]>
```

### 批处理策略

不逐文件调用 API，按"变更批次"聚合：

- 同一组件的多个相关文件（如 `Button.tsx` + `Button.css`）合并为一次调用
- 批次大小由 `config.ai.batchSize` 控制（默认 5 个文件/批）
- 并发数由 `config.ai.maxConcurrency` 控制（默认 3）
- 使用指数退避处理 rate limit 错误

### Prompt 设计

发送给 Claude API 的分析 prompt：

```
你是一个资深前端工程师，正在分析设计稿与生产代码之间的差异。

## 背景

这是一个使用 Claude Design 和 Claude Code 开发的项目。
- 设计稿是高保真交互式 React 原型，表达产品的视觉和交互意图
- 实现代码是基于设计稿的生产实现，关注工程质量和业务逻辑
- 两侧是同一产品意图的不同表达形态，不是同一份代码的副本

## 本次变更（design 侧）

### 文件：components/Button.tsx
变更类型：content-changed

diff:
[unified diff 内容]

### 对应的 code 侧现有实现

[code 侧 Button.tsx 的完整内容]

## 分析要求

请分析此次变更的**意图**，并回答：

1. intent: 变更类型（feature-add / style-change / interaction-change / refactor / props-change / logic-change）
2. summary: 一句话描述变更意图（不超过 50 字）
3. impact: 对另一侧的影响程度（high / medium / low）
4. syncNeeded: 另一侧是否需要同步（true / false）
5. syncGuide: 如果需要同步，code 侧具体需要做什么（3-5 点，简洁明确）

以 JSON 格式输出，不要输出其他内容。
```

### 响应解析

```typescript
interface AIAnalysisResult {
  intent: IntentType
  summary: string
  impact: 'high' | 'medium' | 'low'
  syncNeeded: boolean
  syncGuide: string[]
}
```

---

## 9. 输出层

### PromptBuilder — 同步 Prompt 结构

生成的 prompt 需要包含完整上下文，让 Claude Code / Claude Design 能够直接基于它工作，不需要额外补充信息。

```markdown
# drift-sync 同步任务

## 任务说明

你是一个专业的前端工程师。以下是从 Claude Design 侧检测到的变更，
需要你将这些变更同步到实际生产代码中。

**变更意图**：[样式调整] Button 组件 hover 状态颜色从 blue-500 改为 blue-600
**影响级别**：medium
**变更来源**：design/components/Button.tsx

---

## Design 侧变更内容

### design/components/Button.tsx（变更后完整内容）

\`\`\`tsx
[文件完整内容]
\`\`\`

**变更摘要**（diff）：
\`\`\`diff
[unified diff]
\`\`\`

---

## Code 侧现有实现

### src/components/ui/Button.tsx（当前内容）

\`\`\`tsx
[文件完整内容]
\`\`\`

---

## 同步指南

根据 AI 分析，code 侧需要做以下调整：

1. 将 `hover:bg-blue-500` 改为 `hover:bg-blue-600`
2. 同步更新 `ButtonProps` 中的 variant 类型定义（如有）
3. 检查是否有其他使用 blue-500 的 hover 状态需要一并调整

---

## 注意事项

- 只同步**意图**，不要直接复制设计稿代码
- 保持 code 侧现有的工程结构和命名规范
- 如有不确定的地方，保留 code 侧的实现，并在回复中说明
```

### Reporter — 终端输出规范

使用 `chalk` 着色，`ora` 显示进度，`cli-table3` 渲染表格。

颜色规范：

| 场景 | 颜色 |
|------|------|
| 新增文件 | green |
| 删除文件 | red |
| 内容变更 | yellow |
| 重命名 | cyan |
| 高影响同步建议 | red + bold |
| 中影响 | yellow |
| 低影响 | gray |
| 成功/完成 | green |
| 错误 | red + bold |

### Exporter — 导出格式

Markdown 报告（写入 `.sync/history/`）：

```markdown
# Drift Report — 2026-05-30T10:00:00

## 变更摘要
- design 侧：3 处变更
- code 侧：1 处变更

## 变更详情
...

## 同步建议
...

## 统计
- 扫描文件数：design 24，code 31
- AI 分析耗时：2.3s
- 消耗 tokens：约 1,200
```

---

## 10. 配置系统

### `.sync/config.json` 完整示例

```json
{
  "version": "1.0",
  "design": {
    "root": "./design",
    "exclude": [
      "**/*.test.tsx",
      "**/*.stories.tsx",
      "**/node_modules/**",
      "**/.next/**"
    ]
  },
  "code": {
    "root": "./src",
    "exclude": [
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/node_modules/**",
      "**/dist/**"
    ]
  },
  "mappings": [
    {
      "design": "components/Button.tsx",
      "code": "components/ui/Button.tsx",
      "note": "设计稿用简单结构，实现侧用 shadcn/ui 封装"
    },
    {
      "design": "components/**/*.tsx",
      "code": "components/ui/**/*.tsx",
      "note": "通用组件映射规则"
    },
    {
      "design": "pages/Home.tsx",
      "code": "app/page.tsx",
      "note": "Next.js App Router 结构不同"
    }
  ],
  "ai": {
    "model": "claude-sonnet-4-20250514",
    "batchSize": 5,
    "maxConcurrency": 3
  }
}
```

### 环境变量

```bash
ANTHROPIC_API_KEY=sk-...        # 必须
DRIFT_MODEL=claude-sonnet-4-20250514   # 可选，覆盖配置文件
DRIFT_DEBUG=true                # 可选，输出详细日志
```

---

## 11. 状态管理

### `.sync/snapshot.json` 结构

```json
{
  "capturedAt": 1748599200000,
  "design": {
    "components/Button.tsx": {
      "hash": "a1b2c3d4...",
      "lastModified": 1748599100000,
      "size": 1240
    }
  },
  "code": {
    "components/ui/Button.tsx": {
      "hash": "e5f6g7h8...",
      "lastModified": 1748590000000,
      "size": 2180
    }
  }
}
```

### `.sync/queue.json` 结构

```json
{
  "updatedAt": 1748599200000,
  "items": [
    {
      "id": "chg_20260530_001",
      "createdAt": 1748599200000,
      "status": "pending",
      "suggestion": {
        "sourceSide": "design",
        "targetSide": "code",
        "intent": "style-change",
        "summary": "Button hover 颜色从 blue-500 改为 blue-600",
        "impact": "medium",
        "affectedFiles": ["src/components/ui/Button.tsx"],
        "syncPrompt": "..."
      }
    }
  ]
}
```

---

## 12. 错误处理

### 错误分类与处理策略

| 错误类型 | 处理方式 |
|----------|----------|
| 配置文件不存在 | 提示运行 `drift init`，退出 |
| 文件读取权限错误 | 跳过该文件，在报告中标注，继续处理其他文件 |
| Claude API rate limit | 指数退避重试，最多 3 次，超过则跳过该批次并提示 |
| Claude API 响应解析失败 | 降级：跳过 AI 分析，只输出结构 diff，提示用户手动判断 |
| 网络超时 | 超时设置 30s，失败后保存已完成的分析结果，允许用户重试剩余部分 |
| queue.json 写入失败 | 先写临时文件，再原子替换，避免文件损坏 |

### 降级策略

当 AI 分析不可用时（无 API key、网络故障、rate limit 耗尽），工具不崩溃，而是：

1. 正常完成结构层 diff
2. 在报告中标注"AI 分析不可用"
3. `content-changed` 的文件输出 unified diff，让用户自行判断
4. 仍然生成同步建议，但 `syncGuide` 为空，`syncPrompt` 只包含 diff 内容

---

## 13. 技术选型

### 核心依赖

| 包 | 版本 | 用途 |
|----|------|------|
| `commander` | ^12.0 | CLI 框架，子命令管理 |
| `fast-glob` | ^3.3 | 高性能文件遍历 |
| `chalk` | ^5.3 | 终端颜色输出 |
| `ora` | ^8.0 | 加载进度动画 |
| `inquirer` | ^9.0 | 交互式命令行 prompt |
| `cli-table3` | ^0.6 | 终端表格渲染 |
| `@anthropic-ai/sdk` | ^0.24 | Claude API 调用 |
| `p-limit` | ^5.0 | 并发控制 |
| `p-retry` | ^6.0 | 指数退避重试 |
| `diff` | ^5.2 | unified diff 生成 |
| `zod` | ^3.22 | 配置文件 schema 校验 |

### 开发依赖

| 包 | 用途 |
|----|------|
| `typescript` | 类型系统 |
| `tsup` | 打包构建 |
| `vitest` | 单元测试 |
| `@types/node` | Node.js 类型 |

### Node.js 版本要求

`>= 18.0.0`（使用原生 `crypto.createHash`，无需额外依赖）

### 构建产物

```json
{
  "bin": {
    "drift": "./dist/index.js"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts"
}
```

---

## 14. 开发路线图

### v0.1 — MVP（核心骨架）

- `init` 命令：配置初始化、初始快照生成
- `diff` 命令：结构层 diff（不含 AI 分析）
- `status` 命令：基础队列查看
- State Store：snapshot / queue 读写
- Scanner + Differ 模块

目标：跑通基本工作流，验证文件映射和 diff 逻辑。

### v0.2 — AI 集成

- Analyzer 模块：Claude API 批量调用
- PromptBuilder：完整 prompt 生成
- `sync` 命令：队列管理 + prompt 输出
- `--copy` 和 `--out` 选项
- 错误处理 + 降级策略

目标：完整的核心功能闭环。

### v0.3 — 体验优化

- `log` 命令：历史报告查看
- Reporter 优化：更丰富的终端输出格式
- Exporter：Markdown 报告导出
- 自动映射推断：基于路径相似度
- 配置向导：`init` 时的交互式配置

### v0.4 — 稳定性与扩展

- 完整测试覆盖（Scanner / Differ / Analyzer）
- `--watch` 模式：文件系统监听，自动触发 diff
- VSCode 扩展（可选）：在编辑器侧边栏查看同步状态
- npm 发布：`npm install -g drift-sync`

---

## 15. 使用流程示例

### 初次使用

```bash
# 安装
npm install -g drift-sync

# 在项目根目录初始化
cd your-project
drift init --design ./design --code ./src

# 输出：
# ✔ 配置已写入 .sync/config.json
# ✔ 扫描完成：design 24 文件，code 31 文件
# ✔ 初始快照已保存到 .sync/snapshot.json
# 运行 drift diff 开始检测变更
```

### 日常迭代工作流

```bash
# 场景：在 Claude Design 更新了 Button 和 Modal 组件

# 1. 检测变更
drift diff

# 2. 查看同步队列
drift status

# 3. 生成同步 prompt，复制到剪贴板
drift sync --to code --copy

# 4. 粘贴给 Claude Code，完成同步开发

# 5. 标记为已完成
drift status done chg_20260530_001
```

### 反向同步场景

```bash
# 场景：在 Claude Code 中先优化了某功能，需要同步回 Claude Design

drift diff --side code
drift sync --to design --copy

# 粘贴给 Claude Design，更新设计稿
```

---

*文档版本：v0.1 | 最后更新：2026-05-30*
