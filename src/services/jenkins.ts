import { JENKINS_BASE_URL, JENKINS_JOB_PATH } from '../constants';
import { UncoveredFile } from '../types';

/**
 * Jenkins 服务
 * 用于获取 Jenkins 构建日志和 Coverage Report
 */
export class JenkinsService {
  /**
   * 获取 Console Log
   * @param consoleLogUrl - Console Log URL (以 /consoleText 结尾)
   */
  async getConsoleLog(consoleLogUrl: string): Promise<string> {
    const response = await fetch(consoleLogUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/plain',
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch console log: ${response.status} ${response.statusText}`
      );
    }

    return response.text();
  }

  /**
   * 从构建 URL 构造 Console Log URL
   */
  buildConsoleLogUrl(buildUrl: string): string {
    const cleanUrl = buildUrl
      .replace('/display/redirect', '')
      .replace('/console', '')
      .replace(/\/$/, '');

    return `${cleanUrl}/consoleText`;
  }

  /**
   * 从构建号构造 URL
   */
  buildUrlFromNumber(buildNumber: number): string {
    return `${JENKINS_BASE_URL}${JENKINS_JOB_PATH}/${buildNumber}`;
  }

  /**
   * 获取构建的 Console Log（通过构建号）
   */
  async getConsoleLogByBuildNumber(buildNumber: number): Promise<string> {
    const buildUrl = this.buildUrlFromNumber(buildNumber);
    const consoleLogUrl = this.buildConsoleLogUrl(buildUrl);
    return this.getConsoleLog(consoleLogUrl);
  }

  /**
   * 获取 Coverage Report HTML
   * @param buildUrl - 构建 URL
   * @param reportType - 报告类型 (Overall_Diff_Coverage, Overall_Coverage, Phone_Diff_Coverage 等)
   * @param isDiffReport - 是否是 Diff Coverage 报告
   */
  async getCoverageReportHtml(
    buildUrl: string,
    reportType: string = 'Overall',
    isDiffReport: boolean = false
  ): Promise<string> {
    const cleanUrl = buildUrl
      .replace('/display/redirect', '')
      .replace('/console', '')
      .replace('/consoleText', '')
      .replace(/\/$/, '');

    // Diff Coverage Report 路径: Overall_20Diff_20Coverage_20Report/Overall-Diff-Coverage-Report.html
    // Overall Coverage Report 路径: Overall_20Coverage_20Report/index.html
    const reportName = isDiffReport
      ? `${reportType}_20Diff_20Coverage_20Report`
      : `${reportType}_20Coverage_20Report`;
    const fileName = isDiffReport ? `${reportType}-Diff-Coverage-Report.html` : 'index.html';
    const reportUrl = `${cleanUrl}/${reportName}/${fileName}`;

    const response = await fetch(reportUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/html',
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch coverage report: ${response.status} ${response.statusText}`
      );
    }

    return response.text();
  }

  /**
   * 从 Overall Coverage Report HTML 解析未覆盖的文件/目录列表 (整体覆盖率)
   * @param html - Coverage Report HTML 内容
   * @param coverageThreshold - 覆盖率阈值 (默认 90)
   */
  parseOverallCoverageReportHtml(html: string, coverageThreshold: number = 90): UncoveredFile[] {
    const files: UncoveredFile[] = [];

    // lcov-report 的表格格式
    const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;

    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowPattern.exec(html)) !== null) {
      const rowHtml = rowMatch[1];

      const fileMatch = rowHtml.match(/<td[^>]*class="file[^"]*"[^>]*data-value="([^"]+)"[^>]*>/i);
      if (!fileMatch) continue;

      const fileName = fileMatch[1];

      const percentPattern = /<td[^>]*data-value="([\d.]+)"[^>]*class="pct[^"]*"[^>]*>/gi;
      const percentages: number[] = [];

      let percentMatch: RegExpExecArray | null;
      while ((percentMatch = percentPattern.exec(rowHtml)) !== null) {
        percentages.push(parseFloat(percentMatch[1]));
      }

      if (percentages.length >= 4) {
        const lineCoverage = percentages[percentages.length - 1];

        if (lineCoverage < coverageThreshold) {
          const fractionPattern = /<td[^>]*class="abs[^"]*"[^>]*>([\d]+)\/([\d]+)<\/td>/gi;
          let totalLines = 0;
          let coveredLines = 0;
          let fractionMatch: RegExpExecArray | null;

          while ((fractionMatch = fractionPattern.exec(rowHtml)) !== null) {
            coveredLines = parseInt(fractionMatch[1], 10);
            totalLines = parseInt(fractionMatch[2], 10);
          }

          const uncoveredLines = totalLines - coveredLines;

          files.push({
            filePath: fileName,
            coverage: lineCoverage,
            uncoveredLines: uncoveredLines > 0 ? uncoveredLines : 0,
          });
        }
      }
    }

    files.sort((a, b) => a.coverage - b.coverage);
    return files;
  }

  /**
   * 从 Diff Coverage Report HTML 解析未达标的文件列表 (Diff Coverage)
   * @param html - Diff Coverage Report HTML 内容
   * @param coverageThreshold - 覆盖率阈值 (默认 90)
   */
  parseDiffCoverageReportHtml(html: string, coverageThreshold: number = 90): UncoveredFile[] {
    const files: UncoveredFile[] = [];

    // Diff Coverage Report 格式:
    // "Files diff coverage" 后面跟着文件列表
    // /path/to/file.ts
    // 100.00%
    // /path/to/another/file.ts
    // 89.19%

    // 提取文件路径和覆盖率的模式
    // 文件路径格式: /home/jenkins-lab/workspace/.../project/xxx/file.ts
    const filePattern = /\/home\/jenkins[^"'\s]+\/project\/([^"'\s]+\.tsx?)\s*[\s\S]*?([\d.]+)%/g;

    let match: RegExpExecArray | null;
    while ((match = filePattern.exec(html)) !== null) {
      const filePath = `project/${match[1]}`;
      const coverage = parseFloat(match[2]);

      if (coverage < coverageThreshold) {
        files.push({
          filePath,
          coverage,
          uncoveredLines: 0, // Diff report 不提供行数
        });
      }
    }

    files.sort((a, b) => a.coverage - b.coverage);
    return files;
  }

  /**
   * 获取并解析 Diff Coverage Report，返回未达标的文件列表
   * 优先使用 Diff Coverage Report (更精确)，如果失败则回退到 Overall Coverage Report
   * @param buildUrl - 构建 URL
   * @param coverageThreshold - 覆盖率阈值 (默认 90)
   */
  async getUncoveredFiles(buildUrl: string, coverageThreshold: number = 90): Promise<UncoveredFile[]> {
    // 优先尝试获取 Diff Coverage Report
    try {
      const diffHtml = await this.getCoverageReportHtml(buildUrl, 'Overall', true);
      const diffFiles = this.parseDiffCoverageReportHtml(diffHtml, coverageThreshold);
      if (diffFiles.length > 0) {
        return diffFiles;
      }
    } catch (error) {
      // Diff Coverage Report 不可用，尝试 Overall Coverage Report
      console.log('Diff Coverage Report not available, falling back to Overall Coverage Report');
    }

    // 回退到 Overall Coverage Report
    try {
      const html = await this.getCoverageReportHtml(buildUrl, 'Overall', false);
      return this.parseOverallCoverageReportHtml(html, coverageThreshold);
    } catch (error) {
      console.error('Failed to get uncovered files:', error);
      return [];
    }
  }
}

export default JenkinsService;

