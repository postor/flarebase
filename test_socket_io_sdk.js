// 测试完全基于 Socket.IO 的 Flarebase SDK
const { io } = require('socket.io-client');

const FLAREBASE_URL = 'http://localhost:3003';

console.log('🧪 测试 Socket.IO Flarebase SDK\n');

async function testSocketOperations() {
  const socket = io(FLAREBASE_URL, {
    transports: ['websocket']
  });

  await new Promise((resolve) => {
    socket.on('connect', () => {
      console.log('✅ 已连接到 Flarebase');
      resolve();
    });
  });

  // 测试 1: 创建文档 (insert)
  console.log('\n📝 测试 1: 创建文档');
  await new Promise((resolve) => {
    socket.once('insert_success', (doc) => {
      console.log('✅ 文档创建成功:', doc.id);
      resolve(doc);
    });
    socket.once('insert_error', (err) => {
      console.error('❌ 创建失败:', err);
      resolve();
    });
    socket.emit('insert', {
      collection: 'posts',
      data: {
        title: 'Socket.IO Test Post',
        slug: 'socket-io-test',
        content: 'Testing Socket.IO SDK',
        status: 'published',
        author_id: 'test-user',
        published_at: Date.now()
      }
    });
  });

  // 测试 2: 读取文档 (get)
  console.log('\n📖 测试 2: 读取文档列表');
  await new Promise((resolve) => {
    socket.once('list_success', (docs) => {
      console.log(`✅ 找到 ${docs.length} 个文档`);
      resolve(docs);
    });
    socket.once('list_error', (err) => {
      console.error('❌ 读取失败:', err);
      resolve();
    });
    socket.emit('list', { collection: 'posts' });
  });

  // 测试 3: 白名单查询
  console.log('\n🔒 测试 3: 白名单查询');
  await new Promise((resolve) => {
    socket.once('query_success', (result) => {
      console.log('✅ 白名单查询成功:', JSON.stringify(result, null, 2));
      resolve(result);
    });
    socket.once('query_error', (err) => {
      console.error('❌ 查询失败:', err);
      resolve();
    });
    socket.emit('named_query', ['list_published_posts', { limit: 10 }]);
  });

  // 测试 4: 尝试不安全的查询（应该失败）
  console.log('\n⚠️  测试 4: 验证安全限制');
  await new Promise((resolve) => {
    socket.once('query_error', (err) => {
      console.log('✅ 不安全查询被正确阻止:', err.error || err.message);
      resolve();
    });
    socket.once('query_success', () => {
      console.log('❌ 安全漏洞：不安全查询未被阻止');
      resolve();
    });
    // 注意：这个查询不在白名单中，应该失败
    socket.emit('named_query', ['unsafe_query', {}]);
  });

  console.log('\n🎉 所有测试完成！');
  socket.disconnect();
  process.exit(0);
}

testSocketOperations().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
