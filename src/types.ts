/**
 * MCP MR Diagnosis Tool - 类型定义
 * @module types
 */

// ============================================================
// GitLab 相关类型
// ============================================================

/**
 * GitLab MR Comment 类型
 * 来自 GitLab API 的评论数据
 */
export interface GitLabComment {
  /** 评论 ID */
  id: number;
  /** 评论正文 (Markdown 格式) */
  body: string;
  /** 评论作者 */
  author: {
    id: number;
    username: string;
    name: string;
  };
  /** 创建时间 (ISO 8601) */
  created_at: string;
  /** 更新时间 (ISO 8601) */
  updated_at: string;
  /** 是否为系统评论 */
  system: boolean;
  /** 关联对象 ID */
  noteable_id: number;
  /** 关联对象类型 */
  noteable_type: string;
  /** 关联对象 IID */
  noteable_iid: number;
}

// ============================================================
// Jenkins 相关类型
// ============================================================

/**
 * Jenkins 构建信息
 * 从 MR 评论中解析的构建数据
 */
export interface JenkinsBuildInfo {
  /** 构建编号 */
  buildNumber: number;
  /** 构建 URL */
  buildUrl: string;
  /** Console Log URL */
  consoleLogUrl: string;
  /** Blue Ocean UI URL */
  blueOceanUrl: string;
  /** 构建状态 */
  status: 'SUCCESS' | 'FAILURE' | 'RUNNING' | 'UNKNOWN';
  /** 触发者 */
  triggeredBy: string;
  /** MR URL */
  mrUrl: string;
  /** MR 标题 */
  mrTitle: string;
  /** 源分支 */
  sourceBranch: string;
  /** 目标分支 */
  targetBranch: string;
}

/**
 * 构建阶段状态
 * CI Pipeline 中各阶段的执行状态
 */
export interface StageStatus {
  /** 阶段名称 */
  name: string;
  /** 阶段状态 */
  status: 'SUCCESS' | 'FAILURE' | 'SKIPPED' | 'RUNNING';
  /** 测试报告 URL (可选) */
  testReportUrl?: string;
  /** 覆盖率报告 URL (可选) */
  coverageReportUrl?: string;
  /** 描述信息 (可选) */
  description?: string;
}

// ============================================================
// 测试和覆盖率类型
// ============================================================

/**
 * 失败的测试用例
 * 从 Console Log 中解析的失败测试信息
 */
export interface FailedTestCase {
  /** 测试文件路径 */
  testFile: string;
  /** 测试套件名称 */
  testSuite: string;
  /** 测试用例名称 */
  testName: string;
  /** 错误类型 (如 TypeError, ReferenceError) */
  errorType?: string;
  /** 错误消息 */
  errorMessage?: string;
  /** 期望值 */
  expectedValue?: string;
  /** 实际值 */
  receivedValue?: string;
}

/**
 * 未覆盖的文件信息
 * 从 Coverage Report 中解析的未覆盖文件详情
 */
export interface UncoveredFile {
  /** 文件路径 */
  filePath: string;
  /** 文件覆盖率百分比 */
  coverage: number;
  /** 未覆盖的行数 */
  uncoveredLines: number;
  /** 未覆盖的具体行号列表 (可选) */
  lineNumbers?: string;
}

/**
 * 覆盖率统计
 * Diff Coverage 和 Overall Coverage 数据
 */
export interface CoverageStats {
  /** 统计类型 */
  type: 'overall' | 'phone' | 'message' | 'app' | 'ai';
  /** 变更行数 */
  diffLines: number;
  /** 已覆盖的变更行数 */
  coveredDiffLines: number;
  /** 未覆盖的变更行数 */
  uncoveredDiffLines: number;
  /** Diff Coverage 百分比 */
  diffCoverage: number;
  /** 整体覆盖率百分比 */
  overallCoverage: number;
  /** 行覆盖率 (可选) */
  lineCoverage?: number;
  /** 分支覆盖率 (可选) */
  branchCoverage?: number;
  /** 语句覆盖率 (可选) */
  statementCoverage?: number;
  /** 函数覆盖率 (可选) */
  functionCoverage?: number;
}

// ============================================================
// 诊断结果类型
// ============================================================

/**
 * 诊断摘要
 * 诊断结果的统计信息
 */
export interface DiagnosisSummary {
  /** 总阶段数 */
  totalStages: number;
  /** 通过的阶段数 */
  passedStages: number;
  /** 失败的阶段数 */
  failedStages: number;
  /** 跳过的阶段数 */
  skippedStages: number;
  /** 失败的测试用例数 */
  totalFailedTests: number;
  /** 当前 Diff Coverage 百分比（未解析时为 null） */
  currentDiffCoverage: number | null;
}

/**
 * MR 诊断结果
 * diagnose 方法的完整返回结果
 */
export interface MRDiagnosisResult {
  /** MR URL */
  mrUrl: string;
  /** MR IID */
  mrIid: number;
  /** 项目 ID (namespace/project) */
  projectId: string;
  /** 构建信息 */
  buildInfo: JenkinsBuildInfo | null;
  /** 构建阶段列表 */
  stages: StageStatus[];
  /** 失败的测试用例列表 */
  failedTests: FailedTestCase[];
  /** 覆盖率统计列表 */
  coverageStats: CoverageStats[];
  /** 未覆盖的文件列表 */
  uncoveredFiles: UncoveredFile[];
  /** Diff Coverage 是否达标 */
  isDiffCoveragePassed: boolean;
  /** Diff Coverage 阈值 */
  diffCoverageGate: number;
  /** 诊断摘要 */
  summary: DiagnosisSummary;
  /** 修复建议列表 */
  recommendations: string[];
}

// ============================================================
// 解析相关类型
// ============================================================

/** 评论类型 */
export type CommentType = 'jenkins_build' | 'e2e_result' | 'deploy_ready' | 'user_command' | 'system' | 'other';

/** 构建状态 */
export type BuildStatus = 'SUCCESS' | 'FAILURE';

/**
 * 解析后的 Comment 信息
 */
export interface ParsedComment {
  /** 评论 ID */
  commentId: number;
  /** 评论类型 */
  type: CommentType;
  /** 构建状态 (可选) */
  buildStatus?: BuildStatus;
  /** 构建信息 (可选) */
  buildInfo?: JenkinsBuildInfo;
  /** 阶段状态列表 (可选) */
  stages?: StageStatus[];
  /** 报告 URL 映射 (可选) */
  reportUrls?: Record<string, string>;
  /** 创建时间 */
  createdAt: string;
}

// ============================================================
// 配置类型
// ============================================================

/**
 * 诊断配置选项
 */
export interface DiagnosisConfig {
  /** GitLab 基础 URL */
  gitlabBaseUrl: string;
  /** GitLab Private Token */
  gitlabToken: string;
  /** Diff Coverage 阈值 (0-100) */
  diffCoverageGate: number;
}
