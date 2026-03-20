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
        currentDiffCoverage: null,
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

    const failedUTStages = result.stages.filter(
      (stage) => this.isUTStage(stage) && stage.status === 'FAILURE'
    );
    const diffCoverageStage = this.findDiffCoverageStage(result.stages);

    if (diffCoverageStage?.status === 'SUCCESS') {
      result.isDiffCoveragePassed = true;
    } else if (diffCoverageStage?.status === 'FAILURE') {
      result.isDiffCoveragePassed = false;
    }

    // Step 4: 只有 UT stage 失败时才获取 Console Log 解析失败用例
    if (failedUTStages.length > 0 && buildInfo.consoleLogUrl) {
      let consoleLog = '';
      try {
        consoleLog = await this.jenkinsService.getConsoleLog(
          buildInfo.consoleLogUrl
        );
      } catch (error) {
        result.recommendations.push(`无法获取 Console Log: ${error}`);
      }

      if (consoleLog) {
        const logAnalysis = this.consoleLogParser.parseAll(consoleLog);
        result.failedTests = logAnalysis.failedTests;
      }
    }

    // Step 5: 只有 diffcoverage stage 失败时才解析 Coverage artifact 明细
    if (diffCoverageStage?.status === 'FAILURE' && buildInfo.consoleLogUrl) {
      try {
        const buildUrl = buildInfo.consoleLogUrl.replace('/consoleText', '');
        const artifactUrl = `${buildUrl}/artifact/coverage/Overall-Diff-Coverage-Report.html`;

        const coverageData = await this.jenkinsService.getCoverageData(
          buildUrl,
          this.config.diffCoverageGate
        );

        if (coverageData.stats) {
          result.coverageStats = [{
            type: 'overall',
            diffLines: coverageData.stats.diffLines,
            coveredDiffLines: coverageData.stats.coveredDiffLines,
            uncoveredDiffLines: coverageData.stats.uncoveredDiffLines,
            diffCoverage: coverageData.stats.diffCoverage,
            overallCoverage: coverageData.stats.overallCoverage,
          }];
        } else {
          result.recommendations.push(
            '⚠️ Diff Coverage stage 失败，但无法从 Coverage Report 中提取统计数据'
          );
          result.recommendations.push(
            `💡 请手动查看: ${artifactUrl}`
          );
        }

        result.uncoveredFiles = coverageData.uncoveredFiles;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const buildUrl = buildInfo.consoleLogUrl.replace('/consoleText', '');
        const artifactUrl = `${buildUrl}/artifact/coverage/Overall-Diff-Coverage-Report.html`;

        result.recommendations.push(
          `⚠️ Diff Coverage stage 失败，但无法获取 Coverage 详细数据: ${errorMsg}`
        );
        result.recommendations.push(
          `💡 请手动查看 Coverage Report: ${artifactUrl}`
        );

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
    result.recommendations = [
      ...result.recommendations,
      ...this.generateRecommendations(result),
    ];

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
    const currentDiffCoverage = overallCoverage?.diffCoverage ?? null;

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
      const uniqueFiles = [...new Set(result.failedTests.map(t => t.testFile))];
      recommendations.push(
        `🔴 ${result.failedTests.length} 个测试失败 (${uniqueFiles.length} 个文件)`
      );
      uniqueFiles.forEach((file, index) => {
        recommendations.push(`  ${index + 1}. ${file}`);
      });
      recommendations.push(`💡 运行: yarn test:no-watch <file>`);
    }

    // Coverage 建议
    if (!result.isDiffCoveragePassed) {
      const currentCoverage = result.summary.currentDiffCoverage;
      const gate = result.diffCoverageGate;

      if (currentCoverage !== null) {
        const gap = (gate - currentCoverage).toFixed(2);
        recommendations.push(
          `🟡 Coverage 不足: ${currentCoverage}% < ${gate}% (差 ${gap}%)`
        );

        // 列出未覆盖文件
        if (result.uncoveredFiles.length > 0) {
          const overallStats = result.coverageStats.find(s => s.type === 'overall');
          const uncoveredLines = overallStats?.uncoveredDiffLines || 0;

          recommendations.push(
            `  需覆盖 ${uncoveredLines} 行代码 (${result.uncoveredFiles.length} 个文件):`
          );
          result.uncoveredFiles.forEach((file, index) => {
            recommendations.push(`  ${index + 1}. ${file.filePath} (${file.coverage}%)`);
          });
        }
      } else {
        recommendations.push('🟡 Coverage 未通过 (详情见 Pipeline)');
      }
    }

    // 其他失败阶段
    const failedStages = result.stages.filter(s => s.status === 'FAILURE');
    const nonTestStages = failedStages.filter(s =>
      !this.isUTStage(s) && s.name !== 'diffcoverage'
    );
    if (nonTestStages.length > 0) {
      recommendations.push(
        `🔴 其他失败: ${nonTestStages.map(s => s.name).join(', ')}`
      );
    }

    if (recommendations.length === 0) {
      recommendations.push('✅ 所有检查通过');
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
    const diffCoverageStage = this.findDiffCoverageStage(result.stages);
    if (diffCoverageStage) {
      lines.push('📈 Coverage:');

      if (result.coverageStats.length > 0) {
        // Coverage 失败，显示详细数据
        const overall = result.coverageStats.find(s => s.type === 'overall');
        if (overall) {
          const gate = result.diffCoverageGate;
          const gap = (gate - overall.diffCoverage).toFixed(2);
          lines.push(`  ❌ Diff Coverage: ${overall.diffCoverage}% (要求 ≥ ${gate}%, 差 ${gap}%)`);
          lines.push(`  📊 Diff Lines: ${overall.diffLines} 行 (覆盖 ${overall.coveredDiffLines}, 未覆盖 ${overall.uncoveredDiffLines})`);
          lines.push(`  📊 Overall Coverage: ${overall.overallCoverage}%`);
        }
      } else if (diffCoverageStage.status === 'SUCCESS') {
        // Coverage 通过，简洁显示
        lines.push(`  ✅ Diff Coverage: 通过 (≥ ${result.diffCoverageGate}%)`);
      } else {
        // Coverage 失败但无详细数据
        lines.push(`  ❌ Diff Coverage: 未通过`);
      }
      lines.push('');
    }

    // 未达标文件列表
    if (!result.isDiffCoveragePassed && result.uncoveredFiles.length > 0) {
      lines.push(`📁 未覆盖文件 (${result.uncoveredFiles.length} 个):`);
      result.uncoveredFiles.slice(0, 10).forEach((file, index) => {
        lines.push(`  ${index + 1}. ${file.filePath} (${file.coverage}%)`);
      });
      if (result.uncoveredFiles.length > 10) {
        lines.push(`  ... 还有 ${result.uncoveredFiles.length - 10} 个`);
      }
      lines.push('');
    }

    // 摘要
    lines.push('📊 摘要:');
    lines.push(`  总阶段: ${result.summary.totalStages} (通过 ${result.summary.passedStages}, 失败 ${result.summary.failedStages}, 跳过 ${result.summary.skippedStages})`);
    if (result.summary.totalFailedTests > 0) {
      lines.push(`  失败测试: ${result.summary.totalFailedTests} 个`);
    }
    if (result.summary.currentDiffCoverage !== null) {
      lines.push(`  Diff Coverage: ${result.summary.currentDiffCoverage}%`);
    }
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

  private isUTStage(stage: StageStatus): boolean {
    const name = stage.name.toLowerCase();
    return name.includes(' ut') || name === 'ut';
  }

  private findDiffCoverageStage(stages: StageStatus[]): StageStatus | undefined {
    return stages.find((stage) =>
      stage.name.toLowerCase().includes('diffcoverage')
    );
  }
}

export default MRDiagnosisTool;
