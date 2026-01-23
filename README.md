# MCP MR Diagnosis

GitLab Merge Request Pipeline 构建状态诊断 MCP 服务。

## 功能

1. **获取 MR Comments** - 从 GitLab API 获取 MR 的评论信息
2. **解析 Jenkins 构建状态** - 解析 Jenkins bot 发布的构建结果评论
3. **获取 Console Log** - 获取 Jenkins 构建的完整日志
4. **解析诊断信息**：
   - UT 失败用例
   - Diff Coverage 达标状态
   - 具体覆盖率数值
   - 各阶段状态（通过/失败/跳过）
5. **生成修复建议** - 提供具体的修复步骤

## 安装

```bash
cd mcp-mr-diagnosis
npm install
npm run build
```

## 配置

### 环境变量

```bash
export GITLAB_TOKEN="your_gitlab_private_token"
export GITLAB_BASE_URL="https://git.ringcentral.com"  # 可选
export DIFF_COVERAGE_GATE="90"  # 可选，默认 90
```

### MCP 配置

在 MCP 配置文件中添加：

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

### 作为 MCP 服务

服务提供以下工具：

#### 1. `diagnose_mr` - 完整诊断

```json
{
  "name": "diagnose_mr",
  "arguments": {
    "mr_url": "https://git.ringcentral.com/Fiji/Fiji/-/merge_requests/41613",
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
    "mr_url": "https://git.ringcentral.com/Fiji/Fiji/-/merge_requests/41613",
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
    "build_url": "https://jenkins-commonci.int.rclabenv.com/job/CommonCI-Jupiter-Web-MR-Auto-Generate/44396/",
    "search_pattern": "FAIL project/phone"
  }
}
```

### 命令行测试

```bash
# 编译
npm run build

# 测试指定 MR
npm test https://git.ringcentral.com/Fiji/Fiji/-/merge_requests/41613
```

## 输出示例

```
═══════════════════════════════════════════════════════════════
📊 GitLab MR Pipeline 构建状态诊断报告
═══════════════════════════════════════════════════════════════

🔗 MR URL: https://git.ringcentral.com/Fiji/Fiji/-/merge_requests/41613
📦 Project: Fiji/Fiji
🔢 MR IID: 41613

🏗️  构建状态: 🔴 FAILURE
📌 构建号: #44396
👤 触发者: Daniel Yang
🌿 分支: feature/FIJI-100536-SDD → develop

📋 阶段状态:
┌──────────────────────┬──────────┐
│ 阶段                 │ 状态     │
├──────────────────────┼──────────┤
│ checkout             │ ✅ 通过   │
│ tsc                  │ ✅ 通过   │
│ phone ut             │ ❌ 失败   │
│ diffcoverage         │ ✅ 通过   │
└──────────────────────┴──────────┘

❌ 失败的测试用例:
  1. project/phone/core/common/src/config/__tests__/registerSubAppPhoneFeatureConfigStore.test.ts
     └─ registerSubAppPhoneFeatureConfigStore › should export registerConfig object

📈 覆盖率统计:
  Diff Coverage: 91.79% ✅ (阈值: 90%)
  Diff Lines: 1237 | Covered: 637 | Uncovered: 57

💡 建议:
  发现 1 个测试用例失败，需要修复：
    1. project/phone/core/common/src/config/__tests__/registerSubAppPhoneFeatureConfigStore.test.ts
  建议: 运行 yarn test:no-watch <test-file> 本地调试
```

## 项目结构

```
mcp-mr-diagnosis/
├── src/
│   ├── index.ts              # MCP 服务入口
│   ├── types.ts              # 类型定义 (JSDoc 增强)
│   ├── constants.ts          # 常量配置 (正则、默认值)
│   ├── test.ts               # 单个 MR 测试脚本
│   ├── batch-test.ts         # 批量 MR 测试脚本
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
├── README.md
└── Tech.md                   # 技术文档
```

## 批量测试

```bash
# 测试 MR #41711 到 #41700 (共 12 个)
node dist/batch-test.js 41711 41700

# 测试 MR #41711 到 #41650 (共 62 个)
node dist/batch-test.js 41711 41650
```

批量测试会输出：
- 每个 MR 的状态（通过/失败/build-only/无构建）
- UT 失败文件汇总（按出现次数排序）
- Coverage 未达标的 MR 列表

## 技术文档

详细的技术实现和架构说明请参考 [Tech.md](./Tech.md)。

## License

MIT

