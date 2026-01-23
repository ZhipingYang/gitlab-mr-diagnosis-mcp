# GitLab MR Diagnosis MCP - 技术文档

> 详细的技术实现、架构说明和 API 参考文档

## 目录

- [系统架构](#系统架构)
- [MCP 协议集成](#mcp-协议集成)
- [核心服务模块](#核心服务模块)
- [数据流与处理流程](#数据流与处理流程)
- [正则表达式详解](#正则表达式详解)
- [类型系统](#类型系统)
- [配置系统](#配置系统)
- [错误处理策略](#错误处理策略)
- [扩展与自定义](#扩展与自定义)

---

## 系统架构

### 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           MCP Server Layer                               │
│                          (src/index.ts)                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                      │
│  │ diagnose_mr │  │get_mr_comments│ │get_console_log│  ← MCP Tools      │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                      │
├─────────┼────────────────┼────────────────┼─────────────────────────────┤
│         │                │                │     Orchestration Layer      │
│         ▼                │                │                              │
│  ┌─────────────────────┐ │                │                              │
│  │   MRDiagnosisTool   │ │                │     (tools/diagnose.ts)     │
│  │  - diagnose()       │◄┘                │                              │
│  │  - formatResult()   │                  │                              │
│  └──────────┬──────────┘                  │                              │
├─────────────┼─────────────────────────────┼─────────────────────────────┤
│             │                             │       Service Layer          │
│  ┌──────────▼──────────┐  ┌──────────────▼──────────┐                   │
│  │   GitLabService     │  │     JenkinsService      │                   │
│  │  - parseMRUrl()     │  │  - getConsoleLog()      │                   │
│  │  - getMRComments()  │  │  - getUncoveredFiles()  │                   │
│  │  - getMRInfo()      │  │  - getCoverageReport()  │                   │
│  └──────────┬──────────┘  └──────────────┬──────────┘                   │
│             │                             │                              │
│  ┌──────────▼──────────┐  ┌──────────────▼──────────┐                   │
│  │   CommentParser     │  │   ConsoleLogParser      │                   │
│  │  - parseComment()   │  │  - parseFailedTests()   │                   │
│  │  - parseStages()    │  │  - parseCoverageStats() │                   │
│  │  - isFullBuild()    │  │  - parseUncoveredFiles()│                   │
│  └─────────────────────┘  └─────────────────────────┘                   │
├─────────────────────────────────────────────────────────────────────────┤
│                         Infrastructure Layer                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                      │
│  │   types.ts  │  │ constants.ts│  │  config.ts  │                      │
│  └─────────────┘  └─────────────┘  └─────────────┘                      │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │      External Services        │
              │  ┌─────────┐    ┌─────────┐  │
              │  │ GitLab  │    │ Jenkins │  │
              │  │   API   │    │   API   │  │
              │  └─────────┘    └─────────┘  │
              └───────────────────────────────┘
```

### 模块职责划分

| 层级 | 模块 | 职责 |
|------|------|------|
| **MCP Layer** | `index.ts` | MCP 协议处理、工具注册、请求路由 |
| **Orchestration** | `MRDiagnosisTool` | 业务流程编排、结果聚合、报告生成 |
| **Service** | `GitLabService` | GitLab API 交互 |
| **Service** | `JenkinsService` | Jenkins Console Log 获取 |
| **Parser** | `CommentParser` | MR 评论解析 |
| **Parser** | `ConsoleLogParser` | 构建日志解析 |
| **Infra** | `types.ts` | TypeScript 类型定义 |
| **Infra** | `constants.ts` | 常量和正则表达式 |
| **Infra** | `config.ts` | 配置加载和验证 |

---

## MCP 协议集成

### MCP Server 实现

服务使用 `@modelcontextprotocol/sdk` 实现 MCP 协议：

```typescript
// src/index.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({
  name: 'gitlab-mr-diagnosis-mcp',
  version: '1.0.0',
});

// 注册工具
server.tool('diagnose_mr', schema, handler);
server.tool('get_mr_comments', schema, handler);
server.tool('get_console_log', schema, handler);

// 启动服务器
const transport = new StdioServerTransport();
await server.connect(transport);
```

### 工具定义

#### 1. `diagnose_mr` - 完整诊断工具

```typescript
{
  name: 'diagnose_mr',
  description: '诊断 GitLab MR 的 Pipeline 构建状态',
  inputSchema: {
    type: 'object',
    properties: {
      mr_url: {
        type: 'string',
        description: 'GitLab MR URL'
      },
      gitlab_token: {
        type: 'string',
        description: 'GitLab Private Token (可选，优先使用环境变量)'
      },
      diff_coverage_gate: {
        type: 'number',
        description: 'Diff Coverage 阈值 (默认 90)'
      }
    },
    required: ['mr_url']
  }
}
```

**处理流程**：
1. 解析 MR URL → 提取 `projectId` 和 `mrIid`
2. 调用 GitLab API → 获取 MR 评论列表
3. 解析评论 → 找到最新的完整构建（含 UT + Coverage）
4. 获取 Console Log → 从 Jenkins 获取构建日志
5. 解析日志 → 提取失败测试、覆盖率统计
6. 生成报告 → 格式化输出诊断结果

#### 2. `get_mr_comments` - 获取评论工具

```typescript
{
  name: 'get_mr_comments',
  description: '获取 GitLab MR 的所有评论（原始数据）',
  inputSchema: {
    type: 'object',
    properties: {
      mr_url: { type: 'string' },
      gitlab_token: { type: 'string' },
      per_page: { type: 'number', default: 50 }
    },
    required: ['mr_url']
  }
}
```

#### 3. `get_console_log` - 获取 Jenkins 日志

```typescript
{
  name: 'get_console_log',
  description: '获取 Jenkins 构建的 Console Log',
  inputSchema: {
    type: 'object',
    properties: {
      build_url: { type: 'string' },
      search_pattern: { type: 'string', description: '正则搜索模式 (可选)' }
    },
    required: ['build_url']
  }
}
```

---

## 核心服务模块

### 1. GitLabService (`services/gitlab.ts`)

#### 类定义

```typescript
export class GitLabService {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string);

  // 解析 MR URL
  parseMRUrl(url: string): { projectId: string; mrIid: number } | null;

  // 获取 MR 评论列表
  async getMRComments(projectId: string, mrIid: number, perPage?: number): Promise<GitLabComment[]>;

  // 获取 MR 基本信息
  async getMRInfo(projectId: string, mrIid: number): Promise<any>;
}
```

#### URL 解析逻辑

支持两种 GitLab MR URL 格式：

```typescript
// 格式 1: 标准格式 (/-/merge_requests/)
// https://gitlab.example.com/group/project/-/merge_requests/123
const REGEX_MR_URL_PATTERN_1 = /https?:\/\/[^\/]+\/([^\/]+\/[^\/]+)\/-\/merge_requests\/(\d+)/;

// 格式 2: 旧格式 (/merge_requests/)
// https://gitlab.example.com/group/project/merge_requests/123
const REGEX_MR_URL_PATTERN_2 = /https?:\/\/[^\/]+\/([^\/]+\/[^\/]+)\/merge_requests\/(\d+)/;

// 解析示例
parseMRUrl('https://git.example.com/Fiji/Fiji/-/merge_requests/41234')
// 返回: { projectId: 'Fiji/Fiji', mrIid: 41234 }
```

#### API 调用

```typescript
// GET /api/v4/projects/:id/merge_requests/:merge_request_iid/notes
async getMRComments(projectId: string, mrIid: number): Promise<GitLabComment[]> {
  const encodedProjectId = encodeURIComponent(projectId);
  const url = `${this.baseUrl}/api/v4/projects/${encodedProjectId}/merge_requests/${mrIid}/notes`;

  const response = await fetch(url, {
    headers: {
      'PRIVATE-TOKEN': this.token,
      'Content-Type': 'application/json',
    },
  });

  return response.json();
}
```

### 2. JenkinsService (`services/jenkins.ts`)

#### 类定义

```typescript
export class JenkinsService {
  // 获取 Console Log
  async getConsoleLog(consoleLogUrl: string): Promise<string>;

  // 获取覆盖率报告 HTML
  async getCoverageReportHtml(buildUrl: string): Promise<string>;

  // 解析 Diff Coverage 报告
  parseDiffCoverageReportHtml(html: string, gate: number): UncoveredFile[];

  // 获取未覆盖文件列表
  async getUncoveredFiles(buildUrl: string, gate: number): Promise<UncoveredFile[]>;
}
```

#### Console Log 获取

```typescript
async getConsoleLog(consoleLogUrl: string): Promise<string> {
  // consoleLogUrl 格式: https://jenkins.example.com/job/.../123/consoleText
  const response = await fetch(consoleLogUrl);
  return response.text();
}
```

#### 覆盖率报告解析

从 Jenkins 的 Coverage Report 页面提取未覆盖文件：

```typescript
async getUncoveredFiles(buildUrl: string, gate: number): Promise<UncoveredFile[]> {
  // 1. 获取覆盖率报告 HTML
  const html = await this.getCoverageReportHtml(buildUrl);

  // 2. 解析 HTML 表格，提取文件覆盖率
  return this.parseDiffCoverageReportHtml(html, gate);
}
```

### 3. CommentParser (`services/commentParser.ts`)

#### 评论类型识别

```typescript
type CommentType = 'jenkins_build' | 'e2e_result' | 'deploy_ready' | 'user_command' | 'system' | 'other';

getCommentType(comment: GitLabComment): CommentType {
  const body = comment.body;

  // 系统评论
  if (comment.system) return 'system';

  // Jenkins 构建结果
  if (body.includes('FAILURE:') || body.includes('SUCCESS:') ||
      body.includes('jenkins-CommonCI-Jupiter-Web-MR')) {
    return 'jenkins_build';
  }

  // E2E 结果
  if (body.includes('Jupiter-E2E') &&
      (body.includes('SUCCESS') || body.includes('FAILURE'))) {
    return 'e2e_result';
  }

  // 部署就绪
  if (body.includes('Deploy:') && body.includes('is ready')) {
    return 'deploy_ready';
  }

  // 用户命令
  if (['build', 'review', 'e2e-run'].some(cmd => body.trim().startsWith(cmd))) {
    return 'user_command';
  }

  return 'other';
}
```

#### Jenkins 构建信息解析

从评论中提取构建详情：

```typescript
parseJenkinsBuildInfo(body: string): JenkinsBuildInfo | null {
  // 匹配构建 URL
  // 格式: [jenkins-CommonCI-Jupiter-Web-MR-Auto-Generate-456](https://jenkins.../display/redirect)
  const buildUrlMatch = body.match(REGEX_JENKINS_BUILD_URL);
  if (!buildUrlMatch) return null;

  const buildNumber = parseInt(buildUrlMatch[1], 10);  // 456
  const buildUrl = buildUrlMatch[2];                    // https://jenkins.../display/redirect

  // 构造 Console Log URL
  const consoleLogUrl = buildUrl
    .replace('/display/redirect', '')
    .replace(/\/$/, '') + '/consoleText';

  // 提取状态
  const isSuccess = body.includes('🟢 SUCCESS');
  const isFailure = body.includes('🚫 FAILURE');

  // 提取触发者
  const triggeredByMatch = body.match(/Triggered by ([^\[]+)/);
  const triggeredBy = triggeredByMatch ? triggeredByMatch[1].trim() : 'Unknown';

  // 提取分支信息
  const branchMatch = body.match(/Fiji\/([^\s]+)\s*=>\s*(\w+)/);

  return {
    buildNumber,
    buildUrl: buildUrl.replace('/display/redirect', ''),
    consoleLogUrl,
    blueOceanUrl: buildUrl,
    status: isSuccess ? 'SUCCESS' : isFailure ? 'FAILURE' : 'UNKNOWN',
    triggeredBy,
    sourceBranch: branchMatch ? branchMatch[1] : '',
    targetBranch: branchMatch ? branchMatch[2] : '',
    // ...
  };
}
```

#### 阶段状态解析

解析 Jenkins 评论中的阶段状态表格：

```typescript
// 表格格式:
// | stage | status | report | duration |
// |-------|--------|--------|----------|
// | checkout | ✅ |  | 10s |
// | phone ut | 🚫 | [Test Report](url) | 5m |

parseStageStatuses(body: string): StageStatus[] {
  const stages: StageStatus[] = [];
  const tableRowRegex = /\|\s*(\w+[\w\s+:]*)\s*\|\s*(✅|🚫|⏩|🔄)\s*\|([^|]*)\|([^|]*)\|/g;

  let match;
  while ((match = tableRowRegex.exec(body)) !== null) {
    const stageName = match[1].trim();
    const statusIcon = match[2];
    const reporters = match[3].trim();

    // 跳过表头
    if (stageName === 'stage' || stageName === '-----') continue;

    // 状态映射
    let status: StageStatus['status'];
    switch (statusIcon) {
      case '✅': status = 'SUCCESS'; break;
      case '🚫': status = 'FAILURE'; break;
      case '⏩': status = 'SKIPPED'; break;
      default: status = 'RUNNING';
    }

    // 提取报告 URLs
    const testReportMatch = reporters.match(/\[[\w\s]+Test Report\]\(([^\)]+)\)/);
    const coverageReportMatch = reporters.match(/\[[\w\s]+Coverage Report\]\(([^\)]+)\)/);

    stages.push({
      name: stageName,
      status,
      testReportUrl: testReportMatch?.[1],
      coverageReportUrl: coverageReportMatch?.[1],
    });
  }

  return stages;
}
```

#### 构建类型判断

区分完整构建和 build-only：

```typescript
// 完整构建判断
isFullBuild(stages: StageStatus[]): boolean {
  // 必须同时包含:
  // 1. UT 阶段 (phone ut, message ut, app ut, ai ut 等)
  // 2. diffcoverage 阶段
  const hasUT = stages.some(stage =>
    stage.name.toLowerCase().includes(' ut') ||
    stage.name.toLowerCase() === 'ut'
  );

  const hasDiffCoverage = stages.some(stage =>
    stage.name.toLowerCase().includes('diffcoverage')
  );

  return hasUT && hasDiffCoverage;
}

// Build-only 判断
isBuildOnly(stages: StageStatus[]): boolean {
  // 条件:
  // 1. 阶段数 ≤ 5
  // 2. 只包含基础阶段
  if (stages.length > BUILD_ONLY_MAX_STAGES) return false;

  const BASIC_STAGES = ['checkout', 'install', 'build+deploy:rc', 'build', 'deploy'];

  return stages.every(stage =>
    BASIC_STAGES.some(basic => stage.name.toLowerCase().includes(basic))
  );
}
```

### 4. ConsoleLogParser (`services/consoleLogParser.ts`)

#### 失败测试解析

```typescript
parseFailedTests(log: string): FailedTestCase[] {
  const failedTests: FailedTestCase[] = [];
  const seenTests = new Set<string>();
  const seenFiles = new Set<string>();

  // 匹配失败的测试文件
  // 格式: FAIL project/phone/core/src/__tests__/example.test.ts
  const failPattern = /FAIL(?:\s+UT)?\s+(project\/[^\s]+\.test\.[tj]sx?)/g;

  let match;
  while ((match = failPattern.exec(log)) !== null) {
    const testFile = match[1];

    // 跳过已处理的文件
    if (seenFiles.has(testFile)) continue;
    seenFiles.add(testFile);

    // 提取上下文日志 (50000 字符范围)
    const contextLog = log.substring(
      match.index,
      Math.min(match.index + FAILED_TEST_SEARCH_RANGE, log.length)
    );

    // 解析具体测试用例
    // 格式: ● Example Suite › should work correctly
    const testNamePattern = /(?:\[[\d\-T:.Z]+\]\s*)?●\s+([^\n]+)/g;

    let testMatch;
    while ((testMatch = testNamePattern.exec(contextLog)) !== null) {
      const fullTestPath = testMatch[1].trim();
      const parts = fullTestPath.split(/\s*›\s*/);

      if (parts.length < 2) continue;

      const testName = parts.pop()!.trim();
      const testSuite = parts.join(' › ').trim();

      // 提取错误信息
      const testContext = contextLog.substring(
        testMatch.index,
        testMatch.index + TEST_CONTEXT_RANGE
      );
      const errorMatch = REGEX_ERROR_PATTERN.exec(testContext);

      const testCase: FailedTestCase = {
        testFile,
        testSuite,
        testName,
        errorType: errorMatch?.[1],
        errorMessage: errorMatch?.[2]?.trim().substring(0, MAX_ERROR_MESSAGE_LENGTH),
      };

      // 去重
      const key = `${testCase.testFile}|${testCase.testSuite}|${testCase.testName}`;
      if (!seenTests.has(key)) {
        seenTests.add(key);
        failedTests.push(testCase);
      }
    }
  }

  return failedTests;
}
```

#### 覆盖率统计解析

```typescript
parseCoverageStats(log: string): CoverageStats[] {
  const stats: CoverageStats[] = [];

  // 匹配 Overall Diff Coverage 统计
  // 格式: Overall Diff Coverage Statistics: diffLines: 200, coveredDiffLines: 171,
  //       uncoveredDiffLines: 29, diffCoverage: 85.5%, overallCoverage: 72.3%
  const overallDiffMatch = log.match(REGEX_OVERALL_DIFF_COVERAGE);

  if (overallDiffMatch) {
    stats.push({
      type: 'overall',
      diffLines: parseInt(overallDiffMatch[1], 10),
      coveredDiffLines: parseInt(overallDiffMatch[2], 10),
      uncoveredDiffLines: parseInt(overallDiffMatch[3], 10),
      diffCoverage: parseFloat(overallDiffMatch[4]),
      overallCoverage: parseFloat(overallDiffMatch[5]),
    });
  }

  // 匹配 Overall Coverage 统计 (行/分支/语句/函数覆盖率)
  const overallCoverageMatch = log.match(REGEX_OVERALL_COVERAGE);

  if (overallCoverageMatch && stats.length > 0) {
    const overall = stats.find(s => s.type === 'overall');
    if (overall) {
      overall.lineCoverage = parseFloat(overallCoverageMatch[1]);
      overall.branchCoverage = parseFloat(overallCoverageMatch[2]);
      overall.statementCoverage = parseFloat(overallCoverageMatch[3]);
      overall.functionCoverage = parseFloat(overallCoverageMatch[4]);
    }
  }

  // 匹配 Phone 模块单独统计
  const phoneDiffMatch = log.match(REGEX_PHONE_DIFF_COVERAGE);
  if (phoneDiffMatch) {
    stats.push({
      type: 'phone',
      diffLines: parseInt(phoneDiffMatch[1], 10),
      coveredDiffLines: parseInt(phoneDiffMatch[2], 10),
      uncoveredDiffLines: parseInt(phoneDiffMatch[3], 10),
      diffCoverage: parseFloat(phoneDiffMatch[4]),
      overallCoverage: parseFloat(phoneDiffMatch[5]),
    });
  }

  return stats;
}
```

#### 未覆盖文件解析

支持多种格式：

```typescript
parseUncoveredFiles(log: string): UncoveredFile[] {
  const files: UncoveredFile[] = [];

  // 方法1: 表格格式
  // | project/xxx/file.ts | 50% | 10 |
  const tablePattern = /\|\s*(project\/[^\s|]+)\s*\|\s*([\d.]+)%?\s*\|\s*(\d+)\s*\|/g;

  // 方法2: 内联格式
  // file.ts: 80% (uncovered: 10-15, 20)
  const inlinePattern = /(project\/[^\s:]+\.tsx?)[:\s]+([\d.]+)%[^(]*\(uncovered[:\s]*([^)]+)\)/gi;

  // 方法3: 报告格式
  // project/xxx/file.ts | 85.5% | Lines: 10, 15-20, 30
  const reportPattern = /(project\/[^\s|]+\.tsx?)\s*\|\s*([\d.]+)%\s*\|\s*(?:Lines?[:\s]*)?([\d,\s\-]+)/gi;

  // 解析并计算未覆盖行数...
  // 按覆盖率排序 (低覆盖率在前)
  files.sort((a, b) => a.coverage - b.coverage);

  return files;
}
```

---

## 数据流与处理流程

### 完整诊断流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          diagnose_mr 调用流程                                │
└─────────────────────────────────────────────────────────────────────────────┘

     Input: MR URL
         │
         ▼
    ┌────────────┐
    │ parseMRUrl │ ──► 提取 projectId, mrIid
    └─────┬──────┘
          │
          ▼
    ┌────────────────┐
    │ getMRComments  │ ──► GitLab API: GET /api/v4/projects/:id/merge_requests/:iid/notes
    └─────┬──────────┘
          │
          ▼ (评论列表，按时间倒序)
    ┌─────────────────────────┐
    │ findLatestFullBuildComment │
    │  for each comment:         │
    │    1. parseComment()       │
    │    2. 检查是否为 jenkins_build │
    │    3. 检查 isFullBuild()   │
    └─────┬───────────────────┘
          │
          │ 未找到完整构建?
          ├────────────────────► 返回提示: "需要触发完整构建"
          │
          ▼ (找到完整构建)
    ┌────────────────┐
    │ getConsoleLog  │ ──► Jenkins: GET /job/.../consoleText
    └─────┬──────────┘
          │
          ▼ (Console Log 文本)
    ┌───────────────────────────────┐
    │     ConsoleLogParser.parseAll │
    │  ┌─────────────────────────┐  │
    │  │ parseFailedTests()      │  │──► FailedTestCase[]
    │  ├─────────────────────────┤  │
    │  │ parseCoverageStats()    │  │──► CoverageStats[]
    │  ├─────────────────────────┤  │
    │  │ parseUncoveredFiles()   │  │──► UncoveredFile[]
    │  ├─────────────────────────┤  │
    │  │ isDiffCoveragePassed()  │  │──► boolean
    │  └─────────────────────────┘  │
    └─────┬─────────────────────────┘
          │
          ▼
    ┌────────────────────┐
    │ 如果覆盖率未达标    │
    │ getUncoveredFiles  │ ──► 获取详细的未覆盖文件列表
    └─────┬──────────────┘
          │
          ▼
    ┌────────────────────┐
    │ calculateSummary   │ ──► DiagnosisSummary
    └─────┬──────────────┘
          │
          ▼
    ┌──────────────────────────┐
    │ generateRecommendations  │ ──► string[]
    └─────┬────────────────────┘
          │
          ▼
    ┌────────────────┐
    │  formatResult  │ ──► 格式化输出
    └────────────────┘
          │
          ▼
      MRDiagnosisResult
```

### 评论处理顺序

```
GitLab API 返回的评论 (按时间倒序)
    │
    ├── Comment N (最新)
    │     └── parseComment() → type: 'jenkins_build'
    │         └── isFullBuild() → false (build-only)
    │
    ├── Comment N-1
    │     └── parseComment() → type: 'user_command' ('build')
    │
    ├── Comment N-2
    │     └── parseComment() → type: 'jenkins_build'
    │         └── isFullBuild() → true ✅ (使用这个)
    │
    └── ... (更早的评论不再处理)
```

---

## 正则表达式详解

### 失败测试文件匹配

```typescript
// 匹配格式:
// FAIL project/phone/core/src/__tests__/example.test.ts
// FAIL UT project/message/ui/src/__tests__/chat.test.tsx

export const REGEX_FAIL_PATTERN = /FAIL(?:\s+UT)?\s+(project\/[^\s]+\.test\.[tj]sx?)/g;

// 解析:
// FAIL          - 字面量 "FAIL"
// (?:\s+UT)?    - 可选的 " UT" (非捕获组)
// \s+           - 一个或多个空白
// (project\/    - 捕获组开始，以 "project/" 开头
// [^\s]+        - 一个或多个非空白字符 (文件路径)
// \.test\.      - 字面量 ".test."
// [tj]sx?)      - "ts", "tsx", "js", 或 "jsx"
```

### 测试用例名称匹配

```typescript
// 匹配格式:
// ● Example Suite › should work correctly
// [2024-01-15T10:30:00.000Z] ● Auth › Login › should validate credentials

export const REGEX_TEST_NAME = /(?:\[[\d\-T:.Z]+\]\s*)?●\s+([^\n]+)/g;

// 解析:
// (?:\[[\d\-T:.Z]+\]\s*)?  - 可选的时间戳前缀 [2024-01-15T10:30:00.000Z]
// ●                        - 字面量圆点符号
// \s+                      - 一个或多个空白
// ([^\n]+)                 - 捕获组：直到换行的所有字符
```

### 错误类型和消息匹配

```typescript
// 匹配格式:
// TypeError: Cannot read property 'foo' of undefined
// ReferenceError: bar is not defined

export const REGEX_ERROR_PATTERN = /(TypeError|ReferenceError|SyntaxError|Error):\s*([^\n]+)/;

// 解析:
// (TypeError|...)  - 捕获组1：错误类型
// :\s*             - 冒号后可选空白
// ([^\n]+)         - 捕获组2：错误消息
```

### Diff Coverage 统计匹配

```typescript
// 匹配格式:
// Overall Diff Coverage Statistics: diffLines: 200, coveredDiffLines: 171,
// uncoveredDiffLines: 29, diffCoverage: 85.5%, overallCoverage: 72.3%

export const REGEX_OVERALL_DIFF_COVERAGE =
  /Overall Diff Coverage Statistics\*{0,2}[:\s]+diffLines[:\s]*(\d+)[,\s]*coveredDiffLines[:\s]*(\d+)[,\s]*uncoveredDiffLines[:\s]*(\d+)[,\s]*diffCoverage[:\s]*([\d.]+)%?[,\s]*overallCoverage[:\s]*([\d.]+)%?/i;

// 捕获组:
// $1 - diffLines (200)
// $2 - coveredDiffLines (171)
// $3 - uncoveredDiffLines (29)
// $4 - diffCoverage (85.5)
// $5 - overallCoverage (72.3)
```

### Jenkins 构建 URL 匹配

```typescript
// 匹配格式:
// [jenkins-CommonCI-Jupiter-Web-MR-Auto-Generate-456](https://jenkins.example.com/job/.../display/redirect)

export const REGEX_JENKINS_BUILD_URL =
  /\[jenkins-CommonCI-Jupiter-Web-MR-Auto-Generate-(\d+)\]\((https:\/\/[^\)]+)\)/;

// 捕获组:
// $1 - 构建号 (456)
// $2 - 构建 URL
```

### 阶段状态表格行匹配

```typescript
// 匹配格式:
// | checkout | ✅ | | 10s |
// | phone ut | 🚫 | [Test Report](url) | 5m |

export const REGEX_STAGE_TABLE_ROW =
  /\|\s*(\w+[\w\s+:]*)\s*\|\s*(✅|🚫|⏩|🔄)\s*\|([^|]*)\|([^|]*)\|/g;

// 捕获组:
// $1 - 阶段名称 (checkout, phone ut)
// $2 - 状态图标 (✅, 🚫, ⏩, 🔄)
// $3 - 报告链接区域
// $4 - 持续时间
```

---

## 类型系统

### GitLab 相关类型

```typescript
/** GitLab MR 评论 */
interface GitLabComment {
  id: number;                    // 评论 ID
  body: string;                  // 评论正文 (Markdown)
  author: {
    id: number;
    username: string;
    name: string;
  };
  created_at: string;            // ISO 8601 时间
  updated_at: string;
  system: boolean;               // 是否系统评论
  noteable_id: number;
  noteable_type: string;
  noteable_iid: number;
}
```

### Jenkins 相关类型

```typescript
/** Jenkins 构建信息 */
interface JenkinsBuildInfo {
  buildNumber: number;           // 构建编号
  buildUrl: string;              // 构建页面 URL
  consoleLogUrl: string;         // Console Log URL
  blueOceanUrl: string;          // Blue Ocean UI URL
  status: 'SUCCESS' | 'FAILURE' | 'RUNNING' | 'UNKNOWN';
  triggeredBy: string;           // 触发者
  mrUrl: string;                 // 关联的 MR URL
  mrTitle: string;
  sourceBranch: string;          // 源分支
  targetBranch: string;          // 目标分支
}

/** 构建阶段状态 */
interface StageStatus {
  name: string;                  // 阶段名称
  status: 'SUCCESS' | 'FAILURE' | 'SKIPPED' | 'RUNNING';
  testReportUrl?: string;        // 测试报告 URL
  coverageReportUrl?: string;    // 覆盖率报告 URL
  description?: string;
}
```

### 测试和覆盖率类型

```typescript
/** 失败的测试用例 */
interface FailedTestCase {
  testFile: string;              // 测试文件路径
  testSuite: string;             // 测试套件名称
  testName: string;              // 测试用例名称
  errorType?: string;            // 错误类型 (TypeError, ReferenceError...)
  errorMessage?: string;         // 错误消息
  expectedValue?: string;        // 期望值
  receivedValue?: string;        // 实际值
}

/** 覆盖率统计 */
interface CoverageStats {
  type: 'overall' | 'phone' | 'message' | 'app' | 'ai';
  diffLines: number;             // 变更行数
  coveredDiffLines: number;      // 已覆盖的变更行数
  uncoveredDiffLines: number;    // 未覆盖的变更行数
  diffCoverage: number;          // Diff Coverage 百分比
  overallCoverage: number;       // 整体覆盖率
  lineCoverage?: number;         // 行覆盖率
  branchCoverage?: number;       // 分支覆盖率
  statementCoverage?: number;    // 语句覆盖率
  functionCoverage?: number;     // 函数覆盖率
}

/** 未覆盖的文件 */
interface UncoveredFile {
  filePath: string;              // 文件路径
  coverage: number;              // 覆盖率百分比
  uncoveredLines: number;        // 未覆盖行数
  lineNumbers?: string;          // 具体行号 (如 "10-15, 20")
}
```

### 诊断结果类型

```typescript
/** 诊断摘要 */
interface DiagnosisSummary {
  totalStages: number;           // 总阶段数
  passedStages: number;          // 通过阶段数
  failedStages: number;          // 失败阶段数
  skippedStages: number;         // 跳过阶段数
  totalFailedTests: number;      // 失败测试用例数
  currentDiffCoverage: number;   // 当前 Diff Coverage
}

/** MR 诊断结果 */
interface MRDiagnosisResult {
  mrUrl: string;
  mrIid: number;
  projectId: string;
  buildInfo: JenkinsBuildInfo | null;
  stages: StageStatus[];
  failedTests: FailedTestCase[];
  coverageStats: CoverageStats[];
  uncoveredFiles: UncoveredFile[];
  isDiffCoveragePassed: boolean;
  diffCoverageGate: number;
  summary: DiagnosisSummary;
  recommendations: string[];
}
```

---

## 配置系统

### 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `GITLAB_TOKEN` | ✅ 是 | - | GitLab Private Token，用于 API 认证 |
| `GITLAB_BASE_URL` | 否 | `https://git.ringcentral.com` | GitLab 服务器地址 |
| `JENKINS_BASE_URL` | 否 | - | Jenkins 服务器地址 |
| `DIFF_COVERAGE_GATE` | 否 | `90` | Diff Coverage 阈值 (0-100) |

### 常量配置

```typescript
// src/constants.ts

/** 默认 Diff Coverage 阈值 */
export const DEFAULT_DIFF_COVERAGE_GATE = 90;

/** 默认每页评论数 */
export const DEFAULT_COMMENTS_PER_PAGE = 50;

/** 测试失败详情搜索范围 (字符数) */
export const FAILED_TEST_SEARCH_RANGE = 50000;

/** 错误信息最大长度 */
export const MAX_ERROR_MESSAGE_LENGTH = 200;

/** 测试名称最大长度 */
export const MAX_TEST_NAME_LENGTH = 100;

/** 错误详情上下文范围 */
export const ERROR_CONTEXT_RANGE = 3000;

/** 测试上下文范围 */
export const TEST_CONTEXT_RANGE = 500;

/** Build-only 最大阶段数 */
export const BUILD_ONLY_MAX_STAGES = 5;

/** 基础构建阶段 (用于识别 build-only) */
export const BASIC_BUILD_STAGES = [
  'checkout',
  'install',
  'build+deploy:rc',
  'build',
  'deploy'
];
```

### 配置加载

```typescript
// src/utils/config.ts

interface DiagnosisConfig {
  gitlabBaseUrl: string;
  gitlabToken: string;
  diffCoverageGate: number;
}

function loadDiagnosisConfig(overrides?: Partial<DiagnosisConfig>): DiagnosisConfig {
  return {
    gitlabBaseUrl: overrides?.gitlabBaseUrl ||
                   process.env.GITLAB_BASE_URL ||
                   DEFAULT_GITLAB_BASE_URL,
    gitlabToken: overrides?.gitlabToken ||
                 process.env.GITLAB_TOKEN ||
                 '',
    diffCoverageGate: overrides?.diffCoverageGate ||
                      parseInt(process.env.DIFF_COVERAGE_GATE || '', 10) ||
                      DEFAULT_DIFF_COVERAGE_GATE,
  };
}

function validateConfig(config: DiagnosisConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.gitlabToken) {
    errors.push('GITLAB_TOKEN 环境变量未设置');
  }

  if (config.diffCoverageGate < 0 || config.diffCoverageGate > 100) {
    errors.push('DIFF_COVERAGE_GATE 必须在 0-100 之间');
  }

  return { valid: errors.length === 0, errors };
}
```

---

## 错误处理策略

### 错误分类

| 类型 | 场景 | 处理方式 |
|------|------|---------|
| **致命错误** | MR URL 格式无效 | 抛出 Error，中断处理 |
| **致命错误** | GitLab Token 未配置 | 抛出 Error，提示设置环境变量 |
| **可恢复错误** | GitLab API 调用失败 | 抛出 Error，返回错误信息 |
| **可恢复错误** | 无构建记录 | 返回空结果，提供触发构建建议 |
| **可恢复错误** | 只有 build-only 构建 | 返回部分结果，提示需要完整构建 |
| **非致命错误** | Console Log 获取失败 | 记录警告，继续处理其他信息 |
| **非致命错误** | 覆盖率报告解析失败 | 跳过覆盖率信息，返回其他结果 |

### 错误处理代码示例

```typescript
async diagnose(mrUrl: string): Promise<MRDiagnosisResult> {
  // 1. URL 解析 - 致命错误
  const parsed = this.gitlabService.parseMRUrl(mrUrl);
  if (!parsed) {
    throw new Error(`Invalid MR URL: ${mrUrl}`);
  }

  // 2. 获取评论 - 可能抛出网络错误
  const comments = await this.gitlabService.getMRComments(
    parsed.projectId,
    parsed.mrIid
  );

  // 3. 查找完整构建 - 可恢复
  const latestFullBuild = this.commentParser.findLatestFullBuildComment(comments);
  if (!latestFullBuild) {
    // 检查是否有任何构建
    const latestAnyBuild = this.commentParser.findLatestBuildComment(comments);
    if (latestAnyBuild) {
      // 有构建但不是完整构建
      result.recommendations.push(
        '⚠️ 当前构建缺少 UT 和覆盖率检查',
        '💡 建议: 在 MR 中评论 "build" 触发完整构建'
      );
      return result;
    }
    // 无任何构建
    result.recommendations.push('未找到构建记录，请触发构建');
    return result;
  }

  // 4. 获取 Console Log - 非致命错误
  let consoleLog = '';
  try {
    consoleLog = await this.jenkinsService.getConsoleLog(
      latestFullBuild.buildInfo!.consoleLogUrl
    );
  } catch (error) {
    result.recommendations.push(`⚠️ 无法获取 Console Log: ${error}`);
    // 继续处理，不中断
  }

  // 5. 获取未覆盖文件 - 非致命错误
  if (!result.isDiffCoveragePassed) {
    try {
      result.uncoveredFiles = await this.jenkinsService.getUncoveredFiles(
        buildUrl,
        this.config.diffCoverageGate
      );
    } catch (error) {
      // 静默失败，不影响主要结果
      console.error('Failed to get uncovered files:', error);
    }
  }

  return result;
}
```

---

## 扩展与自定义

### 添加新的评论类型

```typescript
// 1. 在 CommentParser 中添加识别逻辑
getCommentType(comment: GitLabComment): CommentType {
  // ... 现有逻辑

  // 添加新类型
  if (body.includes('SonarQube') && body.includes('Quality Gate')) {
    return 'sonarqube_result';
  }

  return 'other';
}

// 2. 更新 CommentType 类型定义
type CommentType =
  | 'jenkins_build'
  | 'e2e_result'
  | 'deploy_ready'
  | 'user_command'
  | 'system'
  | 'sonarqube_result'  // 新增
  | 'other';
```

### 添加新的解析器

```typescript
// 例如: 添加 SonarQube 报告解析器
export class SonarQubeParser {
  parseQualityGate(body: string): QualityGateResult | null {
    const match = body.match(/Quality Gate: (Passed|Failed)/);
    if (!match) return null;

    return {
      status: match[1] as 'Passed' | 'Failed',
      // ... 解析其他信息
    };
  }
}
```

### 自定义报告格式

```typescript
// 继承 MRDiagnosisTool 并覆盖 formatResult
class CustomDiagnosisTool extends MRDiagnosisTool {
  formatResult(result: MRDiagnosisResult): string {
    // 自定义格式化逻辑
    return JSON.stringify(result, null, 2);  // 例如: 返回 JSON
  }
}
```

### 添加新的 MCP 工具

```typescript
// 在 index.ts 中注册新工具
server.tool(
  'analyze_test_history',
  {
    description: '分析测试失败历史',
    inputSchema: {
      type: 'object',
      properties: {
        test_file: { type: 'string' },
        days: { type: 'number', default: 7 }
      },
      required: ['test_file']
    }
  },
  async ({ test_file, days }) => {
    // 实现逻辑
    return { content: [{ type: 'text', text: result }] };
  }
);
```

---

## 性能考虑

### 日志解析优化

- **搜索范围限制**: `FAILED_TEST_SEARCH_RANGE = 50000` 字符，避免在超大日志中全文搜索
- **去重机制**: 使用 `Set` 避免重复处理同一测试文件
- **提前终止**: 找到完整构建后立即停止遍历评论

### 网络请求优化

- **按需获取**: 只有覆盖率未达标时才获取详细的未覆盖文件列表
- **分页获取**: 评论列表支持分页，默认每页 50 条

### 内存优化

- **流式处理**: 大型 Console Log 不会一次性加载到内存
- **字符串截断**: 错误消息限制在 200 字符以内

---

## 调试技巧

### 启用详细日志

```bash
# 设置环境变量
export DEBUG=mcp:*

# 运行服务
npx gitlab-mr-diagnosis-mcp@latest
```

### 测试单个工具

```bash
# 使用 MCP Inspector
npx @modelcontextprotocol/inspector gitlab-mr-diagnosis-mcp
```

### 常见问题排查

| 问题 | 可能原因 | 解决方案 |
|------|---------|---------|
| "Invalid MR URL" | URL 格式不正确 | 检查是否包含 `/merge_requests/` |
| "GITLAB_TOKEN not set" | 环境变量未配置 | 设置 `GITLAB_TOKEN` 环境变量 |
| 找不到构建记录 | MR 未触发构建 | 在 MR 中评论 "build" |
| 覆盖率为 0 | Console Log 解析失败 | 检查正则是否匹配日志格式 |
| npx 找不到命令 | 缺少 shebang | 确保 dist/index.js 有 `#!/usr/bin/env node` |

