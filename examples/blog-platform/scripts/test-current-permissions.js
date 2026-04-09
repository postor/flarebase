#!/usr/bin/env node

/**
 * 🔒 当前权限系统状态测试
 */

const FLAREBASE_URL = 'http://localhost:3000';

async function testCurrentPermissions() {
  console.log('🔍 测试当前Flarebase权限系统状态\n');

  const adminToken = 'admin-001:admin:admin@flarebase.com';
  const userToken = 'user-002:user:user@flarebase.com';

  try {
    // 测试1: 创建文档
    console.log('📝 测试1: 创建文档（需要认证）');
    const createResponse = await fetch(`${FLAREBASE_URL}/collections/posts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: 'Test Post',
        content: 'Test content',
        author_id: 'admin-001'
      })
    });

    if (createResponse.ok) {
      const doc = await createResponse.json();
      console.log('✅ 创建成功:', doc.id);

      // 测试2: 无认证删除
      console.log('\n🚫 测试2: 无认证删除');
      const noAuthDelete = await fetch(`${FLAREBASE_URL}/collections/posts/${doc.id}`, {
        method: 'DELETE'
      });

      if (noAuthDelete.ok) {
        console.log('❌ 安全漏洞：无认证删除成功！');
      } else {
        console.log('✅ 正确阻止了无认证删除:', noAuthDelete.status);
      }

      // 重新创建文档用于跨用户测试
      const newDoc = await fetch(`${FLAREBASE_URL}/collections/posts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: 'Admin Post',
          content: 'Admin content',
          author_id: 'admin-001'
        })
      });

      if (newDoc.ok) {
        const adminDoc = await newDoc.json();

        // 测试3: 跨用户删除
        console.log('\n🚫 测试3: 跨用户删除（user删除admin文档）');
        const crossUserDelete = await fetch(`${FLAREBASE_URL}/collections/posts/${adminDoc.id}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${userToken}`
          }
        });

        if (crossUserDelete.ok) {
          console.log('❌ 安全漏洞：跨用户删除成功！');
        } else {
          console.log('✅ 正确阻止了跨用户删除:', crossUserDelete.status);
        }
      }

      // 测试4: 修改author_id
      console.log('\n🚫 测试4: 修改author_id');
      const testDoc = await fetch(`${FLAREBASE_URL}/collections/posts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: 'User Post',
          content: 'User content',
          author_id: 'user-002'
        })
      });

      if (testDoc.ok) {
        const userDoc = await testDoc.json();
        const updateAuthor = await fetch(`${FLAREBASE_URL}/collections/posts/${userDoc.id}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${userToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            author_id: 'hacker-999'
          })
        });

        if (updateAuthor.ok) {
          const result = await updateAuthor.json();
          console.log('❌ 安全漏洞：author_id修改成功！新作者:', result.data.author_id);
        } else {
          console.log('✅ 正确阻止了author_id修改:', updateAuthor.status);
        }
      }
    }

    console.log('\n📊 当前权限系统状态总结:');
    console.log('========================================');
    console.log('当前Flarebase服务器还没有实施权限检查');
    console.log('需要在HTTP处理器层面添加权限控制');
    console.log('========================================\n');

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }
}

testCurrentPermissions().catch(console.error);