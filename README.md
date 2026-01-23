# MCP MR Diagnosis

GitLab Merge Request Pipeline 构建状态诊断 MCP 服务，专为 AI Agent 设计。

## 功能

- **获取 MR Comments** - 从 GitLab API 获取 MR 的评论信息
- **解析 Jenkins 构建状态** - 解析 Jenkins bot 发布的构建结果评论
- **获取 Console Log** - 获取 Jenkins 构建的完整日志
- **解析诊断信息**：
  - UT 失败用例
  - Diff Coverage 达标状态
  - 具体覆盖率数值
  - 各阶段状态（通过/失败/跳过）
- **生成修复建议** - 提供具体的修复步骤

## 安装

```bash
npm install mcp-mr-diagnosis
```

或者从源码安装：

```bash
git clone https://github.com/ZhipingYang/gitlab-mr-diagnosis-mcp.git
cd mcp-mr-diagnosis
npm install
npm run build
```

## 配置

### 环境变量

```bash
export GITLAB_TOKEN="your_gitlab_private_token"
export GITLAB_BASE_URL="https://gitlab.example.com"  # 可选
export JENKINS_BASE_URL="https://jenkins.example.com"  # 可选
export DIFF_COVERAGE_GATE="90"  # 可选，默认 90
```

### MCP 配置

在 MCP 配置文件中添加：

```json
{
  "mcpServers": {
    "mcp-mr-diagnosis": {
      "command": "npx",
      "args": ["mcp-mr-diagnosis"],
      "env": {
        "GITLAB_TOKEN": "your_token_here",
        "GITLAB_BASE_URL": "https://gitlab.example.com"
      }
    }
  }
}
```

或者使用本地安装：

```json
{
  "mcpServers": {
    "mcp-mr-diagnosis": {
      "command": "node",
      "args": ["/path/to/mcp-mr-diagnosis/dist/index.js"],
      "env": {
        "GITLAB_TOKEN": "your_token_here"
      }
    }
  }
}
```

## 使用

### MCP 工具

服务提供以下工具：

#### 1. `diagnose_mr` - 完整诊断

```json
{
  "name": "diagnose_mr",
  "arguments": {
    "mr_url": "https://gitlab.example.com/group/project/-/merge_requests/123",
    "gitlab_token": "optional_if_env_set",
    "diff_coverage_gate": 90
  }
}
```

#### 2. `get_mr_comments` - 获取评论

```json
{
  "name": "get_mr_comments",
  "arguments": {
    "mr_url": "https://gitlab.example.com/group/project/-/merge_requests/123",
    "gitlab_token": "your_token",
    "per_page": 50
  }
}
```

#### 3. `get_console_log` - 获取 Jenkins 日志

```json
{
  "name": "get_console_log",
  "arguments": {
    "build_url": "https://jenkins.example.com/job/your-job/123/",
    "search_pattern": "FAIL project/"
  }
}
```

## 输出示例

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
│ unit test            │ ❌ 失败   │
│ diffcoverage         │ ✅ 通过   │
└──────────────────────┴──────────┘

❌ 失败的测试用例:
  1. project/module/src/__tests__/example.test.ts
     └─ Example › should work correctly

📈 覆盖率统计:
  Diff Coverage: 91.79% ✅ (阈值: 90%)
  Diff Lines: 1237 | Covered: 637 | Uncovered: 57

💡 建议:
  发现 1 个测试用例失败，需要修复
  建议: 本地运行测试调试
```

## 项目结构

```
mcp-mr-diagnosis/
├── src/
│   ├── index.ts              # MCP 服务入口
│   ├── types.ts              # 类型定义
│   ├── constants.ts          # 常量配置
│   ├── services/
│   │   ├── gitlab.ts         # GitLab API 服务
│   │   ├── jenkins.ts        # Jenkins 服务
│   │   ├── commentParser.ts  # Comment 解析器
│   │   └── consoleLogParser.ts # Console Log 解析器
│   ├── tools/
│   │   └── diagnose.ts       # 诊断工具
│   └── utils/
│       └── config.ts         # 配置加载器
├── package.json
├── tsconfig.json
└── README.md
```

## 技术文档

详细的技术实现和架构说明请参考 [Tech.md](./Tech.md)。

## License

MIT

