// 真实数据加载测试
const fetch = require('node-fetch');

async function testRealDataLoading() {
  console.log('🔍 真实数据加载测试\n');
  console.log('====================');

  try {
    // 1. 测试API是否返回真实数据
    console.log('1. 测试 named query API...');
    const apiResponse = await fetch('http://localhost:3000/queries/get_published_posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 5, offset: 0 })
    });

    const apiData = await apiResponse.json();
    console.log('API状态:', apiResponse.status);
    console.log('API返回类型:', Array.isArray(apiData) ? '✅ 数组' : typeof apiData);
    console.log('数据长度:', Array.isArray(apiData) ? apiData.length : 'N/A');
    console.log('第一个元素:', JSON.stringify(apiData[0], null, 2));

    // 2. 验证数据格式
    if (Array.isArray(apiData) && apiData.length > 0) {
      const firstPost = apiData[0];
      console.log('\n2. 验证数据格式:');
      console.log('  - 有id字段:', !!firstPost.id ? '✅' : '❌');
      console.log('  - 有collection字段:', !!firstPost.collection ? '✅' : '❌');
      console.log('  - 有data字段:', !!firstPost.data ? '✅' : '❌');
      console.log('  - data是对象:', typeof firstPost.data === 'object' ? '✅' : '❌');

      if (firstPost.data && typeof firstPost.data === 'object') {
        console.log('  - 有title字段:', !!firstPost.data.title ? '✅' : '❌');
        console.log('  - 有content字段:', !!firstPost.data.content ? '✅' : '❌');
        console.log('  - 有status字段:', !!firstPost.data.status ? '✅' : '❌');
      }

      // 3. 测试blog platform能否访问
      console.log('\n3. 测试Blog Platform访问...');
      const blogResponse = await fetch('http://localhost:3002');
      const blogHtml = await blogResponse.text();

      const hasLoading = blogHtml.includes('Loading posts');
      const hasError = blogHtml.includes('Error') || blogHtml.includes('Failed');
      const hasContent = blogHtml.includes('posts') || blogHtml.includes('article');

      console.log('  - 页面可访问:', blogResponse.status === 200 ? '✅' : '❌');
      console.log('  - 仍在加载:', hasLoading ? '⏳' : '✅');
      console.log('  - 有错误:', hasError ? '❌' : '✅');
      console.log('  - 有内容:', hasContent ? '✅' : '❌');

      // 4. 最终评估
      console.log('\n====================');
      console.log('📊 最终评估:');

      if (Array.isArray(apiData) && apiData.length > 0 && !hasLoading) {
        console.log('✅ **成功！** API返回真实数据，blog platform正常加载');
        console.log('✅ **数据格式正确**:', firstPost.data.title);
        console.log('✅ **系统工作正常**: Backend → API → Frontend');
      } else if (Array.isArray(apiData)) {
        console.log('⚠️  **部分成功**: API返回数据，但blog platform仍在加载');
        console.log('   可能原因: JavaScript代码需要调整以处理新的数据格式');
        console.log('   建议: 检查blog platform如何处理API响应');
      } else {
        console.log('❌ **失败**: API仍然返回查询定义，不是实际数据');
      }

    } else {
      console.log('❌ API没有返回数组，返回了:', typeof apiData);
      console.log('   实际内容:', JSON.stringify(apiData, null, 2));
    }

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }
}

testRealDataLoading();