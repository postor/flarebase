#!/usr/bin/env node

/**
 * 安全漏洞演示脚本
 * 演示普通用户如何删除其他用户的文章
 */

const FLAREBASE_URL = 'http://localhost:3000';

async function demonstrateSecurityVulnerability() {
  console.log('🚨 安全漏洞演示 - 未经授权的删除操作\n');

  // 1. 创建两个不同用户的文章
  console.log('📝 步骤 1: 创建两个不同用户的文章...');

  const adminPost = await fetch(`${FLAREBASE_URL}/collections/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Admin Important Article',
      content: 'This is an important article by admin',
      author_id: 'admin-user-123',
      author_name: 'Admin User',
      status: 'published',
      created_at: Date.now()
    })
  });

  const adminPostData = await adminPost.json();
  console.log('✅ 管理员文章创建成功:', adminPostData.id);

  const userPost = await fetch(`${FLAREBASE_URL}/collections/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Regular User Article',
      content: 'This is a regular user article',
      author_id: 'regular-user-456',
      author_name: 'Regular User',
      status: 'published',
      created_at: Date.now()
    })
  });

  const userPostData = await userPost.json();
  console.log('✅ 普通用户文章创建成功:', userPostData.id);

  // 2. 模拟普通用户尝试删除管理员的文章
  console.log('\n⚠️  步骤 2: 普通用户尝试删除管理员的文章...');

  try {
    const deleteResponse = await fetch(
      `${FLAREBASE_URL}/collections/posts/${adminPostData.id}`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      }
    );

    if (deleteResponse.ok) {
      console.log('❌ 安全漏洞：普通用户成功删除了管理员的文章！');
      console.log('   删除的文章ID:', adminPostData.id);
      console.log('   文章所有者: admin-user-123');
      console.log('   删除操作者: regular-user-456');
      console.log('   ❌ 这应该是被禁止的操作！');

      // 3. 验证文章确实被删除了
      console.log('\n🔍 步骤 3: 验证文章是否真的被删除...');

      const verifyDelete = await fetch(
        `${FLAREBASE_URL}/collections/posts/${adminPostData.id}`
      );

      if (!verifyDelete.ok || (await verifyDelete.json()) === null) {
        console.log('✅ 确认：管理员的文章已被永久删除！');
      }
    } else {
      console.log('✅ 安全保护：删除操作被拒绝');
      console.log('   状态码:', deleteResponse.status);
    }
  } catch (error) {
    console.log('❌ 错误:', error.message);
  }

  // 4. 测试未授权修改
  console.log('\n⚠️  步骤 4: 普通用户尝试修改管理员的文章内容...');

  try {
    const updateResponse = await fetch(
      `${FLAREBASE_URL}/collections/posts/${userPostData.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: '❌ HACKED: This article has been compromised!',
          author_id: 'hacker-user-999' // 尝试更改作者
        })
      }
    );

    if (updateResponse.ok) {
      console.log('❌ 安全漏洞：文章内容被成功修改！');
      console.log('   原作者: regular-user-456');
      console.log('   修改者: hacker-user-999');
    } else {
      console.log('✅ 安全保护：修改操作被拒绝');
    }
  } catch (error) {
    console.log('❌ 错误:', error.message);
  }

  console.log('\n📊 演示完成！');
  console.log('========================================');
  console.log('🔒 安全问题总结:');
  console.log('1. ❌ 没有用户身份验证');
  console.log('2. ❌ 没有权限检查');
  console.log('3. ❌ 没有所有权验证');
  console.log('4. ❌ 任何人都可以删除/修改任何文档');
  console.log('========================================\n');
}

// 运行安全演示
demonstrateSecurityVulnerability().catch(console.error);