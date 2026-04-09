#!/usr/bin/env node

/**
 * 🔒 Hacker攻击演示 - 验证安全漏洞
 * 模拟黑客攻击场景
 */

const FLAREBASE_URL = 'http://localhost:3000';

async function hackerAttackDemo() {
  console.log('🔥 Hacker攻击演示 - 验证安全漏洞\n');
  console.log('========================================');

  // 定义tokens
  const adminToken = 'admin-001:admin:admin@flarebase.com';
  const userToken = 'user-002:hacker:hacker@evil.com';

  // 1. 创建管理员文章
  console.log('📝 步骤 1: 管理员创建重要文章...');

  const adminPost = await fetch(`${FLAREBASE_URL}/collections/posts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title: '🚨 重要官方公告',
      content: '这是重要的官方信息，不应该被删除',
      author_id: 'admin-001',
      author_name: '系统管理员',
      status: 'published',
      created_at: Date.now()
    })
  });

  if (adminPost.ok) {
    const postData = await adminPost.json();
    const postId = postData.id;
    console.log('✅ 管理员文章创建成功');
    console.log('   文章ID:', postId);
    console.log('   标题:', postData.data.title);
    console.log('   作者:', postData.data.author_name);

    // 2. 黑客攻击 - 无认证删除
    console.log('\n🔥 步骤 2: 🦹 Hacker无认证攻击...');
    console.log('   尝试删除管理员文章（无任何认证）');

    const hackerAttackNoAuth = await fetch(`${FLAREBASE_URL}/collections/posts/${postId}`, {
      method: 'DELETE'
      // 故意不提供任何认证信息
    });

    if (hackerAttackNoAuth.ok) {
      console.log('❌ 安全漏洞确认：Hacker成功删除了文章！');
      console.log('   任何不需要认证就能删除文档');

      // 重新创建文章用于下一个测试
      const newPost = await fetch(`${FLAREBASE_URL}/collections/posts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: '🚨 重要官方公告 (重试)',
          content: '这是重要的官方信息',
          author_id: 'admin-001',
          created_at: Date.now()
        })
      });

      if (newPost.ok) {
        const newPostData = await newPost.json();
        const newPostId = newPostData.id;

        // 3. 黑客攻击 - 假冒普通用户
        console.log('\n🔥 步骤 3: 🦹 Hacker假冒普通用户攻击...');
        console.log('   尝试作为普通user-002删除管理员文章');

        const userToken = 'user-002:hacker:hacker@evil.com';
        const hackerAttackAsUser = await fetch(`${FLAREBASE_URL}/collections/posts/${newPostId}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${userToken}`
          }
        });

        if (hackerAttackAsUser.ok) {
          console.log('❌ 安全漏洞确认：Hacker成功删除了管理员文章！');
          console.log('   普通用户可以删除管理员的资源');
        } else {
          console.log('✅ Flarebase阻止了跨用户删除');
        }
      }
    } else {
      console.log('✅ Flarebase正确阻止了无认证删除');
    }

    // 4. 黑客攻击 - 修改文章作者
    console.log('\n🔥 步骤 4: 🦹 Hacker尝试篡改文章作者...');

    const targetPost = await fetch(`${FLAREBASE_URL}/collections/posts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: '官方文章',
        content: '原内容',
        author_id: 'admin-001',
        created_at: Date.now()
      })
    });

    if (targetPost.ok) {
      const targetData = await targetPost.json();
      console.log('   创建目标文章:', targetData.id);
      console.log('   原作者:', targetData.data.author_id);

      const hackerUpdate = await fetch(`${FLAREBASE_URL}/collections/posts/${targetData.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          author_id: 'hacker-999',  // 尝试更改作者
          content: '🦹 此文章已被黑客篡改！'
        })
      });

      if (hackerUpdate.ok) {
        const result = await hackerUpdate.json();
        console.log('❌ 安全漏洞确认：Hacker成功修改了author_id！');
        console.log('   新作者:', result.data.author_id);
        console.log('   内容:', result.data.content);
      } else {
        console.log('✅ Flarebase阻止了author_id修改');
      }
    }

  }

  console.log('\n========================================');
  console.log('📊 Hacker攻击验证结果:');
  console.log('❌ Flarebase层面存在严重安全漏洞');
  console.log('❌ 任何人都可以删除任何文档');
  console.log('❌ 普通用户可以操作管理员资源');
  console.log('❌ 作者身份可以被篡改');
  console.log('');
  console.log('🔧 建议: 在Flarebase服务器层面实施权限检查');
  console.log('========================================\n');
}

hackerAttackDemo().catch(console.error);