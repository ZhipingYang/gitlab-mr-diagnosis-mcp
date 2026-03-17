#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { MRDiagnosisTool } from './tools/diagnose';
import { DiagnosisConfig } from './types';
import { loadDiagnosisConfig } from './utils/config';

// 默认配置
const DEFAULT_CONFIG = loadDiagnosisConfig();

// 创建 MCP Server
const server = new Server(
  {
    name: 'mcp-mr-diagnosis',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 注册工具列表
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'diagnose_mr',
        description: `诊断 GitLab Merge Request 的 Pipeline 构建状态。

功能：
1. 获取 MR 的 comments 信息
2. 解析 Jenkins 构建状态和阶段信息
3. 获取并分析 Console Log
4. 提取 UT 失败用例、覆盖率统计等信息
5. 生成诊断报告和修复建议

返回信息包括：
- 构建状态（成功/失败）
- 各阶段执行状态
- 失败的测试用例列表
- Diff Coverage 是否达标
- 具体覆盖率数值
- 修复建议`,
        inputSchema: {
          type: 'object',
          properties: {
            mr_url: {
              type: 'string',
              description: 'GitLab MR URL，例如: https://git.ringcentral.com/Fiji/Fiji/-/merge_requests/41613',
            },
            gitlab_token: {
              type: 'string',
              description: 'GitLab Private Token（可选，如果未设置环境变量则必填）',
            },
            diff_coverage_gate: {
              type: 'number',
              description: 'Diff Coverage 阈值（默认 90）',
            },
          },
          required: ['mr_url'],
        },
      },
      {
        name: 'get_mr_comments',
        description: '获取 GitLab MR 的所有 comments（原始数据）',
        inputSchema: {
          type: 'object',
          properties: {
            mr_url: {
              type: 'string',
              description: 'GitLab MR URL',
            },
            gitlab_token: {
              type: 'string',
              description: 'GitLab Private Token',
            },
            per_page: {
              type: 'number',
              description: '每页数量（默认 50）',
            },
          },
          required: ['mr_url'],
        },
      },
      {
        name: 'get_console_log',
        description: '获取 Jenkins 构建的 Console Log',
        inputSchema: {
          type: 'object',
          properties: {
            build_url: {
              type: 'string',
              description: 'Jenkins 构建 URL 或 Console Log URL',
            },
            search_pattern: {
              type: 'string',
              description: '在日志中搜索的正则表达式模式（可选）',
            },
          },
          required: ['build_url'],
        },
      },
      {
        name: 'get_coverage_report',
        description: `获取 Jenkins 构建的 Coverage Report 数据(从 HTML artifact 解析)。

功能:
1. 从 artifact/coverage/Overall-Diff-Coverage-Report.html 获取数据
2. 解析 Diff Coverage 和 Overall Coverage 统计
3. 提取未达标的文件列表
4. 可选返回原始 HTML 用于调试

返回信息包括:
- Diff Coverage 和 Overall Coverage 百分比
- 未达标文件列表(文件路径 + 覆盖率)
- Coverage 是否达标
- Coverage Report 的 artifact URL`,
        inputSchema: {
          type: 'object',
          properties: {
            build_url: {
              type: 'string',
              description: 'Jenkins 构建 URL (例如: https://jenkins.../job/xxx/12345/)',
            },
            coverage_threshold: {
              type: 'number',
              description: 'Coverage 阈值 (默认 90)',
            },
            include_html: {
              type: 'boolean',
              description: '是否返回原始 HTML (用于调试,默认 false)',
            },
          },
          required: ['build_url'],
        },
      },
    ],
  };
});

// 处理工具调用
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'diagnose_mr': {
        const mrUrl = args?.mr_url as string;
        const token = (args?.gitlab_token as string) || DEFAULT_CONFIG.gitlabToken;
        const gate = (args?.diff_coverage_gate as number) || DEFAULT_CONFIG.diffCoverageGate;

        if (!token) {
          return {
            content: [
              {
                type: 'text',
                text: '错误: 需要提供 gitlab_token 参数或设置 GITLAB_TOKEN 环境变量',
              },
            ],
          };
        }

        const config: DiagnosisConfig = {
          ...DEFAULT_CONFIG,
          gitlabToken: token,
          diffCoverageGate: gate,
        };

        const tool = new MRDiagnosisTool(config);
        const result = await tool.diagnose(mrUrl);
        const formattedResult = tool.formatResult(result);

        return {
          content: [
            {
              type: 'text',
              text: formattedResult,
            },
            {
              type: 'text',
              text: '\n\n---\n📦 原始诊断数据 (JSON):\n' + JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_mr_comments': {
        const mrUrl = args?.mr_url as string;
        const token = (args?.gitlab_token as string) || DEFAULT_CONFIG.gitlabToken;

        if (!token) {
          return {
            content: [{ type: 'text', text: '错误: 需要提供 gitlab_token' }],
          };
        }

        const { GitLabService } = await import('./services/gitlab');
        const gitlab = new GitLabService(DEFAULT_CONFIG.gitlabBaseUrl, token);
        const parsed = gitlab.parseMRUrl(mrUrl);
        if (!parsed) {
          return {
            content: [{ type: 'text', text: `无效的 MR URL: ${mrUrl}` }],
          };
        }
        const comments = await gitlab.getMRComments(parsed.projectId, parsed.mrIid);

        return {
          content: [
            {
              type: 'text',
              text: `获取到 ${comments.length} 条评论:\n\n` +
                comments.map((c, i) =>
                  `${i + 1}. [${c.author.name}] ${c.created_at}\n   ${c.body.substring(0, 200)}...`
                ).join('\n\n'),
            },
          ],
        };
      }

      case 'get_console_log': {
        const buildUrl = args?.build_url as string;
        const searchPattern = args?.search_pattern as string | undefined;

        const { JenkinsService } = await import('./services/jenkins');
        const { ConsoleLogParser } = await import('./services/consoleLogParser');

        const jenkins = new JenkinsService();
        const consoleLogUrl = jenkins.buildConsoleLogUrl(buildUrl);
        const log = await jenkins.getConsoleLog(consoleLogUrl);

        let result = `Console Log 获取成功 (${log.length} 字符)\n`;
        result += `URL: ${consoleLogUrl}\n\n`;

        if (searchPattern) {
          const regex = new RegExp(searchPattern, 'gi');
          const matches = log.match(regex);
          if (matches) {
            result += `找到 ${matches.length} 个匹配:\n`;
            matches.slice(0, 20).forEach((m, i) => {
              result += `${i + 1}. ${m}\n`;
            });
          } else {
            result += '未找到匹配内容';
          }
        } else {
          // 解析关键信息
          const parser = new ConsoleLogParser();
          const analysis = parser.parseAll(log);

          result += '📊 解析结果:\n';
          result += `失败测试: ${analysis.failedTests.length} 个\n`;
          analysis.failedTests.forEach(t => {
            result += `  - ${t.testFile}\n`;
          });

          if (analysis.testSummary) {
            result += '\n测试摘要:\n';
            result += `  通过: ${analysis.testSummary.passed}\n`;
            result += `  失败: ${analysis.testSummary.failed}\n`;
            result += `  跳过: ${analysis.testSummary.skipped}\n`;
          }

          result += '\n⚠️ 注意: Coverage 数据现在从 HTML Report 获取，请使用 get_coverage_report 工具\n';
        }

        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'get_coverage_report': {
        const buildUrl = args?.build_url as string;
        const coverageThreshold = (args?.coverage_threshold as number) || DEFAULT_CONFIG.diffCoverageGate;
        const includeHtml = (args?.include_html as boolean) || false;

        const { JenkinsService } = await import('./services/jenkins');
        const jenkins = new JenkinsService();

        try {
          const cleanUrl = buildUrl
            .replace('/display/redirect', '')
            .replace('/console', '')
            .replace('/consoleText', '')
            .replace(/\/$/, '');
          const artifactUrl = `${cleanUrl}/artifact/coverage/Overall-Diff-Coverage-Report.html`;

          const coverageData = await jenkins.getCoverageData(buildUrl, coverageThreshold);

          let result = '📊 Coverage Report 数据\n';
          result += '═══════════════════════════════════════════════════════════════\n\n';
          result += `🔗 Artifact URL: ${artifactUrl}\n`;
          result += `📏 Coverage 阈值: ${coverageThreshold}%\n\n`;

          // 统计数据
          if (coverageData.stats) {
            result += '📈 Coverage 统计:\n';
            result += `  Diff Coverage:    ${coverageData.stats.diffCoverage.toFixed(2)}% ${coverageData.isDiffCoveragePassed ? '✅' : '❌'}\n`;
            result += `  Overall Coverage: ${coverageData.stats.overallCoverage.toFixed(2)}%\n\n`;
          } else {
            result += '⚠️ 无法从 HTML 中提取统计数据\n\n';
          }

          // 未达标文件
          if (coverageData.uncoveredFiles.length > 0) {
            result += `📁 Diff Coverage 未达标文件 (${coverageData.uncoveredFiles.length} 个):\n`;
            coverageData.uncoveredFiles.forEach((file, i) => {
              result += `  ${i + 1}. ${file.filePath}\n`;
              result += `     Diff Coverage: ${file.coverage.toFixed(2)}%\n`;
            });
          } else {
            result += '✅ 所有文件的 Diff Coverage 都达标!\n';
          }

          result += '\n═══════════════════════════════════════════════════════════════\n';

          const content: any[] = [{ type: 'text', text: result }];

          // 添加 JSON 数据
          content.push({
            type: 'text',
            text: '\n\n---\n📦 原始数据 (JSON):\n' + JSON.stringify({
              artifactUrl,
              coverageThreshold,
              stats: coverageData.stats,
              uncoveredFiles: coverageData.uncoveredFiles,
              isDiffCoveragePassed: coverageData.isDiffCoveragePassed,
            }, null, 2),
          });

          // 如果需要，添加原始 HTML
          if (includeHtml) {
            try {
              const html = await jenkins.getCoverageReportHtml(buildUrl);
              content.push({
                type: 'text',
                text: `\n\n---\n📄 原始 HTML (前 2000 字符):\n${html.substring(0, 2000)}...`,
              });
            } catch (error) {
              content.push({
                type: 'text',
                text: `\n\n---\n⚠️ 无法获取原始 HTML: ${error instanceof Error ? error.message : String(error)}`,
              });
            }
          }

          return { content };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          return {
            content: [{
              type: 'text',
              text: `❌ 获取 Coverage Report 失败:\n${errorMsg}\n\n💡 请检查:\n1. 构建 URL 是否正确\n2. Coverage artifact 是否存在\n3. 网络连接是否正常`,
            }],
          };
        }
      }

      default:
        return {
          content: [{ type: 'text', text: `未知工具: ${name}` }],
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `错误: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
});

// 启动服务
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP MR Diagnosis Server started');
}

main().catch(console.error);

