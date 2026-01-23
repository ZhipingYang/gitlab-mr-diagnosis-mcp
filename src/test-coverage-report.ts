/**
 * 测试脚本 - 验证 Coverage Report 解析功能
 */

import { JenkinsService } from './services/jenkins';

const BUILD_NUMBER = 44661; // 使用有 Diff Coverage Report 的构建
const JENKINS_BASE = 'https://jenkins-commonci.int.rclabenv.com';
const JOB_PATH = '/job/CommonCI-Jupiter-Web-MR-Auto-Generate';

async function main() {
  const jenkins = new JenkinsService();
  const buildUrl = `${JENKINS_BASE}${JOB_PATH}/${BUILD_NUMBER}`;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🔍 Coverage Report 解析测试');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`📌 Build URL: ${buildUrl}`);
  console.log('');

  try {
    // 测试 1: 获取 Coverage Report HTML
    console.log('📋 步骤 1: 获取 Coverage Report HTML');
    console.log('─'.repeat(60));
    
    const html = await jenkins.getCoverageReportHtml(buildUrl, 'Overall');
    console.log(`✅ 获取成功，HTML 长度: ${html.length} 字符`);
    console.log('');

    // 分析 HTML 结构
    console.log('📋 步骤 2: 分析 HTML 结构');
    console.log('─'.repeat(60));

    // 搜索表格行
    const trMatches = html.match(/<tr[^>]*>/gi);
    console.log(`  <tr> 标签: ${trMatches?.length || 0} 个`);

    // 搜索 file class
    const fileMatches = html.match(/class="file[^"]*"/gi);
    console.log(`  class="file...": ${fileMatches?.length || 0} 个`);

    // 搜索 data-value
    const dataValueMatches = html.match(/data-value="[^"]+"/gi);
    console.log(`  data-value: ${dataValueMatches?.length || 0} 个`);

    // 显示第一个表格行的完整内容
    const firstTrIndex = html.indexOf('<tr');
    if (firstTrIndex !== -1) {
      const firstTrEnd = html.indexOf('</tr>', firstTrIndex);
      if (firstTrEnd !== -1) {
        const firstTr = html.substring(firstTrIndex, firstTrEnd + 5);
        console.log('\n  第一个 <tr> 内容:');
        console.log('  ' + firstTr.substring(0, 500));
      }
    }

    // 搜索包含百分比的 td
    const tdWithPercent = html.match(/<td[^>]*>[\d.]+%<\/td>/gi);
    console.log(`\n  包含百分比的 <td>: ${tdWithPercent?.length || 0} 个`);
    if (tdWithPercent && tdWithPercent.length > 0) {
      console.log('  示例: ' + tdWithPercent.slice(0, 3).join(' | '));
    }

    // 搜索 <a> 链接
    const aLinks = html.match(/<a[^>]*href="[^"]+"[^>]*>[^<]+<\/a>/gi);
    console.log(`\n  所有 <a> 链接: ${aLinks?.length || 0} 个`);
    if (aLinks && aLinks.length > 0) {
      console.log('  示例: ' + aLinks.slice(0, 5).join('\n         '));
    }

    // 显示第二个表格行 (第一个是表头)
    const trPattern = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
    let trIndex = 0;
    let trMatch: RegExpExecArray | null;
    while ((trMatch = trPattern.exec(html)) !== null && trIndex < 3) {
      trIndex++;
      if (trIndex === 2) {
        console.log('\n  第二个 <tr> (数据行) 完整内容:');
        console.log('  ' + trMatch[0].replace(/\n/g, '\n  '));
      }
    }
    console.log('');

    // 测试 3: 解析 Overall Coverage Report
    console.log('📋 步骤 3: 解析 Overall Coverage Report (阈值: 90%)');
    console.log('─'.repeat(60));

    const uncoveredFiles = jenkins.parseOverallCoverageReportHtml(html, 90);
    console.log(`✅ 解析成功，找到 ${uncoveredFiles.length} 个低覆盖模块`);
    console.log('');

    // 显示前 20 个未覆盖的文件
    console.log('📁 未覆盖的文件列表 (覆盖率 < 90%):');
    console.log('┌──────────────────────────────────────────────────────────────┬──────────┬────────────┐');
    console.log('│ 文件路径                                                     │ 覆盖率   │ 未覆盖行数 │');
    console.log('├──────────────────────────────────────────────────────────────┼──────────┼────────────┤');

    uncoveredFiles.slice(0, 20).forEach(file => {
      const path = file.filePath.padEnd(60).substring(0, 60);
      const coverage = `${file.coverage}%`.padStart(8);
      const lines = String(file.uncoveredLines).padStart(10);
      console.log(`│ ${path} │ ${coverage} │ ${lines} │`);
    });

    console.log('└──────────────────────────────────────────────────────────────┴──────────┴────────────┘');

    if (uncoveredFiles.length > 20) {
      console.log(`... 还有 ${uncoveredFiles.length - 20} 个文件`);
    }

    // 测试 3: 使用封装的方法
    console.log('');
    console.log('📋 步骤 3: 使用 getUncoveredFiles 方法');
    console.log('─'.repeat(60));

    const files = await jenkins.getUncoveredFiles(buildUrl, 90);
    console.log(`✅ getUncoveredFiles 返回 ${files.length} 个文件`);

    // 统计
    console.log('');
    console.log('📊 统计:');
    const under50 = files.filter(f => f.coverage < 50).length;
    const under80 = files.filter(f => f.coverage >= 50 && f.coverage < 80).length;
    const under90 = files.filter(f => f.coverage >= 80 && f.coverage < 90).length;
    console.log(`  覆盖率 < 50%: ${under50} 个文件`);
    console.log(`  覆盖率 50-80%: ${under80} 个文件`);
    console.log(`  覆盖率 80-90%: ${under90} 个文件`);

    // 方案 4: 尝试获取 Diff Coverage Report
    console.log('');
    console.log('📋 步骤 4: 尝试获取 Diff Coverage Report');
    console.log('─'.repeat(60));

    // 测试 5: 获取 Diff Coverage Report
    console.log('📋 步骤 5: 获取并解析 Diff Coverage Report');
    console.log('─'.repeat(60));

    try {
      const diffHtml = await jenkins.getCoverageReportHtml(buildUrl, 'Overall', true);
      console.log(`✅ Diff Coverage Report 获取成功，长度: ${diffHtml.length} 字符`);

      // 解析 Diff Coverage
      const diffFiles = jenkins.parseDiffCoverageReportHtml(diffHtml, 90);
      console.log(`✅ 解析成功，找到 ${diffFiles.length} 个低覆盖文件`);
      console.log('');

      if (diffFiles.length > 0) {
        console.log('📁 Diff Coverage 未达标的文件:');
        console.log(
          '┌' +
            '─'.repeat(70) +
            '┬' +
            '─'.repeat(10) +
            '┐'
        );
        console.log(
          '│ ' +
            '文件路径'.padEnd(68) +
            ' │ ' +
            '覆盖率'.padEnd(8) +
            ' │'
        );
        console.log(
          '├' +
            '─'.repeat(70) +
            '┼' +
            '─'.repeat(10) +
            '┤'
        );
        diffFiles.forEach((file) => {
          const path = file.filePath.length > 68
            ? '...' + file.filePath.slice(-65)
            : file.filePath.padEnd(68);
          const cov = `${file.coverage}%`.padStart(8);
          console.log(`│ ${path} │ ${cov} │`);
        });
        console.log(
          '└' +
            '─'.repeat(70) +
            '┴' +
            '─'.repeat(10) +
            '┘'
        );
      }
    } catch (error) {
      console.log(`❌ Diff Coverage Report 获取失败: ${error}`);
    }

  } catch (error) {
    console.error('❌ 测试失败:', error);
    process.exit(1);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('✅ 测试完成');
  console.log('═══════════════════════════════════════════════════════════════');
}

main();

