/**
 * 批量测试脚本 - 验证 MR 诊断功能的适配性
 */

import { MRDiagnosisTool } from './tools/diagnose';
import { loadDiagnosisConfig, validateConfig } from './utils/config';
import { BATCH_REQUEST_DELAY, DEFAULT_GITLAB_BASE_URL } from './constants';

/** 批量测试结果 */
interface BatchResult {
  mrIid: number;
  status: 'success' | 'error' | 'no_build' | 'build_only';
  buildStatus?: string;
  failedTests: number;
  hasUTFailure: boolean;
  hasCoverageFailure: boolean;
  diffCoverage: number;
  failedTestFiles: string[];
  errorMessage?: string;
}

async function batchTest(startMR: number, endMR: number) {
  const config = loadDiagnosisConfig();
  const validation = validateConfig(config);

  if (!validation.valid) {
    console.error('❌ 配置错误:');
    validation.errors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  }

  const tool = new MRDiagnosisTool(config);
  const results: BatchResult[] = [];
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`🔍 批量测试 MR #${startMR} 到 #${endMR}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  for (let mrIid = startMR; mrIid >= endMR; mrIid--) {
    const mrUrl = `${DEFAULT_GITLAB_BASE_URL}/Fiji/Fiji/-/merge_requests/${mrIid}`;
    process.stdout.write(`测试 MR #${mrIid}... `);

    try {
      const result = await tool.diagnose(mrUrl);
      
      // 判断状态
      let status: BatchResult['status'] = 'success';
      if (!result.buildInfo) {
        status = 'no_build';
      } else if (result.stages.length <= 5 && !result.stages.some(s => s.name.toLowerCase().includes(' ut'))) {
        status = 'build_only';
      }

      const batchResult: BatchResult = {
        mrIid,
        status,
        buildStatus: result.buildInfo?.status,
        failedTests: result.failedTests.length,
        hasUTFailure: result.failedTests.length > 0,
        hasCoverageFailure: !result.isDiffCoveragePassed,
        diffCoverage: result.summary.currentDiffCoverage,
        failedTestFiles: [...new Set(result.failedTests.map(t => t.testFile))],
      };

      results.push(batchResult);
      
      // 输出简短状态
      if (status === 'no_build') {
        console.log('⚪ 无构建');
      } else if (status === 'build_only') {
        console.log('🟡 build-only');
      } else if (batchResult.hasUTFailure || batchResult.hasCoverageFailure) {
        console.log(`🔴 失败 (UT: ${batchResult.failedTests}, Coverage: ${batchResult.diffCoverage}%)`);
      } else {
        console.log('🟢 通过');
      }

    } catch (error: any) {
      results.push({
        mrIid,
        status: 'error',
        failedTests: 0,
        hasUTFailure: false,
        hasCoverageFailure: false,
        diffCoverage: 0,
        failedTestFiles: [],
        errorMessage: error.message,
      });
      console.log(`❌ 错误: ${error.message?.substring(0, 50)}`);
    }

    // 添加小延迟避免请求过快
    await new Promise(resolve => setTimeout(resolve, BATCH_REQUEST_DELAY));
  }

  // 生成汇总报告
  generateReport(results);
}

function generateReport(results: BatchResult[]) {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('📊 批量测试汇总报告');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 统计
  const total = results.length;
  const passed = results.filter(r => r.status === 'success' && !r.hasUTFailure && !r.hasCoverageFailure).length;
  const utFailed = results.filter(r => r.hasUTFailure).length;
  const coverageFailed = results.filter(r => r.hasCoverageFailure).length;
  const buildOnly = results.filter(r => r.status === 'build_only').length;
  const noBuild = results.filter(r => r.status === 'no_build').length;
  const errors = results.filter(r => r.status === 'error').length;

  console.log('📈 统计:');
  console.log(`  总计: ${total} 个 MR`);
  console.log(`  🟢 通过: ${passed}`);
  console.log(`  🔴 UT 失败: ${utFailed}`);
  console.log(`  🔴 Coverage 未达标: ${coverageFailed}`);
  console.log(`  🟡 Build-only: ${buildOnly}`);
  console.log(`  ⚪ 无构建: ${noBuild}`);
  console.log(`  ❌ 错误: ${errors}`);

  // UT 失败的文件汇总
  const allFailedFiles = new Map<string, number>();
  results.forEach(r => {
    r.failedTestFiles.forEach(file => {
      allFailedFiles.set(file, (allFailedFiles.get(file) || 0) + 1);
    });
  });

  if (allFailedFiles.size > 0) {
    console.log('\n❌ UT 失败文件汇总 (按出现次数排序):');
    const sorted = [...allFailedFiles.entries()].sort((a, b) => b[1] - a[1]);
    sorted.forEach(([file, count], i) => {
      console.log(`  ${i + 1}. [${count}次] ${file}`);
    });
  }

  // Coverage 未达标的 MR
  const lowCoverage = results.filter(r => r.hasCoverageFailure && r.diffCoverage > 0);
  if (lowCoverage.length > 0) {
    console.log('\n📉 Coverage 未达标的 MR:');
    lowCoverage.forEach(r => {
      console.log(`  MR #${r.mrIid}: ${r.diffCoverage}%`);
    });
  }

  // 错误的 MR
  const errorMRs = results.filter(r => r.status === 'error');
  if (errorMRs.length > 0) {
    console.log('\n⚠️ 解析错误的 MR:');
    errorMRs.forEach(r => {
      console.log(`  MR #${r.mrIid}: ${r.errorMessage}`);
    });
  }
}

// 解析命令行参数
const startMR = parseInt(process.argv[2] || '41711', 10);
const endMR = parseInt(process.argv[3] || '41650', 10);

batchTest(startMR, endMR);

