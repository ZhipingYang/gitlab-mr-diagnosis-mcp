/**
 * 调研脚本 - 分析 Coverage 报告格式
 * 对比 Console Log 和 Coverage Report HTML 两种方案
 */

import { JenkinsService } from './services/jenkins';

const BUILD_NUMBER = 44396; // MR #41613 的构建号
const JENKINS_BASE = 'https://jenkins-commonci.int.rclabenv.com';
const JOB_PATH = '/job/CommonCI-Jupiter-Web-MR-Auto-Generate';

async function researchCoverage() {
  const jenkins = new JenkinsService();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🔬 Coverage 解析方案调研 (深度分析)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 方案 1: 从 Console Log 分析
  console.log('📋 方案 1: Console Log 深度分析');
  console.log('─'.repeat(60));

  try {
    const consoleLog = await jenkins.getConsoleLogByBuildNumber(BUILD_NUMBER);
    console.log(`✅ Console Log 获取成功，长度: ${consoleLog.length} 字符\n`);

    // 1. 找到 uncovered 相关的上下文
    console.log('🔍 搜索 "uncovered" 上下文:');
    const uncoveredIndex = consoleLog.indexOf('uncovered');
    if (uncoveredIndex !== -1) {
      const context = consoleLog.substring(
        Math.max(0, uncoveredIndex - 200),
        Math.min(consoleLog.length, uncoveredIndex + 500)
      );
      console.log('  上下文:\n' + context.split('\n').map(l => '    ' + l).join('\n'));
    }

    // 2. 找到 Diff Coverage Statistics 相关内容
    console.log('\n🔍 搜索 "Diff Coverage Statistics" 上下文:');
    const diffCovIndex = consoleLog.indexOf('Diff Coverage Statistics');
    if (diffCovIndex !== -1) {
      const context = consoleLog.substring(
        Math.max(0, diffCovIndex - 100),
        Math.min(consoleLog.length, diffCovIndex + 1000)
      );
      console.log('  上下文:\n' + context.split('\n').slice(0, 20).map(l => '    ' + l).join('\n'));
    }

    // 3. 找到 diffcoverage 阶段相关的内容
    console.log('\n🔍 搜索 diffcoverage 阶段输出:');
    const diffCoverageStageIndex = consoleLog.indexOf('diffcoverage');
    if (diffCoverageStageIndex !== -1) {
      // 搜索附近的统计信息
      const nearbyContent = consoleLog.substring(
        diffCoverageStageIndex,
        Math.min(consoleLog.length, diffCoverageStageIndex + 5000)
      );
      console.log('  阶段附近内容 (前 30 行):');
      nearbyContent.split('\n').slice(0, 30).forEach(l => console.log('    ' + l));
    }

    // 4. 搜索包含百分比和文件路径的模式
    console.log('\n🔍 搜索文件覆盖率模式:');

    // 模式: "xxx.ts ... XX%"
    const tsFileWithPercent = /([a-zA-Z0-9_\-\/]+\.tsx?)[^\n]*?([\d.]+)%/g;
    let match;
    let matchCount = 0;
    while ((match = tsFileWithPercent.exec(consoleLog)) !== null && matchCount < 10) {
      if (match[1].includes('project/')) {
        console.log(`  文件: ${match[1]}, 覆盖率: ${match[2]}%`);
        matchCount++;
      }
    }

    // 5. 搜索 Overall Diff Coverage 的完整格式
    console.log('\n🔍 Overall Diff Coverage 完整匹配:');
    const overallMatch = consoleLog.match(/Overall Diff Coverage Statistics[^}]+/i);
    if (overallMatch) {
      console.log('  匹配结果:');
      console.log('    ' + overallMatch[0].substring(0, 500));
    }

  } catch (error) {
    console.log(`❌ Console Log 获取失败: ${error}`);
  }

  // 方案 2: 从 Coverage Report HTML 分析
  console.log('\n');
  console.log('📋 方案 2: Coverage Report HTML 深度分析');
  console.log('─'.repeat(60));

  // 尝试多个可能的 Coverage Report URL
  const coverageReportUrls = [
    `${JENKINS_BASE}${JOB_PATH}/${BUILD_NUMBER}/Overall_20Coverage_20Report/`,
    `${JENKINS_BASE}${JOB_PATH}/${BUILD_NUMBER}/coverage/`,
    `${JENKINS_BASE}${JOB_PATH}/${BUILD_NUMBER}/htmlreports/Overall_Coverage_Report/`,
    `${JENKINS_BASE}${JOB_PATH}/${BUILD_NUMBER}/artifact/coverage/lcov-report/index.html`,
  ];

  for (const url of coverageReportUrls) {
    try {
      console.log(`\n📥 尝试: ${url}`);
      const response = await fetch(url, { redirect: 'follow' });
      console.log(`   状态: ${response.status}, 最终 URL: ${response.url}`);

      if (response.ok) {
        const html = await response.text();
        console.log(`   ✅ 获取成功，长度: ${html.length} 字符`);

        // 显示前 500 字符
        console.log('   内容预览:');
        console.log(html.substring(0, 800).split('\n').map(l => '     ' + l).join('\n'));

        // 搜索关键元素
        const tableMatches = html.match(/<table[^>]*>/gi);
        const filePathMatches = html.match(/project\/[^<"'\s]+\.tsx?/g);
        const percentMatches = html.match(/[\d.]+%/g);
        console.log(`   表格: ${tableMatches?.length || 0}, 文件路径: ${filePathMatches?.length || 0}, 百分比: ${percentMatches?.length || 0}`);
      }
    } catch (error) {
      console.log(`   ❌ 失败: ${error}`);
    }
  }

  // 方案 3: 尝试获取 lcov-report 目录
  console.log('\n');
  console.log('📋 方案 3: 搜索 Console Log 中的 coverage report URL');
  console.log('─'.repeat(60));

  try {
    const consoleLog = await jenkins.getConsoleLogByBuildNumber(BUILD_NUMBER);

    // 搜索包含 coverage 和 URL 的行
    const urlPatterns = [
      /https?:\/\/[^\s]+coverage[^\s]*/gi,
      /https?:\/\/[^\s]+lcov[^\s]*/gi,
      /artifact[^\s]*coverage[^\s]*/gi,
    ];

    for (const pattern of urlPatterns) {
      const matches = consoleLog.match(pattern);
      if (matches && matches.length > 0) {
        console.log(`\n发现 URL 匹配 (${pattern}):`);
        const uniqueMatches = Array.from(new Set(matches));
        uniqueMatches.slice(0, 5).forEach(m => console.log(`  - ${m}`));
      }
    }

    // 搜索 publishHTML 相关内容
    console.log('\n🔍 搜索 publishHTML 阶段:');
    const publishIndex = consoleLog.indexOf('publishHTML');
    if (publishIndex !== -1) {
      const context = consoleLog.substring(publishIndex, publishIndex + 1000);
      console.log(context.split('\n').slice(0, 15).map(l => '  ' + l).join('\n'));
    }

    // 搜索 lcov 相关
    console.log('\n🔍 搜索 lcov-report:');
    const lcovIndex = consoleLog.indexOf('lcov-report');
    if (lcovIndex !== -1) {
      const context = consoleLog.substring(
        Math.max(0, lcovIndex - 100),
        lcovIndex + 500
      );
      console.log(context.split('\n').map(l => '  ' + l).join('\n'));
    } else {
      console.log('  未找到 lcov-report 相关内容');
    }

  } catch (error) {
    console.log(`❌ 失败: ${error}`);
  }

  // 方案 4: 尝试访问具体的 Coverage Report 页面
  console.log('\n');
  console.log('📋 方案 4: 访问具体的 lcov-report 页面');
  console.log('─'.repeat(60));

  const lcovReportUrls = [
    `${JENKINS_BASE}${JOB_PATH}/${BUILD_NUMBER}/Ai_20Coverage_20Report/`,
    `${JENKINS_BASE}${JOB_PATH}/${BUILD_NUMBER}/Phone_20Coverage_20Report/`,
    `${JENKINS_BASE}${JOB_PATH}/${BUILD_NUMBER}/Overall_20Coverage_20Report/`,
    `${JENKINS_BASE}${JOB_PATH}/${BUILD_NUMBER}/Message_20Coverage_20Report/`,
    `${JENKINS_BASE}${JOB_PATH}/${BUILD_NUMBER}/App_20Coverage_20Report/`,
  ];

  for (const url of lcovReportUrls) {
    try {
      console.log(`\n📥 尝试: ${url}`);
      const response = await fetch(url, { redirect: 'follow' });

      if (response.ok) {
        const html = await response.text();
        console.log(`   ✅ 获取成功，长度: ${html.length} 字符`);

        // 搜索文件路径
        const filePathMatches = html.match(/[a-zA-Z0-9_\-\/]+\.tsx?/g);
        const percentMatches = html.match(/[\d.]+%/g);
        console.log(`   文件路径: ${filePathMatches?.length || 0}, 百分比: ${percentMatches?.length || 0}`);

        if (filePathMatches && filePathMatches.length > 0) {
          const uniqueFiles = Array.from(new Set(filePathMatches));
          console.log(`   前5个文件: ${uniqueFiles.slice(0, 5).join(', ')}`);
        }

        // 显示 HTML 结构
        if (html.includes('<table')) {
          console.log('   ✅ 包含表格元素');
        }

        // 查找 index.html 链接
        const links = html.match(/href="[^"]+"/g);
        if (links) {
          console.log(`   发现 ${links.length} 个链接`);
          const htmlLinks = links.filter(l => l.includes('.html') || l.includes('index'));
          if (htmlLinks.length > 0) {
            console.log(`   HTML 链接: ${htmlLinks.slice(0, 3).join(', ')}`);
          }
        }
      } else {
        console.log(`   ❌ 状态: ${response.status}`);
      }
    } catch (error) {
      console.log(`   ❌ 失败: ${error}`);
    }
  }

  // 方案 5: 访问 Overall Coverage Report 的 index.html
  console.log('\n');
  console.log('📋 方案 5: 访问 lcov-report 的 index.html');
  console.log('─'.repeat(60));

  const indexUrls = [
    `${JENKINS_BASE}${JOB_PATH}/${BUILD_NUMBER}/Overall_20Coverage_20Report/index.html`,
    `${JENKINS_BASE}${JOB_PATH}/${BUILD_NUMBER}/Phone_20Coverage_20Report/index.html`,
  ];

  for (const url of indexUrls) {
    try {
      console.log(`\n📥 尝试: ${url}`);
      const response = await fetch(url, { redirect: 'follow' });

      if (response.ok) {
        const html = await response.text();
        console.log(`   ✅ 获取成功，长度: ${html.length} 字符`);

        // 搜索文件覆盖率信息
        // lcov-report 格式通常是: <span class="cover-xxx">88.46%</span>
        const coverPatterns = [
          /class="[^"]*(?:high|medium|low)[^"]*"[^>]*>[\d.]+%/gi,
          /<td[^>]*>[\d.]+%/gi,
          /data-value="[\d.]+"/gi,
        ];

        for (const pattern of coverPatterns) {
          const matches = html.match(pattern);
          if (matches && matches.length > 0) {
            console.log(`   模式 ${pattern}: ${matches.length} 匹配`);
            console.log(`   示例: ${matches.slice(0, 3).join(' | ')}`);
          }
        }

        // 搜索文件路径和覆盖率的组合
        // 格式: <a href="xxx.ts.html">xxx.ts</a> ... <td>88%</td>
        const rows = html.split(/<tr/gi);
        console.log(`   表格行数: ${rows.length}`);

        if (rows.length > 2) {
          console.log('   前 3 行内容预览:');
          rows.slice(1, 4).forEach((row, i) => {
            const cleaned = row.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            console.log(`     ${i + 1}. ${cleaned.substring(0, 120)}...`);
          });
        }
      } else {
        console.log(`   ❌ 状态: ${response.status}`);
      }
    } catch (error) {
      console.log(`   ❌ 失败: ${error}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('📊 调研总结');
  console.log('═══════════════════════════════════════════════════════════════');
}

researchCoverage();

