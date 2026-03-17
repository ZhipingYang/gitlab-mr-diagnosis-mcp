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
   * 只使用 artifact/coverage/Overall-Diff-Coverage-Report.html 路径
   * 这个路径同时包含统计数据和文件列表
   * @param buildUrl - 构建 URL
   */
  async getCoverageReportHtml(buildUrl: string): Promise<string> {
    const cleanUrl = buildUrl
      .replace('/display/redirect', '')
      .replace('/console', '')
      .replace('/consoleText', '')
      .replace(/\/$/, '');

    // 使用推荐的 artifact 路径
    const artifactUrl = `${cleanUrl}/artifact/coverage/Overall-Diff-Coverage-Report.html`;

    const response = await fetch(artifactUrl, {
      method: 'GET',
      headers: { 'Accept': 'text/html' },
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

    // 提取文件路径和覆盖率
    // 注意：路径格式为 /home/jenkins-lab/.../Fiji/project/xxx 或 /home/jenkins-lab/.../project/xxx
    const filePattern = /<li class="d2h-file-diff-coverage-line">[\s\S]*?project\/([^<\s]+)[\s\S]*?<span class="d2h-file-diff-coverage-rate">([\d.]+)%<\/span>/g;

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
   * 从 HTML Report 提取覆盖率统计数据（备用方案）
   * @param html - Coverage Report HTML 内容
   */
  private extractCoverageStatsFromHtml(html: string): { diffCoverage: number; overallCoverage: number } | null {
    // 从新格式的 HTML 中提取统计数据
    // 格式示例: "Diff statement lines coverage: 100% (0/0)"
    //          "Overall statement lines coverage: 61.3341% (4478/7301)"
    const diffMatch = html.match(/Diff statement lines coverage:\s*([\d.]+)%/i);
    const overallMatch = html.match(/Overall statement lines coverage:\s*([\d.]+)%/i);

    if (diffMatch || overallMatch) {
      return {
        diffCoverage: diffMatch ? parseFloat(diffMatch[1]) : 0,
        overallCoverage: overallMatch ? parseFloat(overallMatch[1]) : 0,
      };
    }

    return null;
  }

  /**
   * 获取完整的 Coverage 数据（统计 + 文件列表）
   * 只使用 artifact/coverage/Overall-Diff-Coverage-Report.html 作为唯一数据源
   * @param buildUrl - 构建 URL
   * @param coverageThreshold - 覆盖率阈值 (默认 90)
   */
  async getCoverageData(
    buildUrl: string,
    coverageThreshold: number = 90
  ): Promise<{
    stats: { diffCoverage: number; overallCoverage: number } | null;
    uncoveredFiles: UncoveredFile[];
    isDiffCoveragePassed: boolean;
  }> {
    let stats: { diffCoverage: number; overallCoverage: number } | null = null;
    let uncoveredFiles: UncoveredFile[] = [];

    try {
      // 从 artifact HTML 获取所有数据
      const html = await this.getCoverageReportHtml(buildUrl);

      // 提取统计数据
      stats = this.extractCoverageStatsFromHtml(html);

      // 提取未覆盖文件列表
      uncoveredFiles = this.parseDiffCoverageReportHtml(html, coverageThreshold);
    } catch (error) {
      console.error('Failed to get coverage data from artifact HTML:', error);
    }

    // ⚠️ Coverage Gate 逻辑：只要有一个文件的 Diff Coverage < 阈值，就判定为失败
    const isDiffCoveragePassed = uncoveredFiles.length === 0;

    return {
      stats,
      uncoveredFiles,
      isDiffCoveragePassed,
    };
  }

  /**
   * @deprecated 使用 getCoverageData 替代
   * 获取并解析 Diff Coverage Report，返回未达标的文件列表
   * @param buildUrl - 构建 URL
   * @param coverageThreshold - 覆盖率阈值 (默认 90)
   */
  async getUncoveredFiles(buildUrl: string, coverageThreshold: number = 90): Promise<UncoveredFile[]> {
    try {
      const html = await this.getCoverageReportHtml(buildUrl);
      return this.parseDiffCoverageReportHtml(html, coverageThreshold);
    } catch (error) {
      console.error('Failed to get uncovered files:', error);
      return [];
    }
  }
}

export default JenkinsService;

