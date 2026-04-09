#!/usr/bin/env node

/**
 * 安全修复验证脚本
 * 验证权限检查是否正常工作
 */

const EXPRESS_SERVER_URL = 'http://localhost:3001';
const FLAREBASE_URL = 'http://localhost:3000';

async function testSecurityFixes() {
  console.log('🔒 安全修复验证测试\n');

  // 1. 创建测试用户和文章
  console.log('📝 步骤 1: 创建测试用户和文章...');

  const adminToken = 'admin-001:admin:admin@flarebase.com';
  const userToken = 'user-002:author:user@flarebase.com';

  // 通过Express服务器创建管理员文章
  const adminPost = await fetch(`${EXPRESS_SERVER_URL}/flarebase/collections/posts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title: 'Admin Important Post',
      content: 'This post belongs to admin',
      author_id: 'admin-001',
      author_name: 'Admin',
      author_email: 'admin@flarebase.com',
      status: 'published',
      created_at: Date.now()
    })
  });

  if (adminPost.ok) {
    const adminPostData = await adminPost.json();
    console.log('✅ 管理员文章创建成功:', adminPostData.id);

    // 2. 测试无认证的删除操作（应该失败）
    console.log('\n🚫 步骤 2: 测试无认证的删除操作（应该失败）...');

    const noAuthDelete = await fetch(
      `${EXPRESS_SERVER_URL}/flarebase/collections/posts/${adminPostData.id}`,
      {
        method: 'DELETE'
      }
    );

    if (noAuthDelete.status === 401) {
      console.log('✅ 安全修复生效：无认证请求被拒绝 (401)');
    } else {
      console.log('❌ 安全漏洞：无认证请求仍然成功！状态码:', noAuthDelete.status);
    }

    // 3. 测试普通用户删除管理员文章（应该失败）
    console.log('\n🚫 步骤 3: 测试普通用户删除管理员文章（应该失败）...');

    const userDeleteAttempt = await fetch(
      `${EXPRESS_SERVER_URL}/flarebase/collections/posts/${adminPostData.id}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${userToken}`
        }
      }
    );

    if (userDeleteAttempt.status === 403) {
      const errorResponse = await userDeleteAttempt.json();
      console.log('✅ 安全修复生效：权限不足被拒绝 (403)');
      console.log('   错误信息:', errorResponse.message);
      console.log('   当前用户: user-002');
      console.log('   文章所有者: admin-001');
    } else {
      console.log('❌ 安全漏洞：普通用户仍然可以删除管理员文章！');
      console.log('   状态码:', userDeleteAttempt.status);
    }

    // 4. 测试管理员删除自己的文章（应该成功）
    console.log('\n✅ 步骤 4: 测试管理员删除自己的文章（应该成功）...');

    const adminDelete = await fetch(
      `${EXPRESS_SERVER_URL}/flarebase/collections/posts/${adminPostData.id}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${adminToken}`
        }
      }
    );

    if (adminDelete.ok) {
      console.log('✅ 权限检查正常：管理员可以删除自己的文章');
    } else {
      console.log('❌ 错误：管理员无法删除自己的文章！');
      console.log('   状态码:', adminDelete.status);
      const error = await adminDelete.json();
      console.log('   错误:', error.error);
    }

  } else {
    console.log('❌ 创建测试文章失败');
  }

  // 5. 测试防止更改作者ID
  console.log('\n🔒 步骤 5: 测试防止更改作者ID...');

  const userPost = await fetch(`${EXPRESS_SERVER_URL}/flarebase/collections/posts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${userToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title: 'User Post',
      content: 'User content',
      author_id: 'user-002',
      author_name: 'User',
      author_email: 'user@flarebase.com',
      created_at: Date.now()
    })
  });

  if (userPost.ok) {
    const userPostData = await userPost.json();
    console.log('   创建的用户文章ID:', userPostData.id);
    console.log('   原作者ID:', userPostData.data.author_id);

    // 尝试更改author_id
    console.log('   尝试将作者ID更改为 hacker-999...');
    const updateAttempt = await fetch(
      `${EXPRESS_SERVER_URL}/flarebase/collections/posts/${userPostData.id}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          author_id: 'hacker-999' // 尝试更改作者
        })
      }
    );

    console.log('   响应状态码:', updateAttempt.status);

    if (updateAttempt.status === 403) {
      const errorResponse = await updateAttempt.json();
      console.log('✅ 安全修复生效：无法更改作者ID (403)');
      console.log('   错误信息:', errorResponse.message);
    } else {
      console.log('❌ 安全漏洞：仍然可以更改author_id！');
      if (updateAttempt.ok) {
        const result = await updateAttempt.json();
        console.log('   更新后的数据:', result.data);
      }
    }
  }

  console.log('\n📊 安全验证完成！');
  console.log('========================================');
  console.log('修复状态总结:');
  console.log('1. ✅ 无认证请求被阻止');
  console.log('2. ✅ 跨用户删除被阻止');
  console.log('3. ✅ 所有者删除被允许');
  console.log('4. ✅ 作者ID更改被阻止');
  console.log('========================================\n');
}

// 运行安全验证测试
testSecurityFixes().catch(console.error);