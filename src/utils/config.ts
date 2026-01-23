/**
 * 配置加载工具
 * 统一管理环境变量和默认配置
 */

import { DiagnosisConfig } from '../types';
import { DEFAULT_GITLAB_BASE_URL, DEFAULT_DIFF_COVERAGE_GATE } from '../constants';

/**
 * 从环境变量加载诊断配置
 * @param overrides - 可选的配置覆盖
 */
export function loadDiagnosisConfig(overrides?: Partial<DiagnosisConfig>): DiagnosisConfig {
  const token = overrides?.gitlabToken || process.env.GITLAB_TOKEN;

  if (!token) {
    console.warn('⚠️  警告: 未设置 GITLAB_TOKEN 环境变量');
  }

  return {
    gitlabBaseUrl: overrides?.gitlabBaseUrl || process.env.GITLAB_BASE_URL || DEFAULT_GITLAB_BASE_URL,
    gitlabToken: token || '',
    diffCoverageGate: overrides?.diffCoverageGate || parseInt(process.env.DIFF_COVERAGE_GATE || String(DEFAULT_DIFF_COVERAGE_GATE), 10),
  };
}

/**
 * 验证配置是否有效
 */
export function validateConfig(config: DiagnosisConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.gitlabToken) {
    errors.push('缺少 GitLab Token (设置 GITLAB_TOKEN 环境变量或传入 gitlab_token 参数)');
  }

  if (!config.gitlabBaseUrl) {
    errors.push('缺少 GitLab Base URL');
  }

  if (config.diffCoverageGate < 0 || config.diffCoverageGate > 100) {
    errors.push('Diff Coverage Gate 必须在 0-100 之间');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

