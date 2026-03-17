import { FailedTestCase } from '../types';
import {
  REGEX_FAIL_PATTERN,
  REGEX_TEST_NAME,
  REGEX_ERROR_PATTERN,
  REGEX_TEST_SUMMARY,
  FAILED_TEST_SEARCH_RANGE,
  TEST_CONTEXT_RANGE,
  MAX_ERROR_MESSAGE_LENGTH,
  MAX_TEST_NAME_LENGTH,
  ERROR_CONTEXT_RANGE,
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

    // 重置正则的 lastIndex
    const failPattern = new RegExp(REGEX_FAIL_PATTERN.source, 'g');
    let match;

    while ((match = failPattern.exec(log)) !== null) {
      const testFile = match[1];

      // 提取上下文日志 - 优化：限制到下一个 FAIL 标记之前，避免跨文件污染
      const startIndex = match.index;

      // 查找下一个 FAIL 标记的位置（从当前位置之后开始搜索）
      const searchStart = startIndex + 10; // 跳过当前的 "FAIL" 字符串
      const nextFailIndex = log.indexOf('FAIL', searchStart);

      // 计算上下文结束位置：取 (下一个FAIL位置) 和 (固定范围) 中的较小值
      let endIndex: number;
      if (nextFailIndex > 0 && nextFailIndex > startIndex) {
        // 如果找到下一个 FAIL，限制到它之前
        endIndex = Math.min(nextFailIndex, startIndex + FAILED_TEST_SEARCH_RANGE);
      } else {
        // 如果没有下一个 FAIL，使用固定范围
        endIndex = Math.min(startIndex + FAILED_TEST_SEARCH_RANGE, log.length);
      }

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
   * ⚠️ 注意：Coverage 数据现在从 HTML Report 获取，此方法只解析 UT 失败
   * @param log - Jenkins Console Log 内容
   */
  parseAll(log: string): {
    failedTests: FailedTestCase[];
    testSummary: { passed: number; failed: number; skipped: number } | null;
  } {
    const failedTests = this.parseFailedTests(log);
    const testSummary = this.parseTestSummary(log);

    return {
      failedTests,
      testSummary,
    };
  }
}

export default ConsoleLogParser;

