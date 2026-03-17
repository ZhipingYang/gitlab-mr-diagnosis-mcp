import { GitLabService } from '../services/gitlab';
import { JenkinsService } from '../services/jenkins';
import { CommentParser } from '../services/commentParser';
import { ConsoleLogParser } from '../services/consoleLogParser';
import {
  MRDiagnosisResult,
  DiagnosisConfig,
  DiagnosisSummary,
  StageStatus,
} from '../types';

/**
 * MR 诊断工具
 * 整合 GitLab 和 Jenkins 服务，提供完整的 MR 构建状态诊断
 */
export class MRDiagnosisTool {
  private gitlabService: GitLabService;
  private jenkinsService: JenkinsService;
  private commentParser: CommentParser;
  private consoleLogParser: ConsoleLogParser;
  private config: DiagnosisConfig;

  constructor(config: DiagnosisConfig) {
    this.config = config;
    this.gitlabService = new GitLabService(config.gitlabBaseUrl, config.gitlabToken);
    this.jenkinsService = new JenkinsService();
    this.commentParser = new CommentParser();
    this.consoleLogParser = new ConsoleLogParser();
  }

  /**
   * 执行完整的 MR 诊断
   */
  async diagnose(mrUrl: string): Promise<MRDiagnosisResult> {
    // Step 1: 解析 MR URL
    const parsed = this.gitlabService.parseMRUrl(mrUrl);
    if (!parsed) {
      throw new Error(`Invalid MR URL: ${mrUrl}`);
    }

    // Step 2: 获取 MR comments
    const comments = await this.gitlabService.getMRComments(
      parsed.projectId,
      parsed.mrIid
    );

    // Step 3: 解析 comments，找到最新的完整构建（包含 UT + Coverage）
    const latestFullBuildComment = this.commentParser.findLatestFullBuildComment(comments);
    const latestAnyBuildComment = this.commentParser.findLatestBuildComment(comments);

    // 初始化结果
    const result: MRDiagnosisResult = {
      mrUrl,
      mrIid: parsed.mrIid,
      projectId: parsed.projectId,
      buildInfo: null,
      stages: [],
      failedTests: [],
      coverageStats: [],
      uncoveredFiles: [],
      isDiffCoveragePassed: true,
      diffCoverageGate: this.config.diffCoverageGate,
      summary: {
        totalStages: 0,
        passedStages: 0,
        failedStages: 0,
        skippedStages: 0,
        totalFailedTests: 0,
        currentDiffCoverage: 0,
      },
      recommendations: [],
    };

    // 检查是否找到完整构建
    if (!latestFullBuildComment || !latestFullBuildComment.buildInfo) {
      // 有构建记录但不是完整构建（缺少 UT 或 Coverage）
      if (latestAnyBuildComment && latestAnyBuildComment.buildInfo) {
        result.buildInfo = latestAnyBuildComment.buildInfo;
        result.stages = latestAnyBuildComment.stages || [];
        result.recommendations.push(
          '⚠️ 当前最新构建缺少完整的 UT 检查和代码覆盖率报告（可能是 build-only 模式）'
        );
        result.recommendations.push(
          '💡 建议: 在 MR 中评论 "build" 触发完整构建流程（包含 UT + Coverage）'
        );
        result.summary = this.calculateSummary(result);
        return result;
      }

      result.recommendations.push('未找到任何构建记录，请在 MR 中评论 "build" 触发构建');
      return result;
    }

    // 使用完整构建的信息
    const latestBuildComment = latestFullBuildComment;
    const buildInfo = latestBuildComment.buildInfo!;

    result.buildInfo = buildInfo;
    result.stages = latestBuildComment.stages || [];

    // Step 4: 获取 Console Log 并解析 UT 失败
    let consoleLog = '';
    try {
      consoleLog = await this.jenkinsService.getConsoleLog(
        buildInfo.consoleLogUrl
      );
    } catch (error) {
      result.recommendations.push(`无法获取 Console Log: ${error}`);
    }

    // Step 5: 解析 Console Log（只解析 UT 失败）
    if (consoleLog) {
      const logAnalysis = this.consoleLogParser.parseAll(consoleLog);
      result.failedTests = logAnalysis.failedTests;
    }

    // Step 6: 从 artifact HTML 获取 Coverage 数据（统计 + 文件列表）
    if (buildInfo.consoleLogUrl) {
      try {
        // 从 consoleLogUrl 提取 buildUrl
        const buildUrl = buildInfo.consoleLogUrl.replace('/consoleText', '');
        const artifactUrl = `${buildUrl}/artifact/coverage/Overall-Diff-Coverage-Report.html`;

        const coverageData = await this.jenkinsService.getCoverageData(
          buildUrl,
          this.config.diffCoverageGate
        );

        // 更新 Coverage 统计
        if (coverageData.stats) {
          result.coverageStats = [{
            type: 'overall',
            diffLines: 0,
            coveredDiffLines: 0,
            uncoveredDiffLines: 0,
            diffCoverage: coverageData.stats.diffCoverage,
            overallCoverage: coverageData.stats.overallCoverage,
          }];
        } else {
          // 如果没有统计数据，添加警告
          result.recommendations.push(
            '⚠️ 无法从 Coverage Report 中提取统计数据'
          );
          result.recommendations.push(
            `💡 请手动查看: ${artifactUrl}`
          );
        }

        // 更新未覆盖文件列表
        result.uncoveredFiles = coverageData.uncoveredFiles;
        result.isDiffCoveragePassed = coverageData.isDiffCoveragePassed;
      } catch (error) {
        // 如果获取失败，添加详细错误信息到建议中
        const errorMsg = error instanceof Error ? error.message : String(error);
        const buildUrl = buildInfo.consoleLogUrl.replace('/consoleText', '');
        const artifactUrl = `${buildUrl}/artifact/coverage/Overall-Diff-Coverage-Report.html`;

        result.recommendations.push(
          `⚠️ 无法获取 Coverage 详细数据: ${errorMsg}`
        );
        result.recommendations.push(
          `💡 请手动查看 Coverage Report: ${artifactUrl}`
        );

        // 记录错误日志（用于调试）
        console.error('[Coverage] Failed to get coverage data:', {
          buildUrl,
          artifactUrl,
          error: errorMsg,
        });
      }
    }

    // 计算摘要
    result.summary = this.calculateSummary(result);

    // 生成建议
    result.recommendations = this.generateRecommendations(result);

    return result;
  }

  /**
   * 计算诊断摘要
   */
  private calculateSummary(result: MRDiagnosisResult): DiagnosisSummary {
    const stages = result.stages;
    const passedStages = stages.filter(s => s.status === 'SUCCESS').length;
    const failedStages = stages.filter(s => s.status === 'FAILURE').length;
    const skippedStages = stages.filter(s => s.status === 'SKIPPED').length;

    const overallCoverage = result.coverageStats.find(s => s.type === 'overall');
    const currentDiffCoverage = overallCoverage?.diffCoverage ?? 0;

    return {
      totalStages: stages.length,
      passedStages,
      failedStages,
      skippedStages,
      totalFailedTests: result.failedTests.length,
      currentDiffCoverage,
    };
  }

  /**
   * 生成修复建议
   */
  private generateRecommendations(result: MRDiagnosisResult): string[] {
    const recommendations: string[] = [];

    // UT 失败建议
    if (result.failedTests.length > 0) {
      recommendations.push(
        `发现 ${result.failedTests.length} 个测试用例失败，需要修复：`
      );
      result.failedTests.forEach((test, index) => {
        recommendations.push(
          `  ${index + 1}. ${test.testFile}`
        );
        recommendations.push(
          `     测试: ${test.testSuite} › ${test.testName}`
        );
      });
      recommendations.push(
        `建议: 运行 yarn test:no-watch <test-file> 本地调试`
      );
    }

    // 覆盖率建议
    if (!result.isDiffCoveragePassed) {
      const currentCoverage = result.summary.currentDiffCoverage;
      recommendations.push(
        `Diff Coverage 未达标: ${currentCoverage}% < ${result.diffCoverageGate}%`
      );
      recommendations.push(
        `建议: 为新增代码添加单元测试以提高覆盖率`
      );
    }

    // 阶段失败建议
    const failedStages = result.stages.filter(s => s.status === 'FAILURE');
    if (failedStages.length > 0 && result.failedTests.length === 0) {
      recommendations.push(`失败的阶段: ${failedStages.map(s => s.name).join(', ')}`);
    }

    if (recommendations.length === 0) {
      recommendations.push('✅ 所有检查通过！');
    }

    return recommendations;
  }

  /**
   * 格式化诊断结果为可读文本
   */
  formatResult(result: MRDiagnosisResult): string {
    const lines: string[] = [];

    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push('📊 GitLab MR Pipeline 构建状态诊断报告');
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push('');

    // 基本信息
    lines.push(`🔗 MR URL: ${result.mrUrl}`);
    lines.push(`📦 Project: ${result.projectId}`);
    lines.push(`🔢 MR IID: ${result.mrIid}`);
    lines.push('');

    // 构建信息
    if (result.buildInfo) {
      const status = result.buildInfo.status === 'SUCCESS' ? '🟢 SUCCESS' : '🔴 FAILURE';
      lines.push(`🏗️  构建状态: ${status}`);
      lines.push(`📌 构建号: #${result.buildInfo.buildNumber}`);
      lines.push(`👤 触发者: ${result.buildInfo.triggeredBy}`);
      lines.push(`🌿 分支: ${result.buildInfo.sourceBranch} → ${result.buildInfo.targetBranch}`);
      lines.push('');
    }

    // 阶段状态
    if (result.stages.length > 0) {
      lines.push('📋 阶段状态:');
      lines.push('┌──────────────────────┬──────────┐');
      lines.push('│ 阶段                 │ 状态     │');
      lines.push('├──────────────────────┼──────────┤');
      result.stages.forEach(stage => {
        const statusIcon = this.getStatusIcon(stage.status);
        const name = stage.name.padEnd(20);
        lines.push(`│ ${name} │ ${statusIcon.padEnd(8)} │`);
      });
      lines.push('└──────────────────────┴──────────┘');
      lines.push('');
    }

    // 失败的测试 - 按文件分组显示
    if (result.failedTests.length > 0) {
      // 按文件分组
      const fileGroups = new Map<string, typeof result.failedTests>();
      result.failedTests.forEach(test => {
        const existing = fileGroups.get(test.testFile) || [];
        existing.push(test);
        fileGroups.set(test.testFile, existing);
      });

      const uniqueFiles = [...fileGroups.keys()];
      lines.push(`❌ 失败的测试 (${uniqueFiles.length} 个文件, ${result.failedTests.length} 个用例):`);

      let fileIndex = 0;
      fileGroups.forEach((tests, file) => {
        fileIndex++;
        lines.push(`  ${fileIndex}. ${file}`);
        tests.forEach(test => {
          lines.push(`     └─ ${test.testSuite} › ${test.testName}`);
          if (test.errorType && test.errorMessage) {
            lines.push(`        💥 ${test.errorType}: ${test.errorMessage}`);
          }
        });
      });
      lines.push('');
    }

    // 覆盖率统计
    if (result.coverageStats.length > 0) {
      lines.push('📈 覆盖率统计:');
      const overall = result.coverageStats.find(s => s.type === 'overall');
      if (overall) {
        const passIcon = result.isDiffCoveragePassed ? '✅' : '❌';
        lines.push(`  Diff Coverage: ${overall.diffCoverage}% ${passIcon} (阈值: ${result.diffCoverageGate}%)`);
        lines.push(`  Diff Lines: ${overall.diffLines} | Covered: ${overall.coveredDiffLines} | Uncovered: ${overall.uncoveredDiffLines}`);
        if (overall.lineCoverage) {
          lines.push(`  Line Coverage: ${overall.lineCoverage}%`);
        }
      }
      lines.push('');
    }

    // Diff Coverage 未达标文件列表
    if (!result.isDiffCoveragePassed && result.uncoveredFiles.length > 0) {
      // 判断是 Diff Coverage 还是 Overall Coverage
      const isDiffCoverage = result.uncoveredFiles.some(f => f.filePath.endsWith('.ts') || f.filePath.endsWith('.tsx'));

      if (isDiffCoverage) {
        lines.push('📁 Diff Coverage 未达标文件:');
        lines.push('   注: 以下文件的新增/修改代码覆盖率低于阈值，需要补充单元测试');
      } else {
        lines.push('📁 低覆盖率模块:');
        lines.push('   注: 以下模块整体覆盖率较低，可能需要补充单元测试');
      }
      lines.push('');
      result.uncoveredFiles.slice(0, 10).forEach((file, index) => {
        const coverageStr = `${file.coverage}%`.padStart(7);
        lines.push(`  ${index + 1}. ${file.filePath}`);
        if (file.uncoveredLines > 0) {
          lines.push(`     覆盖率: ${coverageStr} | 未覆盖: ${file.uncoveredLines} 行`);
        } else {
          lines.push(`     Diff Coverage: ${coverageStr}`);
        }
      });
      if (result.uncoveredFiles.length > 10) {
        lines.push(`  ... 还有 ${result.uncoveredFiles.length - 10} 个文件`);
      }
      lines.push('');
    }

    // 摘要
    lines.push('📊 摘要:');
    lines.push(`  阶段: ${result.summary.passedStages}/${result.summary.totalStages} 通过`);
    lines.push(`  失败测试: ${result.summary.totalFailedTests} 个`);
    lines.push(`  Diff Coverage: ${result.summary.currentDiffCoverage}%`);
    lines.push('');

    // 建议
    lines.push('💡 建议:');
    result.recommendations.forEach(rec => {
      lines.push(`  ${rec}`);
    });
    lines.push('');

    lines.push('═══════════════════════════════════════════════════════════════');

    return lines.join('\n');
  }

  private getStatusIcon(status: StageStatus['status']): string {
    switch (status) {
      case 'SUCCESS': return '✅ 通过';
      case 'FAILURE': return '❌ 失败';
      case 'SKIPPED': return '⏩ 跳过';
      case 'RUNNING': return '🔄 运行中';
      default: return '❓ 未知';
    }
  }
}

export default MRDiagnosisTool;

