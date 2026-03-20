#!/usr/bin/env node

/**
 * 独立的 GitLab MR 诊断脚本
 * 可以复制到任何地方运行,不依赖项目的其他文件
 * 
 * 使用方法:
 *   node standalone-diagnose.js <MR_URL> [--token <TOKEN>] [--gate <NUMBER>]
 * 
 * 示例:
 *   node standalone-diagnose.js https://git.ringcentral.com/Fiji/Fiji/-/merge_requests/42352 --token YOUR_TOKEN
 */

const https = require('https');
const http = require('http');

// ============================================================
// 常量定义
// ============================================================

const DEFAULT_GITLAB_BASE_URL = 'https://git.ringcentral.com';
const DEFAULT_DIFF_COVERAGE_GATE = 90;
const DEFAULT_COMMENTS_PER_PAGE = 50;

// 正则表达式
const REGEX_MR_URL_PATTERN_1 = /https?:\/\/[^\/]+\/([^\/]+\/[^\/]+)\/-\/merge_requests\/(\d+)/;
const REGEX_MR_URL_PATTERN_2 = /https?:\/\/[^\/]+\/([^\/]+\/[^\/]+)\/merge_requests\/(\d+)/;
const REGEX_JENKINS_BUILD_URL = /\[jenkins-CommonCI-Jupiter-Web-MR-Auto-Generate-(\d+)\]\((https:\/\/[^\)]+)\)/;
const REGEX_STAGE_TABLE_ROW = /\|\s*(\w+[\w\s+:]*)\s*\|\s*(✅|🚫|⏩|🔄)\s*\|([^|]*)\|([^|]*)\|/g;
const REGEX_FAIL_PATTERN = /FAIL(?:\s+(?:UT|NODE))?\s+(project\/[^\s]+\.test(?:\.[a-z]+)*\.[tj]sx?)/g;
const REGEX_TEST_NAME = /(?:\[[\d\-T:.Z]+\]\s*)?●\s+([^\n]+)/g;
const REGEX_ERROR_PATTERN = /(TypeError|ReferenceError|SyntaxError|Error):\s*([^\n]+)/;

const BASIC_BUILD_STAGES = ['checkout', 'install', 'build+deploy:rc', 'build', 'deploy'];
const BUILD_ONLY_MAX_STAGES = 5;
const FAILED_TEST_SEARCH_RANGE = 50000;
const TEST_CONTEXT_RANGE = 500;
const MAX_ERROR_MESSAGE_LENGTH = 200;

// ============================================================
// HTTP 请求工具
// ============================================================

/**
 * 发送 HTTP/HTTPS 请求
 */
function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const lib = isHttps ? https : http;

    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = lib.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, data });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        }
      });
    });

    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

// ============================================================
// GitLab API 服务
// ============================================================

/**
 * 解析 MR URL
 */
function parseMRUrl(mrUrl) {
  const patterns = [REGEX_MR_URL_PATTERN_1, REGEX_MR_URL_PATTERN_2];
  
  for (const pattern of patterns) {
    const match = mrUrl.match(pattern);
    if (match) {
      return {
        projectId: match[1],
        mrIid: parseInt(match[2], 10),
      };
    }
  }
  return null;
}

/**
 * 获取 MR Comments
 */
async function getMRComments(baseUrl, token, projectId, mrIid, perPage = DEFAULT_COMMENTS_PER_PAGE) {
  const encodedProjectId = encodeURIComponent(projectId);
  const url = `${baseUrl}/api/v4/projects/${encodedProjectId}/merge_requests/${mrIid}/notes?per_page=${perPage}&sort=desc`;
  
  const response = await httpRequest(url, {
    headers: {
      'PRIVATE-TOKEN': token,
      'Content-Type': 'application/json',
    },
  });
  
  return JSON.parse(response.data);
}

// ============================================================
// Jenkins API 服务
// ============================================================

/**
 * 获取 Console Log
 */
async function getConsoleLog(buildUrl) {
  const cleanUrl = buildUrl
    .replace('/display/redirect', '')
    .replace('/console', '')
    .replace(/\/$/, '');
  
  const consoleLogUrl = `${cleanUrl}/consoleText`;
  const response = await httpRequest(consoleLogUrl, {
    headers: { 'Accept': 'text/plain' },
  });
  
  return response.data;
}

/**
 * 获取 Coverage Report HTML
 */
async function getCoverageReportHtml(buildUrl) {
  const cleanUrl = buildUrl
    .replace('/display/redirect', '')
    .replace('/console', '')
    .replace('/consoleText', '')
    .replace(/\/$/, '');
  
  const artifactUrl = `${cleanUrl}/artifact/coverage/Overall-Diff-Coverage-Report.html`;

  const response = await httpRequest(artifactUrl, {
    headers: { 'Accept': 'text/html' },
  });

  return response.data;
}

/**
 * 从 HTML 提取 Coverage 统计
 */
function extractCoverageStatsFromHtml(html) {
  // 从新格式的 HTML 中提取统计数据
  // 格式示例: "Diff statement lines coverage: 100% (0/0)"
  //          "Overall statement lines coverage: 61.3341% (4478/7301)"
  const diffMatch = html.match(/Diff statement lines coverage:\s*([\d.]+)%\s*\((\d+)\/(\d+)\)/i);
  const overallMatch = html.match(/Overall statement lines coverage:\s*([\d.]+)%/i);

  if (!diffMatch && !overallMatch) {
    return null;
  }

  const coveredDiffLines = diffMatch ? parseInt(diffMatch[2], 10) : 0;
  const diffLines = diffMatch ? parseInt(diffMatch[3], 10) : 0;

  return {
    diffCoverage: diffMatch ? parseFloat(diffMatch[1]) : 0,
    overallCoverage: overallMatch ? parseFloat(overallMatch[1]) : 0,
    diffLines,
    coveredDiffLines,
    uncoveredDiffLines: Math.max(diffLines - coveredDiffLines, 0),
  };
}

/**
 * 从 HTML 解析未覆盖文件
 */
function parseDiffCoverageReportHtml(html, threshold) {
  const uncoveredFiles = [];

  // Diff Coverage Report HTML 结构:
  // <li class="d2h-file-diff-coverage-line">
  //   <span>
  //     /home/jenkins-lab/.../Fiji/project/phone/core/voicemail/src/VoicemailModule.ts
  //     <div class="d2h-file-diff-coverage-progress-bar-container">
  //       <div class="d2h-file-diff-coverage-progress-bar" style="width: 0.00%; background: #c21f39">
  //       </div>
  //     </div>
  //     <span class="d2h-file-diff-coverage-rate">0.00%</span>
  //   </span>
  // </li>

  const filePattern = /<li class="d2h-file-diff-coverage-line">[\s\S]*?project\/([^<\s]+)[\s\S]*?<span class="d2h-file-diff-coverage-rate">([\d.]+)%<\/span>/g;
  let match;

  while ((match = filePattern.exec(html)) !== null) {
    const filePath = `project/${match[1]}`;
    const coverage = parseFloat(match[2]);

    if (coverage < threshold) {
      uncoveredFiles.push({
        filePath,
        coverage,
        uncoveredLines: 0, // Diff report 不提供行数
      });
    }
  }

  uncoveredFiles.sort((a, b) => a.coverage - b.coverage);
  return uncoveredFiles;
}

// ============================================================
// Comment 解析器
// ============================================================

/**
 * 判断 comment 类型
 */
function getCommentType(comment) {
  const body = comment.body;

  if (comment.system) {
    return 'system';
  }

  if (body.includes('FAILURE:') || body.includes('SUCCESS:') || body.includes('jenkins-CommonCI-Jupiter-Web-MR')) {
    return 'jenkins_build';
  }

  return 'other';
}

/**
 * 解析 Jenkins 构建信息
 */
function parseJenkinsBuildInfo(body) {
  const buildUrlMatch = body.match(REGEX_JENKINS_BUILD_URL);

  if (!buildUrlMatch) {
    return null;
  }

  const buildNumber = parseInt(buildUrlMatch[1], 10);
  const buildUrl = buildUrlMatch[2];

  const isSuccess = body.includes('🟢 SUCCESS');
  const isFailure = body.includes('🚫 FAILURE');

  const triggeredByMatch = body.match(/Triggered by ([^\[]+)/);
  const triggeredBy = triggeredByMatch ? triggeredByMatch[1].trim() : 'Unknown';

  const branchMatch = body.match(/Fiji\/([^\s]+)\s*=>\s*(\w+)/);
  const sourceBranch = branchMatch ? branchMatch[1] : '';
  const targetBranch = branchMatch ? branchMatch[2] : '';

  return {
    buildNumber,
    buildUrl: buildUrl.replace('/display/redirect', ''),
    consoleLogUrl: buildUrl.replace('/display/redirect', '').replace(/\/$/, '') + '/consoleText',
    blueOceanUrl: buildUrl,
    status: isSuccess ? 'SUCCESS' : isFailure ? 'FAILURE' : 'UNKNOWN',
    triggeredBy,
    sourceBranch,
    targetBranch,
  };
}

/**
 * 解析阶段状态
 */
function parseStageStatuses(body) {
  const stages = [];
  const tableRowRegex = new RegExp(REGEX_STAGE_TABLE_ROW.source, 'g');
  let match;

  while ((match = tableRowRegex.exec(body)) !== null) {
    const stageName = match[1].trim();
    const statusIcon = match[2];

    if (stageName === 'stage' || stageName === '-----') continue;

    let status;
    switch (statusIcon) {
      case '✅': status = 'SUCCESS'; break;
      case '🚫': status = 'FAILURE'; break;
      case '⏩': status = 'SKIPPED'; break;
      default: status = 'RUNNING';
    }

    stages.push({ name: stageName, status });
  }

  return stages;
}

/**
 * 判断是否为完整构建
 */
function isFullBuild(stages) {
  const hasUT = stages.some(stage =>
    stage.name.toLowerCase().includes(' ut') || stage.name.toLowerCase() === 'ut'
  );

  const hasDiffCoverage = stages.some(stage =>
    stage.name.toLowerCase().includes('diffcoverage')
  );

  return hasUT && hasDiffCoverage;
}

/**
 * 找到最新的完整构建 comment
 */
function findLatestFullBuildComment(comments) {
  for (const comment of comments) {
    const type = getCommentType(comment);

    if (type === 'jenkins_build') {
      const buildInfo = parseJenkinsBuildInfo(comment.body);
      const stages = parseStageStatuses(comment.body);

      if (buildInfo && stages.length > 0 && isFullBuild(stages)) {
        return {
          commentId: comment.id,
          type,
          buildInfo,
          stages,
          createdAt: comment.created_at,
        };
      }
    }
  }
  return null;
}

// ============================================================
// Console Log 解析器
// ============================================================

/**
 * 解析失败的测试用例
 */
function parseFailedTests(log) {
  const failedTests = [];
  const seenTests = new Set();

  const failPattern = new RegExp(REGEX_FAIL_PATTERN.source, 'g');
  let match;

  while ((match = failPattern.exec(log)) !== null) {
    const testFile = match[1];

    if (seenTests.has(testFile)) continue;
    seenTests.add(testFile);

    const failIndex = match.index;
    const contextStart = Math.max(0, failIndex);
    const contextEnd = Math.min(log.length, failIndex + FAILED_TEST_SEARCH_RANGE);
    const contextLog = log.substring(contextStart, contextEnd);

    const testNamePattern = new RegExp(REGEX_TEST_NAME.source, 'g');
    let testMatch;
    let foundTests = false;

    while ((testMatch = testNamePattern.exec(contextLog)) !== null) {
      const fullTestPath = testMatch[1].trim();
      const parts = fullTestPath.split(/\s*›\s*/);
      if (parts.length < 2) continue;

      foundTests = true;
      const testName = parts.pop().trim();
      const testSuite = parts.join(' › ').trim();

      const testContext = contextLog.substring(testMatch.index, testMatch.index + TEST_CONTEXT_RANGE);
      const errorMatch = REGEX_ERROR_PATTERN.exec(testContext);

      failedTests.push({
        testFile,
        testSuite,
        testName,
        errorType: errorMatch ? errorMatch[1] : undefined,
        errorMessage: errorMatch ? errorMatch[2].trim().substring(0, MAX_ERROR_MESSAGE_LENGTH) : undefined,
      });
    }

    if (!foundTests) {
      failedTests.push({
        testFile,
        testSuite: 'Unknown',
        testName: 'Unknown',
      });
    }
  }

  return failedTests;
}

// ============================================================
// 主诊断逻辑
// ============================================================

/**
 * 执行 MR 诊断
 */
async function diagnoseMR(mrUrl, config) {
  // Step 1: 解析 MR URL
  const parsed = parseMRUrl(mrUrl);
  if (!parsed) {
    throw new Error(`无法从 URL 中提取 MR IID: ${mrUrl}`);
  }

  // Step 2: 获取 MR comments
  const comments = await getMRComments(
    config.gitlabBaseUrl,
    config.gitlabToken,
    parsed.projectId,
    parsed.mrIid
  );

  // Step 3: 找到最新的完整构建
  const latestBuild = findLatestFullBuildComment(comments);

  if (!latestBuild || !latestBuild.buildInfo) {
    throw new Error('未找到有效的构建信息');
  }

  const result = {
    mrUrl,
    mrIid: parsed.mrIid,
    projectId: parsed.projectId,
    buildInfo: latestBuild.buildInfo,
    stages: latestBuild.stages,
    failedTests: [],
    coverageStats: null,
    uncoveredFiles: [],
    isDiffCoveragePassed: true,
    diffCoverageGate: config.diffCoverageGate,
  };

  // Step 4: 获取 Console Log 并解析失败的测试
  try {
    const consoleLog = await getConsoleLog(latestBuild.buildInfo.buildUrl);
    result.failedTests = parseFailedTests(consoleLog);
  } catch (error) {
    console.error('⚠️  无法获取 Console Log:', error.message);
  }

  // Step 5: 获取 Coverage Report
  try {
    const html = await getCoverageReportHtml(latestBuild.buildInfo.buildUrl);
    result.coverageStats = extractCoverageStatsFromHtml(html);
    result.uncoveredFiles = parseDiffCoverageReportHtml(html, config.diffCoverageGate);
    result.isDiffCoveragePassed = result.uncoveredFiles.length === 0;
  } catch (error) {
    console.error('⚠️  无法获取 Coverage Report:', error.message);
  }

  // Step 6: 计算摘要
  result.summary = {
    totalStages: result.stages.length,
    passedStages: result.stages.filter(s => s.status === 'SUCCESS').length,
    failedStages: result.stages.filter(s => s.status === 'FAILURE').length,
    skippedStages: result.stages.filter(s => s.status === 'SKIPPED').length,
    totalFailedTests: result.failedTests.length,
    currentDiffCoverage: result.coverageStats ? result.coverageStats.diffCoverage : null,
  };

  return result;
}

// ============================================================
// 格式化输出
// ============================================================

/**
 * 格式化诊断结果
 */
function formatDiagnosisResult(result, config) {
  const lines = [];

  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('📊 GitLab MR Pipeline 构建状态诊断报告');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');
  lines.push(`🔗 MR URL: ${result.mrUrl}`);
  lines.push(`📦 Project: ${result.projectId}`);
  lines.push(`🔢 MR IID: ${result.mrIid}`);
  lines.push('');

  if (result.buildInfo) {
    const statusLabel = result.buildInfo.status === 'SUCCESS' ? '🟢 SUCCESS' : '🔴 FAILURE';
    lines.push(`🏗️  构建状态: ${statusLabel}`);
    lines.push(`📌 构建号: #${result.buildInfo.buildNumber}`);
    lines.push(`👤 触发者: ${result.buildInfo.triggeredBy}`);
    lines.push(`🌿 分支: ${result.buildInfo.sourceBranch} → ${result.buildInfo.targetBranch}`);
    lines.push(`🔗 Jenkins: ${result.buildInfo.buildUrl}`);
    lines.push(`🔗 Blue Ocean: ${result.buildInfo.blueOceanUrl}`);
    lines.push('');
  }

  // 阶段状态
  lines.push(`📋 阶段状态 (${result.stages.length} 个阶段):`);
  lines.push('┌──────────────────────┬──────────┐');
  lines.push('│ 阶段                   │ 状态       │');
  lines.push('├──────────────────────┼──────────┤');

  for (const stage of result.stages) {
    const statusIcon = stage.status === 'SUCCESS' ? '✅ 通过' :
                      stage.status === 'FAILURE' ? '❌ 失败' :
                      stage.status === 'SKIPPED' ? '⏭️  跳过' : '🔄 运行中';
    const paddedName = stage.name.padEnd(20);
    lines.push(`│ ${paddedName} │ ${statusIcon}     │`);
  }

  lines.push('└──────────────────────┴──────────┘');
  lines.push('');

  // 失败的测试
  if (result.failedTests.length > 0) {
    const fileMap = new Map();
    for (const test of result.failedTests) {
      if (!fileMap.has(test.testFile)) {
        fileMap.set(test.testFile, []);
      }
      fileMap.get(test.testFile).push(test);
    }

    lines.push(`❌ 失败的测试 (${fileMap.size} 个文件, ${result.failedTests.length} 个用例):`);
    let fileIndex = 1;
    for (const [file, tests] of fileMap) {
      lines.push(`  ${fileIndex}. ${file}`);
      for (const test of tests) {
        lines.push(`     └─ ${test.testSuite} › ${test.testName}`);
      }
      fileIndex++;
    }
    lines.push('');
  }

  // Coverage 统计
  if (result.coverageStats) {
    const stats = result.coverageStats;
    const gap = config.diffCoverageGate - stats.diffCoverage;
    const gapText = gap > 0 ? ` (差 ${gap.toFixed(2)}%)` : '';

    lines.push('📈 Coverage:');
    if (result.isDiffCoveragePassed) {
      lines.push('  ✅ Diff Coverage: 通过 (≥ 90%)');
    } else {
      lines.push(`  ❌ Diff Coverage: ${stats.diffCoverage.toFixed(2)}% (要求 ≥ ${config.diffCoverageGate}%${gapText})`);
      lines.push(`  📊 Diff Lines: ${stats.diffLines} 行 (覆盖 ${stats.coveredDiffLines}, 未覆盖 ${stats.uncoveredDiffLines})`);
    }
    lines.push(`  📊 Overall Coverage: ${stats.overallCoverage.toFixed(4)}%`);
    lines.push('');

    if (result.uncoveredFiles.length > 0) {
      lines.push(`📁 未覆盖文件 (${result.uncoveredFiles.length} 个):`);
      for (let i = 0; i < result.uncoveredFiles.length; i++) {
        const file = result.uncoveredFiles[i];
        lines.push(`  ${i + 1}. ${file.filePath} (${file.coverage}%)`);
      }
      lines.push('');
    }
  }

  // 摘要
  lines.push('📊 摘要:');
  lines.push(`  总阶段: ${result.summary.totalStages} (通过 ${result.summary.passedStages}, 失败 ${result.summary.failedStages}, 跳过 ${result.summary.skippedStages})`);
  if (result.summary.totalFailedTests > 0) {
    lines.push(`  失败测试: ${result.summary.totalFailedTests} 个`);
  }
  if (result.summary.currentDiffCoverage !== null) {
    lines.push(`  Diff Coverage: ${result.summary.currentDiffCoverage.toFixed(2)}%`);
  }
  lines.push('');

  // 建议
  lines.push('💡 建议:');
  const failedStages = result.stages.filter(s => s.status === 'FAILURE');
  const failedUT = failedStages.some(s => s.name.toLowerCase().includes(' ut'));
  const failedCoverage = failedStages.some(s => s.name.toLowerCase().includes('diffcoverage'));
  const otherFailed = failedStages.filter(s =>
    !s.name.toLowerCase().includes(' ut') && !s.name.toLowerCase().includes('diffcoverage')
  );

  if (result.failedTests.length > 0) {
    const fileMap = new Map();
    for (const test of result.failedTests) {
      if (!fileMap.has(test.testFile)) {
        fileMap.set(test.testFile, []);
      }
    }

    lines.push(`  🔴 ${result.failedTests.length} 个测试失败 (${fileMap.size} 个文件)`);
    let idx = 1;
    for (const file of fileMap.keys()) {
      lines.push(`    ${idx}. ${file}`);
      idx++;
    }
    lines.push('  💡 运行: yarn test:no-watch <file>');
  }

  if (!result.isDiffCoveragePassed && result.coverageStats) {
    const gap = config.diffCoverageGate - result.coverageStats.diffCoverage;
    lines.push(`  🟡 Coverage 不足: ${result.coverageStats.diffCoverage.toFixed(2)}% < ${config.diffCoverageGate}% (差 ${gap.toFixed(2)}%)`);
    lines.push(`    需覆盖 ${result.coverageStats.uncoveredDiffLines} 行代码 (${result.uncoveredFiles.length} 个文件):`);
    for (let i = 0; i < Math.min(result.uncoveredFiles.length, 5); i++) {
      const file = result.uncoveredFiles[i];
      lines.push(`    ${i + 1}. ${file.filePath} (${file.coverage}%)`);
    }
  }

  if (otherFailed.length > 0) {
    lines.push(`  🔴 其他失败: ${otherFailed.map(s => s.name).join(', ')}`);
  }

  if (result.failedTests.length === 0 && result.isDiffCoveragePassed && failedStages.length === 0) {
    lines.push('  ✅ 所有检查通过');
  }

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════');

  return lines.join('\n');
}

// ============================================================
// 命令行参数解析
// ============================================================

/**
 * 解析命令行参数
 */
function parseArgs(argv) {
  const args = {
    mrUrl: '',
    token: process.env.GITLAB_TOKEN || '',
    diffCoverageGate: DEFAULT_DIFF_COVERAGE_GATE,
    gitlabBaseUrl: process.env.GITLAB_BASE_URL || DEFAULT_GITLAB_BASE_URL,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '-h' || arg === '--help') {
      args.help = true;
      continue;
    }

    if (arg === '--token' || arg === '-t') {
      args.token = argv[++i];
      continue;
    }

    if (arg.startsWith('--token=')) {
      args.token = arg.slice('--token='.length);
      continue;
    }

    if (arg === '--gate' || arg === '-g') {
      args.diffCoverageGate = parseFloat(argv[++i]);
      continue;
    }

    if (arg.startsWith('--gate=')) {
      args.diffCoverageGate = parseFloat(arg.slice('--gate='.length));
      continue;
    }

    if (arg === '--base-url') {
      args.gitlabBaseUrl = argv[++i];
      continue;
    }

    if (arg.startsWith('--base-url=')) {
      args.gitlabBaseUrl = arg.slice('--base-url='.length);
      continue;
    }

    if (!args.mrUrl) {
      args.mrUrl = arg;
      continue;
    }
  }

  return args;
}

/**
 * 打印帮助信息
 */
function printHelp() {
  console.log(`
用法:
  node standalone-diagnose.js <MR_URL> [选项]

示例:
  node standalone-diagnose.js https://git.ringcentral.com/Fiji/Fiji/-/merge_requests/42352 --token YOUR_TOKEN
  node standalone-diagnose.js https://git.ringcentral.com/Fiji/Fiji/-/merge_requests/42352/diffs --token YOUR_TOKEN --gate 85

选项:
  --token, -t <TOKEN>       GitLab Private Token (或设置环境变量 GITLAB_TOKEN)
  --gate, -g <NUMBER>       Diff Coverage 阈值 (默认: 90)
  --base-url <URL>          GitLab 基础 URL (默认: https://git.ringcentral.com)
  -h, --help                显示帮助信息

环境变量:
  GITLAB_TOKEN              GitLab Private Token
  GITLAB_BASE_URL           GitLab 基础 URL
`);
}

// ============================================================
// 主函数
// ============================================================

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.mrUrl) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  if (!args.token) {
    console.error('❌ 缺少 GitLab Token (设置 GITLAB_TOKEN 环境变量或使用 --token 参数)');
    process.exit(1);
  }

  const config = {
    gitlabBaseUrl: args.gitlabBaseUrl,
    gitlabToken: args.token,
    diffCoverageGate: args.diffCoverageGate,
  };

  try {
    const result = await diagnoseMR(args.mrUrl, config);
    const formatted = formatDiagnosisResult(result, config);
    console.log(formatted);

    // 根据构建状态设置退出码
    if (result.buildInfo && result.buildInfo.status === 'FAILURE') {
      process.exit(1);
    }
  } catch (error) {
    console.error(`❌ ${error.message}`);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// 运行主函数
if (require.main === module) {
  main();
}

