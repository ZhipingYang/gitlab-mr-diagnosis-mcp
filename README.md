# GitLab MR Diagnosis MCP

[![npm version](https://img.shields.io/npm/v/gitlab-mr-diagnosis-mcp.svg)](https://www.npmjs.com/package/gitlab-mr-diagnosis-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

GitLab Merge Request Pipeline 构建状态诊断 MCP (Model Context Protocol) 服务，专为 AI Agent 设计。

## ✨ 功能特性

- 🔍 **智能诊断** - 自动分析 MR 构建失败原因
- 🧪 **测试分析** - 提取失败的单元测试用例及错误详情
- 📊 **覆盖率检查** - 检测 Diff Coverage 是否达标
- 📋 **阶段状态** - 展示 CI Pipeline 各阶段执行状态
- 💡 **修复建议** - 提供具体可操作的修复步骤

## 🚀 快速开始

### MCP 配置 (推荐)

在 Claude Desktop 或其他 MCP 客户端的配置文件中添加：

```json
{
  "mcpServers": {
    "gitlab-mr-diagnosis-mcp": {
      "command": "npx",
      "args": ["-y", "gitlab-mr-diagnosis-mcp@latest"],
      "env": {
        "GITLAB_TOKEN": "your_gitlab_private_token"
      }
    }
  }
}
```

### 源码安装

```bash
git clone https://github.com/ZhipingYang/gitlab-mr-diagnosis-mcp.git
cd gitlab-mr-diagnosis-mcp
npm install
npm run build
```

然后配置：

```json
{
  "mcpServers": {
    "gitlab-mr-diagnosis-mcp": {
      "command": "node",
      "args": ["/path/to/gitlab-mr-diagnosis-mcp/dist/index.js"],
      "env": {
        "GITLAB_TOKEN": "your_gitlab_private_token"
      }
    }
  }
}
```

## ⚙️ 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `GITLAB_TOKEN` | ✅ 是 | - | GitLab Private Token |
| `GITLAB_BASE_URL` | 否 | `https://git.ringcentral.com` | GitLab 服务器地址 |
| `DIFF_COVERAGE_GATE` | 否 | `90` | Diff Coverage 阈值 (%) |

## 🛠️ MCP 工具

服务提供以下 4 个工具：

### 1. `diagnose_mr` - 完整诊断 ⭐

自动诊断 MR 构建状态，返回详细的诊断报告。

```json
{
  "name": "diagnose_mr",
  "arguments": {
    "mr_url": "https://gitlab.example.com/group/project/-/merge_requests/123",
    "diff_coverage_gate": 90
  }
}
```

**返回内容**：
- 构建状态和构建号
- 各阶段执行状态 (checkout, tsc, ut, diffcoverage 等)
- 失败的测试用例列表（含错误类型和错误消息）
- Diff Coverage 统计（从 HTML artifact 解析）
- 未达标文件列表
- 修复建议（包含 Coverage 解析错误提示）

**新增功能** (v1.0.4):
- ✅ Coverage 解析失败时提供详细错误信息
- ✅ 提供 Coverage Report 的直接链接
- ✅ 区分 "解析失败" 和 "Coverage 为 0%"

### 2. `get_coverage_report` - 获取 Coverage 数据 🆕

获取 Jenkins 构建的 Coverage Report 数据（从 HTML artifact 解析）。

```json
{
  "name": "get_coverage_report",
  "arguments": {
    "build_url": "https://jenkins.example.com/job/your-job/123/",
    "coverage_threshold": 90,
    "include_html": false
  }
}
```

**返回内容**：
- Diff Coverage 和 Overall Coverage 百分比
- 未达标文件列表（文件路径 + 覆盖率）
- Coverage 是否达标
- Coverage Report 的 artifact URL
- 可选：原始 HTML（用于调试）

**使用场景**：
- 单独查看 Coverage 数据
- 调试 Coverage 解析问题
- 获取详细的文件级别 Coverage 信息

### 3. `get_mr_comments` - 获取评论

获取 MR 的所有评论（原始 JSON 数据）。

```json
{
  "name": "get_mr_comments",
  "arguments": {
    "mr_url": "https://gitlab.example.com/group/project/-/merge_requests/123",
    "per_page": 50
  }
}
```

### 4. `get_console_log` - 获取 Jenkins 日志

获取 Jenkins 构建的 Console Log，支持正则搜索。

```json
{
  "name": "get_console_log",
  "arguments": {
    "build_url": "https://jenkins.example.com/job/your-job/123/",
    "search_pattern": "FAIL project/"
  }
}
```

## 📋 输出示例

```
═══════════════════════════════════════════════════════════════
📊 GitLab MR Pipeline 构建状态诊断报告
═══════════════════════════════════════════════════════════════

🔗 MR URL: https://gitlab.example.com/group/project/-/merge_requests/123
📦 Project: group/project
🔢 MR IID: 123

🏗️  构建状态: 🔴 FAILURE
📌 构建号: #456
👤 触发者: Developer
🌿 分支: feature/branch → develop

📋 阶段状态:
┌──────────────────────┬──────────┐
│ 阶段                 │ 状态     │
├──────────────────────┼──────────┤
│ checkout             │ ✅ 通过   │
│ tsc                  │ ✅ 通过   │
│ phone ut             │ ❌ 失败   │
│ diffcoverage         │ ✅ 通过   │
└──────────────────────┴──────────┘

❌ 失败的测试 (1 个文件, 2 个用例):
  1. project/phone/core/src/__tests__/example.test.ts
     └─ Example › should work correctly
        💥 TypeError: Cannot read property 'foo' of undefined
     └─ Example › should handle edge case

📈 覆盖率统计:
  Diff Coverage: 85.5% ❌ (阈值: 90%)
  Diff Lines: 200 | Covered: 171 | Uncovered: 29

📁 Diff Coverage 未达标文件:
  1. project/phone/core/src/service/UserService.ts
     Diff Coverage:  75.0%
  2. project/phone/ui/src/components/Button.tsx
     Diff Coverage:  80.0%

� 摘要:
  阶段: 3/4 通过
  失败测试: 2 个
  Diff Coverage: 85.5%

�💡 建议:
  发现 2 个测试用例失败，需要修复：
    1. project/phone/core/src/__tests__/example.test.ts
       测试: Example › should work correctly
  建议: 运行 yarn test:no-watch <test-file> 本地调试
  Diff Coverage 未达标: 85.5% < 90%
  建议: 为新增代码添加单元测试以提高覆盖率

═══════════════════════════════════════════════════════════════
```

## 📁 项目结构

```
gitlab-mr-diagnosis-mcp/
├── src/
│   ├── index.ts                    # MCP 服务入口
│   ├── types.ts                    # TypeScript 类型定义
│   ├── constants.ts                # 常量和正则表达式
│   ├── services/
│   │   ├── gitlab.ts               # GitLab API 服务
│   │   ├── jenkins.ts              # Jenkins 服务
│   │   ├── commentParser.ts        # MR 评论解析器
│   │   └── consoleLogParser.ts     # Console Log 解析器
│   ├── tools/
│   │   └── diagnose.ts             # 诊断工具主逻辑
│   └── utils/
│       └── config.ts               # 配置加载器
├── dist/                           # 编译输出
├── package.json
├── tsconfig.json
├── README.md
└── Tech.md                         # 技术文档
```

## 📚 技术文档

详细的技术实现、架构说明和 API 参考请查看 [Tech.md](./Tech.md)。

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 License

MIT

