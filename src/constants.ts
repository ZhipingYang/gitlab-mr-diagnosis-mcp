/**
 * 常量配置文件
 * 集中管理项目中的魔法数字、正则表达式和默认值
 */

// ============================================================
// 默认配置 (可通过环境变量覆盖)
// ============================================================

/** GitLab 默认基础 URL */
export const DEFAULT_GITLAB_BASE_URL = process.env.GITLAB_BASE_URL || 'https://git.ringcentral.com';

/** Jenkins 基础 URL */
export const JENKINS_BASE_URL = process.env.JENKINS_BASE_URL || '';

/** Jenkins Job 路径 */
export const JENKINS_JOB_PATH = process.env.JENKINS_JOB_PATH || '';

/** 默认 Diff Coverage 阈值 (%) */
export const DEFAULT_DIFF_COVERAGE_GATE = 90;

/** 默认每页评论数 */
export const DEFAULT_COMMENTS_PER_PAGE = 50;

// ============================================================
// 解析器配置
// ============================================================

/** 测试失败详情搜索范围 (字符数) */
export const FAILED_TEST_SEARCH_RANGE = 50000;

/** 错误信息最大长度 */
export const MAX_ERROR_MESSAGE_LENGTH = 200;

/** 测试名称最大长度 */
export const MAX_TEST_NAME_LENGTH = 100;

/** 错误详情上下文范围 (字符数) */
export const ERROR_CONTEXT_RANGE = 3000;

/** 测试上下文范围 (字符数) */
export const TEST_CONTEXT_RANGE = 500;

/** Build-only 构建最大阶段数 */
export const BUILD_ONLY_MAX_STAGES = 5;

// ============================================================
// 正则表达式
// ============================================================

/** 匹配失败的测试文件路径 */
export const REGEX_FAIL_PATTERN = /FAIL(?:\s+(?:UT|NODE))?\s+(project\/[^\s]+\.test(?:\.[a-z]+)*\.[tj]sx?)/g;

/** 匹配测试用例名称 (支持时间戳前缀) */
export const REGEX_TEST_NAME = /(?:\[[\d\-T:.Z]+\]\s*)?●\s+([^\n]+)/g;

/** 匹配错误类型和消息 */
export const REGEX_ERROR_PATTERN = /(TypeError|ReferenceError|SyntaxError|Error):\s*([^\n]+)/;

/** 匹配 Overall Diff Coverage 统计 */
export const REGEX_OVERALL_DIFF_COVERAGE = /Overall Diff Coverage Statistics\*{0,2}[:\s]+diffLines[:\s]*(\d+)[,\s]*coveredDiffLines[:\s]*(\d+)[,\s]*uncoveredDiffLines[:\s]*(\d+)[,\s]*diffCoverage[:\s]*([\d.]+)%?[,\s]*overallCoverage[:\s]*([\d.]+)%?/i;

/** 匹配 Overall Coverage 统计 */
export const REGEX_OVERALL_COVERAGE = /Overall Coverage Statistics\*{0,2}[:\s]+lineCoverage[:\s]*([\d.]+)[,\s]*branchCoverage[:\s]*([\d.]+)[,\s]*statementCoverage[:\s]*([\d.]+)[,\s]*functionCoverage[:\s]*([\d.]+)/i;

/** 匹配 Phone Diff Coverage 统计 */
export const REGEX_PHONE_DIFF_COVERAGE = /Phone Diff Coverage Statistics\*{0,2}[:\s]+diffLines[:\s]*(\d+)[,\s]*coveredDiffLines[:\s]*(\d+)[,\s]*uncoveredDiffLines[:\s]*(\d+)[,\s]*diffCoverage[:\s]*([\d.]+)%?[,\s]*overallCoverage[:\s]*([\d.]+)%?/i;

/** 匹配测试统计摘要 */
export const REGEX_TEST_SUMMARY = /Tests:\s*(\d+)\s*failed,\s*(\d+)\s*skipped,\s*(\d+)\s*passed/i;

/** 匹配未覆盖文件行 (格式: 文件路径 | 覆盖率 | 未覆盖行数) */
export const REGEX_UNCOVERED_FILE = /^\s*(project\/[^\s|]+)\s*\|\s*([\d.]+)%?\s*\|\s*(\d+)/gm;

/** 匹配未覆盖的行号列表 (例如: "Uncovered lines: 10, 15-20, 30") */
export const REGEX_UNCOVERED_LINES = /Uncovered\s*(?:lines|Lines)[:\s]*([\d,\s\-]+)/i;

/** 匹配 Jenkins 构建 URL */
export const REGEX_JENKINS_BUILD_URL = /\[jenkins-CommonCI-Jupiter-Web-MR-Auto-Generate-(\d+)\]\((https:\/\/[^\)]+)\)/;

/** 匹配 GitLab MR URL 格式 1 */
export const REGEX_MR_URL_PATTERN_1 = /https?:\/\/[^\/]+\/([^\/]+\/[^\/]+)\/-\/merge_requests\/(\d+)/;

/** 匹配 GitLab MR URL 格式 2 */
export const REGEX_MR_URL_PATTERN_2 = /https?:\/\/[^\/]+\/([^\/]+\/[^\/]+)\/merge_requests\/(\d+)/;

/** 匹配表格行 (阶段状态) */
export const REGEX_STAGE_TABLE_ROW = /\|\s*(\w+[\w\s+:]*)\s*\|\s*(✅|🚫|⏩|🔄)\s*\|([^|]*)\|([^|]*)\|/g;

// ============================================================
// Build-only 相关
// ============================================================

/** 基础构建阶段名称 (用于识别 build-only) */
export const BASIC_BUILD_STAGES = ['checkout', 'install', 'build+deploy:rc', 'build', 'deploy'];

// ============================================================
// API 请求配置
// ============================================================

/** 批量测试请求间隔 (ms) */
export const BATCH_REQUEST_DELAY = 500;

