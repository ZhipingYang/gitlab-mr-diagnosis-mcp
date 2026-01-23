/**
 * 测试脚本 - 验证 MR 诊断功能
 */

import { MRDiagnosisTool } from './tools/diagnose';
import { loadDiagnosisConfig, validateConfig } from './utils/config';

/** 默认测试 MR URL */
const DEFAULT_TEST_MR_URL = 'https://git.ringcentral.com/Fiji/Fiji/-/merge_requests/41613';

async function main() {
  const config = loadDiagnosisConfig();
  const validation = validateConfig(config);

  if (!validation.valid) {
    console.error('❌ 配置错误:');
    validation.errors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  }

  const mrUrl = process.argv[2] || DEFAULT_TEST_MR_URL;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🔍 MCP MR Diagnosis Tool - 测试');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`📌 测试 MR: ${mrUrl}`);
  console.log('');

  try {
    const tool = new MRDiagnosisTool(config);

    console.log('⏳ 正在诊断...');
    console.log('');

    const result = await tool.diagnose(mrUrl);
    console.log(tool.formatResult(result));

    // 显示修复建议
    if (result.failedTests.length > 0) {
      printFixSuggestions(result.failedTests);
    }

  } catch (error) {
    console.error('❌ 诊断失败:', error);
    process.exit(1);
  }
}

/**
 * 打印修复建议
 */
function printFixSuggestions(failedTests: { testFile: string }[]) {
  // 按文件去重
  const uniqueFiles = [...new Set(failedTests.map(t => t.testFile))];

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🔧 修复建议');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('要在本地运行失败的测试，请执行:');
  uniqueFiles.forEach((file, index) => {
    console.log(`  ${index + 1}. yarn test:no-watch ${file}`);
  });
  console.log('');
  console.log('修复后提交代码，然后在 MR 页面评论 "build" 重新触发构建');
}

main();

