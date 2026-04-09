#!/usr/bin/env node

/**
 * 测试前端直接连接Flarebase的架构
 * 不通过Express代理，直接与Flarebase通信
 */

const FLAREBASE_URL = 'http://localhost:3000';

async function testDirectFlarebaseConnection() {
  console.log('🔥 测试前端直接连接Flarebase架构\n');

  const adminToken = 'admin-001:admin:admin@flarebase.com';
  const userToken = 'user-002:author:user@flarebase.com';

  try {
    // 1. 测试创建文章（直接连接Flarebase）
    console.log('📝 步骤 1: 直接创建文章到Flarebase...');

    const adminPost = await fetch(`${FLAREBASE_URL}/collections/posts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: 'Direct Flarebase Post',
        content: 'This post was created directly via Flarebase API',
        author_id: 'admin-001',
        author_name: 'Admin',
        author_email: 'admin@flarebase.com',
        status: 'published',
        created_at: Date.now()
      })
    });

    if (adminPost.ok) {
      const adminPostData = await adminPost.json();
      console.log('✅ 文章创建成功 (直接连接Flarebase):', adminPostData.id);

      // 2. 测试读取文章（不需要认证）
      console.log('\n📖 步骤 2: 读取文章 (不需要认证)...');

      const getPost = await fetch(`${FLAREBASE_URL}/collections/posts/${adminPostData.id}`);
      if (getPost.ok) {
        const postData = await getPost.json();
        console.log('✅ 文章读取成功:', postData.data.title);
      }

      // 3. 测试无认证删除（Flarebase目前没有权限检查）
      console.log('\n🚫 步骤 3: 测试无认证删除...');

      const noAuthDelete = await fetch(`${FLAREBASE_URL}/collections/posts/${adminPostData.id}`, {
        method: 'DELETE'
      });

      if (noAuthDelete.ok) {
        console.log('⚠️  安全问题: Flarebase允许无认证删除！');
        console.log('   这证明需要在Flarebase层面添加权限检查');
      } else {
        console.log('✅ Flarebase正确拒绝了无认证删除');
      }

      // 4. 测试跨用户删除
      console.log('\n🔒 步骤 4: 测试跨用户权限...');

      const userPost = await fetch(`${FLAREBASE_URL}/collections/posts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: 'Admin Post',
          content: 'Belongs to admin',
          author_id: 'admin-001',
          created_at: Date.now()
        })
      });

      if (userPost.ok) {
        const userPostData = await userPost.json();
        console.log('   创建管理员文章:', userPostData.id);

        // 尝试用普通用户删除管理员文章
        const userDeleteAttempt = await fetch(`${FLAREBASE_URL}/collections/posts/${userPostData.id}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${userToken}`
          }
        });

        if (userDeleteAttempt.ok) {
          console.log('⚠️  安全问题: 普通用户可以删除管理员文章！');
          console.log('   这证明Flarebase需要实施权限系统');
        } else {
          console.log('✅ Flarebase正确拒绝了跨用户删除');
        }
      }

    } else {
      console.log('❌ 创建文章失败:', await adminPost.text());
    }

    console.log('\n📊 架构验证完成！');
    console.log('========================================');
    console.log('架构状态:');
    console.log('✅ 前端可以直接连接Flarebase');
    console.log('⚠️  Flarebase需要添加权限检查');
    console.log('📝 建议在Flarebase层面配置权限策略');
    console.log('========================================\n');

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }
}

// 运行测试
testDirectFlarebaseConnection().catch(console.error);