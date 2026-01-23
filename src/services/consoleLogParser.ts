import { FailedTestCase, CoverageStats, UncoveredFile } from '../types';
import {
  REGEX_FAIL_PATTERN,
  REGEX_TEST_NAME,
  REGEX_ERROR_PATTERN,
  REGEX_OVERALL_DIFF_COVERAGE,
  REGEX_OVERALL_COVERAGE,
  REGEX_PHONE_DIFF_COVERAGE,
  REGEX_TEST_SUMMARY,
  FAILED_TEST_SEARCH_RANGE,
  TEST_CONTEXT_RANGE,
  MAX_ERROR_MESSAGE_LENGTH,
  MAX_TEST_NAME_LENGTH,
  ERROR_CONTEXT_RANGE,
  DEFAULT_DIFF_COVERAGE_GATE,
} from '../constants';

/**
 * Console Log 解析器
 * 解析 Jenkins 构建日志中的测试和覆盖率信息
 */
export class ConsoleLogParser {
  /**
   * 解析失败的测试用例
   * @param log - Jenkins Console Log 内容
   * @returns 失败的测试用例列表
   */
  parseFailedTests(log: string): FailedTestCase[] {
    const failedTests: FailedTestCase[] = [];
    const seenTests = new Set<string>();
    const seenFiles = new Set<string>();

    // 重置正则的 lastIndex
    const failPattern = new RegExp(REGEX_FAIL_PATTERN.source, 'g');
    let match;

    while ((match = failPattern.exec(log)) !== null) {
      const testFile = match[1];

      // 跳过已处理的文件
      if (seenFiles.has(testFile)) {
        continue;
      }
      seenFiles.add(testFile);

      // 提取上下文日志
      const startIndex = match.index;
      const endIndex = Math.min(startIndex + FAILED_TEST_SEARCH_RANGE, log.length);
      const contextLog = log.substring(startIndex, endIndex);

      // 解析测试用例
      const testNamePattern = new RegExp(REGEX_TEST_NAME.source, 'g');
      let testMatch;
      let foundTests = false;

      while ((testMatch = testNamePattern.exec(contextLog)) !== null) {
        const fullTestPath = testMatch[1].trim();
        const parts = fullTestPath.split(/\s*›\s*/);
        if (parts.length < 2) continue;

        foundTests = true;
        const testName = parts.pop()!.trim();
        const testSuite = parts.join(' › ').trim();

        // 提取错误信息
        const testContext = contextLog.substring(testMatch.index, testMatch.index + TEST_CONTEXT_RANGE);
        const errorMatch = REGEX_ERROR_PATTERN.exec(testContext);

        const testCase: FailedTestCase = {
          testFile,
          testSuite,
          testName,
          errorType: errorMatch ? errorMatch[1] : undefined,
          errorMessage: errorMatch ? errorMatch[2].trim().substring(0, MAX_ERROR_MESSAGE_LENGTH) : undefined,
        };

        // 去重
        const key = `${testCase.testFile}|${testCase.testSuite}|${testCase.testName}`;
        if (!seenTests.has(key)) {
          seenTests.add(key);
          failedTests.push(testCase);
        }
      }

      // 处理未找到具体测试用例的情况
      if (!foundTests) {
        const errorMatch = REGEX_ERROR_PATTERN.exec(contextLog);
        const testCase = this.createFallbackTestCase(testFile, errorMatch);

        const key = `${testCase.testFile}|${testCase.testSuite}|${testCase.testName}`;
        if (!seenTests.has(key)) {
          seenTests.add(key);
          failedTests.push(testCase);
        }
      }
    }

    return failedTests;
  }

  /**
   * 创建回退测试用例（当无法解析具体测试名称时）
   */
  private createFallbackTestCase(testFile: string, errorMatch: RegExpExecArray | null): FailedTestCase {
    if (errorMatch) {
      return {
        testFile,
        testSuite: 'Test Initialization',
        testName: `${errorMatch[1]}: ${errorMatch[2].trim().substring(0, MAX_TEST_NAME_LENGTH)}`,
        errorType: errorMatch[1],
        errorMessage: errorMatch[2].trim().substring(0, MAX_ERROR_MESSAGE_LENGTH),
      };
    }
    return {
      testFile,
      testSuite: 'Unknown',
      testName: 'Unknown',
    };
  }

  /**
   * 解析覆盖率统计
   * @param log - Jenkins Console Log 内容
   * @returns 覆盖率统计列表
   */
  parseCoverageStats(log: string): CoverageStats[] {
    const stats: CoverageStats[] = [];

    const overallCoverageMatch = log.match(REGEX_OVERALL_COVERAGE);
    const overallDiffMatch = log.match(REGEX_OVERALL_DIFF_COVERAGE);

    if (overallDiffMatch) {
      stats.push({
        type: 'overall',
        diffLines: parseInt(overallDiffMatch[1], 10),
        coveredDiffLines: parseInt(overallDiffMatch[2], 10),
        uncoveredDiffLines: parseInt(overallDiffMatch[3], 10),
        diffCoverage: parseFloat(overallDiffMatch[4]),
        overallCoverage: parseFloat(overallDiffMatch[5]),
        lineCoverage: overallCoverageMatch ? parseFloat(overallCoverageMatch[1]) : undefined,
        branchCoverage: overallCoverageMatch ? parseFloat(overallCoverageMatch[2]) : undefined,
        statementCoverage: overallCoverageMatch ? parseFloat(overallCoverageMatch[3]) : undefined,
        functionCoverage: overallCoverageMatch ? parseFloat(overallCoverageMatch[4]) : undefined,
      });
    }

    const phoneDiffMatch = log.match(REGEX_PHONE_DIFF_COVERAGE);
    if (phoneDiffMatch) {
      stats.push({
        type: 'phone',
        diffLines: parseInt(phoneDiffMatch[1], 10),
        coveredDiffLines: parseInt(phoneDiffMatch[2], 10),
        uncoveredDiffLines: parseInt(phoneDiffMatch[3], 10),
        diffCoverage: parseFloat(phoneDiffMatch[4]),
        overallCoverage: parseFloat(phoneDiffMatch[5]),
      });
    }

    return stats;
  }

  /**
   * 解析未覆盖的文件列表
   * 从 Console Log 中提取未覆盖的文件信息
   * @param log - Jenkins Console Log 内容
   */
  parseUncoveredFiles(log: string): UncoveredFile[] {
    const files: UncoveredFile[] = [];

    // 匹配格式: "Uncovered files:" 或 "Files with low coverage:" 后的表格
    // 典型格式:
    // | File | Coverage | Uncovered Lines |
    // | project/xxx/file.ts | 50% | 10 |

    // 方法1: 匹配表格格式
    const tablePattern = /\|\s*(project\/[^\s|]+)\s*\|\s*([\d.]+)%?\s*\|\s*(\d+)\s*\|/g;
    let tableMatch: RegExpExecArray | null;

    while ((tableMatch = tablePattern.exec(log)) !== null) {
      const coverage = parseFloat(tableMatch[2]);
      const uncoveredLines = parseInt(tableMatch[3], 10);

      // 只收集覆盖率低于 100% 的文件
      if (coverage < 100 && uncoveredLines > 0) {
        files.push({
          filePath: tableMatch[1],
          coverage,
          uncoveredLines,
        });
      }
    }

    // 方法2: 匹配 "file.ts: 80% (uncovered: 10-15, 20)" 格式
    const inlinePattern = /(project\/[^\s:]+\.tsx?)[:\s]+([\d.]+)%[^(]*\(uncovered[:\s]*([^)]+)\)/gi;
    let inlineMatch: RegExpExecArray | null;

    while ((inlineMatch = inlinePattern.exec(log)) !== null) {
      const filePath = inlineMatch[1];
      const coverage = parseFloat(inlineMatch[2]);
      const lineNumbers = inlineMatch[3].trim();

      // 计算未覆盖行数
      let uncoveredLines = 0;
      const parts = lineNumbers.split(',');
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.includes('-')) {
          const [start, end] = trimmed.split('-').map(n => parseInt(n.trim(), 10));
          uncoveredLines += (end - start + 1);
        } else if (trimmed) {
          uncoveredLines += 1;
        }
      }

      if (!files.some(f => f.filePath === filePath)) {
        files.push({
          filePath,
          coverage,
          uncoveredLines,
          lineNumbers,
        });
      }
    }

    // 方法3: 匹配 Coverage Report 中的文件路径和未覆盖信息
    // 格式: "project/xxx/file.ts | 85.5% | Lines: 10, 15-20, 30"
    const reportPattern = /(project\/[^\s|]+\.tsx?)\s*\|\s*([\d.]+)%\s*\|\s*(?:Lines?[:\s]*)?([\d,\s\-]+)/gi;
    let reportMatch: RegExpExecArray | null;

    while ((reportMatch = reportPattern.exec(log)) !== null) {
      const filePath = reportMatch[1];
      const coverage = parseFloat(reportMatch[2]);
      const lineNumbers = reportMatch[3].trim();

      // 计算未覆盖行数
      let uncoveredLines = 0;
      const parts = lineNumbers.split(',');
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.includes('-')) {
          const [start, end] = trimmed.split('-').map(n => parseInt(n.trim(), 10));
          if (!isNaN(start) && !isNaN(end)) {
            uncoveredLines += (end - start + 1);
          }
        } else if (trimmed && !isNaN(parseInt(trimmed, 10))) {
          uncoveredLines += 1;
        }
      }

      if (!files.some(f => f.filePath === filePath) && uncoveredLines > 0) {
        files.push({
          filePath,
          coverage,
          uncoveredLines,
          lineNumbers,
        });
      }
    }

    // 按覆盖率排序 (低覆盖率在前)
    files.sort((a, b) => a.coverage - b.coverage);

    return files;
  }

  /**
   * 检查 Diff Coverage 是否达标
   * @param stats - 覆盖率统计列表
   * @param gate - 覆盖率阈值
   */
  isDiffCoveragePassed(stats: CoverageStats[], gate: number = DEFAULT_DIFF_COVERAGE_GATE): boolean {
    const overallStats = stats.find(s => s.type === 'overall');
    if (!overallStats) {
      return true;
    }
    return overallStats.diffCoverage >= gate;
  }

  /**
   * 获取当前 Diff Coverage 值
   */
  getCurrentDiffCoverage(stats: CoverageStats[]): number {
    const overallStats = stats.find(s => s.type === 'overall');
    return overallStats?.diffCoverage ?? 0;
  }

  /**
   * 解析测试统计摘要
   */
  parseTestSummary(log: string): { passed: number; failed: number; skipped: number } | null {
    const summaryMatch = log.match(REGEX_TEST_SUMMARY);
    if (summaryMatch) {
      return {
        failed: parseInt(summaryMatch[1], 10),
        skipped: parseInt(summaryMatch[2], 10),
        passed: parseInt(summaryMatch[3], 10),
      };
    }
    return null;
  }

  /**
   * 解析错误详情
   */
  parseErrorDetails(log: string, testFile: string): string | null {
    const fileIndex = log.indexOf(testFile);
    if (fileIndex === -1) return null;

    const contextStart = fileIndex;
    const contextEnd = Math.min(fileIndex + ERROR_CONTEXT_RANGE, log.length);
    const context = log.substring(contextStart, contextEnd);

    const expectMatch = context.match(/expect\(([^)]+)\)[.\s\S]*?(Expected|Received)[:\s]*([\s\S]*?)(?=\n\s*\n|\nat\s)/i);
    if (expectMatch) {
      return expectMatch[0].trim().substring(0, TEST_CONTEXT_RANGE);
    }

    return null;
  }

  /**
   * 综合解析 Console Log
   * @param log - Jenkins Console Log 内容
   * @param diffCoverageGate - Diff Coverage 阈值
   */
  parseAll(log: string, diffCoverageGate: number = DEFAULT_DIFF_COVERAGE_GATE): {
    failedTests: FailedTestCase[];
    coverageStats: CoverageStats[];
    uncoveredFiles: UncoveredFile[];
    isDiffCoveragePassed: boolean;
    testSummary: { passed: number; failed: number; skipped: number } | null;
  } {
    const failedTests = this.parseFailedTests(log);
    const coverageStats = this.parseCoverageStats(log);
    const uncoveredFiles = this.parseUncoveredFiles(log);
    const isDiffCoveragePassed = this.isDiffCoveragePassed(coverageStats, diffCoverageGate);
    const testSummary = this.parseTestSummary(log);

    return {
      failedTests,
      coverageStats,
      uncoveredFiles,
      isDiffCoveragePassed,
      testSummary,
    };
  }
}

export default ConsoleLogParser;

