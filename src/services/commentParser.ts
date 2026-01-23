import {
  GitLabComment,
  ParsedComment,
  JenkinsBuildInfo,
  StageStatus,
} from '../types';
import {
  REGEX_JENKINS_BUILD_URL,
  REGEX_STAGE_TABLE_ROW,
  BASIC_BUILD_STAGES,
  BUILD_ONLY_MAX_STAGES,
} from '../constants';

/**
 * Comment 解析器
 * 解析 GitLab MR 上 Jenkins bot 发布的构建信息
 */
export class CommentParser {
  /**
   * 判断 comment 类型
   */
  getCommentType(
    comment: GitLabComment
  ): ParsedComment['type'] {
    const body = comment.body;

    if (comment.system) {
      return 'system';
    }

    // Jenkins 构建结果
    if (
      body.includes('FAILURE:') ||
      body.includes('SUCCESS:') ||
      body.includes('jenkins-CommonCI-Jupiter-Web-MR')
    ) {
      return 'jenkins_build';
    }

    // E2E 结果
    if (body.includes('Jupiter-E2E') && (body.includes('SUCCESS') || body.includes('FAILURE'))) {
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

  /**
   * 解析 Jenkins 构建信息
   */
  parseJenkinsBuildInfo(body: string): JenkinsBuildInfo | null {
    const buildUrlMatch = body.match(REGEX_JENKINS_BUILD_URL);

    if (!buildUrlMatch) {
      return null;
    }

    const buildNumber = parseInt(buildUrlMatch[1], 10);
    const buildUrl = buildUrlMatch[2];

    // 构造 console log URL
    const consoleLogUrl = buildUrl
      .replace('/display/redirect', '')
      .replace(/\/$/, '') + '/consoleText';

    // 提取状态
    const isSuccess = body.includes('🟢 SUCCESS');
    const isFailure = body.includes('🚫 FAILURE');

    // 提取触发者
    const triggeredByMatch = body.match(/Triggered by ([^\[]+)/);
    const triggeredBy = triggeredByMatch ? triggeredByMatch[1].trim() : 'Unknown';

    // 提取 MR 信息
    const mrUrlMatch = body.match(/\[GitLab Merge Request #(\d+)\]\((https:\/\/[^\)]+)\)/);
    const mrUrl = mrUrlMatch ? mrUrlMatch[2] : '';

    // 提取分支信息
    const branchMatch = body.match(/Fiji\/([^\s]+)\s*=>\s*(\w+)/);
    const sourceBranch = branchMatch ? branchMatch[1] : '';
    const targetBranch = branchMatch ? branchMatch[2] : '';

    return {
      buildNumber,
      buildUrl: buildUrl.replace('/display/redirect', ''),
      consoleLogUrl,
      blueOceanUrl: buildUrl,
      status: isSuccess ? 'SUCCESS' : isFailure ? 'FAILURE' : 'UNKNOWN',
      triggeredBy,
      mrUrl,
      mrTitle: '',
      sourceBranch,
      targetBranch,
    };
  }

  /**
   * 解析阶段状态表格
   */
  parseStageStatuses(body: string): StageStatus[] {
    const stages: StageStatus[] = [];
    const tableRowRegex = new RegExp(REGEX_STAGE_TABLE_ROW.source, 'g');
    let match;

    while ((match = tableRowRegex.exec(body)) !== null) {
      const stageName = match[1].trim();
      const statusIcon = match[2];
      const reporters = match[3].trim();

      // 跳过表头
      if (stageName === 'stage' || stageName === '-----') continue;

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
        testReportUrl: testReportMatch ? testReportMatch[1] : undefined,
        coverageReportUrl: coverageReportMatch ? coverageReportMatch[1] : undefined,
      });
    }

    return stages;
  }

  /**
   * 提取所有报告 URLs
   */
  parseReportUrls(body: string): Record<string, string> {
    const urls: Record<string, string> = {};
    const linkRegex = /\[([^\]]+)\]\((https:\/\/[^\)]+)\)/g;
    let match;

    while ((match = linkRegex.exec(body)) !== null) {
      const name = match[1].trim();
      const url = match[2];
      // 过滤掉一些非报告链接
      if (!name.includes('GitLab') && !name.includes('jenkins-')) {
        urls[name] = url;
      }
    }

    return urls;
  }

  /**
   * 解析单个 comment
   */
  parseComment(comment: GitLabComment): ParsedComment {
    const type = this.getCommentType(comment);
    const result: ParsedComment = {
      commentId: comment.id,
      type,
      createdAt: comment.created_at,
    };

    if (type === 'jenkins_build') {
      const buildInfo = this.parseJenkinsBuildInfo(comment.body);
      if (buildInfo) {
        result.buildStatus = buildInfo.status === 'SUCCESS' ? 'SUCCESS' : 'FAILURE';
        result.buildInfo = buildInfo;
        result.stages = this.parseStageStatuses(comment.body);
        result.reportUrls = this.parseReportUrls(comment.body);
      }
    }

    return result;
  }

  /**
   * 判断是否为完整构建（包含 UT + Coverage，而非 build-only）
   */
  isFullBuild(stages: StageStatus[]): boolean {
    // 完整构建必须包含：
    // 1. 至少一个 UT 阶段 (phone ut, message ut, app ut, ai ut 等)
    // 2. diffcoverage 阶段
    const hasUT = stages.some(
      (stage) =>
        stage.name.toLowerCase().includes(' ut') ||
        stage.name.toLowerCase() === 'ut'
    );

    const hasDiffCoverage = stages.some(
      (stage) => stage.name.toLowerCase().includes('diffcoverage')
    );

    return hasUT && hasDiffCoverage;
  }

  /**
   * 判断是否为 build-only 构建
   */
  isBuildOnly(stages: StageStatus[]): boolean {
    if (stages.length > BUILD_ONLY_MAX_STAGES) {
      return false;
    }

    const allBasic = stages.every((stage) =>
      BASIC_BUILD_STAGES.some((basic) => stage.name.toLowerCase().includes(basic))
    );

    return allBasic;
  }

  /**
   * 找到最新的完整构建 comment（包含 UT + Coverage）
   */
  findLatestFullBuildComment(comments: GitLabComment[]): ParsedComment | null {
    for (const comment of comments) {
      const parsed = this.parseComment(comment);

      if (parsed.type === 'jenkins_build' && parsed.stages && parsed.stages.length > 0) {
        if (this.isFullBuild(parsed.stages)) {
          return parsed;
        }
      }
    }
    return null;
  }

  /**
   * 找到最新的任意 Jenkins 构建 comment（用于诊断）
   */
  findLatestBuildComment(comments: GitLabComment[]): ParsedComment | null {
    for (const comment of comments) {
      const parsed = this.parseComment(comment);

      if (parsed.type === 'jenkins_build' && parsed.buildInfo) {
        return parsed;
      }
    }
    return null;
  }

  /**
   * 找到最新的失败构建 comment
   */
  findLatestFailedBuildComment(comments: GitLabComment[]): ParsedComment | null {
    for (const comment of comments) {
      const parsed = this.parseComment(comment);

      if (parsed.type === 'jenkins_build' && parsed.buildStatus === 'FAILURE') {
        return parsed;
      }
    }
    return null;
  }
}

export default CommentParser;

