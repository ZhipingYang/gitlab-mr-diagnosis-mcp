# MCP MR Diagnosis - 技术文档

## 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                         MCP Server                               │
│                        (index.ts)                                │
├─────────────────────────────────────────────────────────────────┤
│                      MRDiagnosisTool                             │
│                     (tools/diagnose.ts)                          │
├──────────────┬──────────────┬──────────────┬────────────────────┤
│ GitLabService│ JenkinsService│ CommentParser│ ConsoleLogParser  │
│  (gitlab.ts) │ (jenkins.ts)  │(commentParser)│(consoleLogParser) │
└──────────────┴──────────────┴──────────────┴────────────────────┘
```

## 核心模块

### 1. GitLabService (`services/gitlab.ts`)

**职责**: 与 GitLab API 交互

- `parseMRUrl()`: 解析 MR URL 提取 projectId 和 mrIid
- `getMRComments()`: 获取 MR 的所有评论

### 2. JenkinsService (`services/jenkins.ts`)

**职责**: 获取 Jenkins 构建日志

- `getConsoleLog()`: 获取完整的 Console Log
- `searchInLog()`: 在日志中搜索指定模式

### 3. CommentParser (`services/commentParser.ts`)

**职责**: 解析 MR 评论内容

- `parseComment()`: 解析单条评论，识别类型
- `parseJenkinsBuildInfo()`: 提取 Jenkins 构建信息
- `parseStages()`: 解析构建阶段状态表格
- `isFullBuild()`: 判断是否为完整构建（包含 UT + Coverage）
- `isBuildOnly()`: 判断是否为仅基础构建
- `findLatestFullBuildComment()`: 查找最新的完整构建报告

### 4. ConsoleLogParser (`services/consoleLogParser.ts`)

**职责**: 解析 Jenkins Console Log

- `parseFailedTests()`: 提取失败的测试用例
- `parseCoverageStats()`: 提取覆盖率统计
- `parseTestSummary()`: 解析测试摘要

## 数据流

```
MR URL
   │
   ▼
┌──────────────────┐
│  GitLabService   │ ──► 获取 MR Comments
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  CommentParser   │ ──► 解析 Jenkins 构建信息
└────────┬─────────┘     识别完整构建 vs build-only
         │
         ▼
┌──────────────────┐
│  JenkinsService  │ ──► 获取 Console Log
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ConsoleLogParser  │ ──► 提取 UT 失败用例
└────────┬─────────┘     提取 Coverage 统计
         │
         ▼
   MRDiagnosisResult
```

## 环境变量配置

| 变量 | 必填 | 说明 |
|------|------|------|
| `GITLAB_TOKEN` | 是 | GitLab Private Token |
| `GITLAB_BASE_URL` | 否 | GitLab 服务器地址 |
| `JENKINS_BASE_URL` | 否 | Jenkins 服务器地址 |
| `DIFF_COVERAGE_GATE` | 否 | Diff Coverage 阈值 (默认 90) |

## 常量配置 (`constants.ts`)

集中管理所有常量，便于维护：

| 常量 | 默认值 | 说明 |
|------|--------|------|
| `DEFAULT_DIFF_COVERAGE_GATE` | 90 | Diff Coverage 阈值 |
| `FAILED_TEST_SEARCH_RANGE` | 50000 | 失败测试搜索范围 |
| `TEST_CONTEXT_RANGE` | 500 | 测试上下文范围 |
| `MAX_ERROR_MESSAGE_LENGTH` | 200 | 错误消息最大长度 |
| `BUILD_ONLY_MAX_STAGES` | 5 | build-only 最大阶段数 |

## 构建类型判断

### 完整构建 (Full Build)
- 包含 UT 阶段 (`phone ut`, `message ut`, `app ut` 等)
- 包含 `diffcoverage` 阶段

### 仅基础构建 (Build-only)
- 阶段数 ≤ 5
- 只包含基础阶段：`checkout`, `tsc`, `install`, `build`, `deploy`

## 正则表达式

关键的解析正则：

```typescript
// 失败测试文件
REGEX_FAIL_PATTERN = /FAIL(?:\s+UT)?\s+(project\/[^\s]+\.test\.[tj]sx?)/g

// 测试用例名称 (支持时间戳前缀)
REGEX_TEST_NAME = /(?:\[[\d\-T:.Z]+\]\s*)?●\s+([^\n]+)/g

// Diff Coverage 统计
REGEX_OVERALL_DIFF_COVERAGE = /Overall Diff Coverage Statistics.../i
```

## 配置加载 (`utils/config.ts`)

支持环境变量和参数覆盖：

```typescript
const config = loadDiagnosisConfig({
  gitlabToken: 'override_token',  // 可选覆盖
});

const validation = validateConfig(config);
if (!validation.valid) {
  console.error(validation.errors);
}
```

## 类型定义 (`types.ts`)

核心类型：

- `GitLabComment`: GitLab 评论
- `JenkinsBuildInfo`: Jenkins 构建信息
- `StageStatus`: 阶段状态
- `FailedTestCase`: 失败测试用例
- `CoverageStats`: 覆盖率统计
- `MRDiagnosisResult`: 诊断结果
- `DiagnosisSummary`: 诊断摘要
- `ParsedComment`: 解析后的评论
- `DiagnosisConfig`: 配置选项

## 错误处理

| 场景 | 处理 |
|------|------|
| MR URL 无效 | 抛出错误 |
| 无构建记录 | 返回空结果，提示触发构建 |
| 只有 build-only | 提示需要完整构建 |
| Console Log 获取失败 | 记录警告，继续处理 |
| Token 未配置 | 验证失败，提示设置环境变量 |

