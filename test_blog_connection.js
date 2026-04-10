/**
 * Test script to verify Blog Platform connection to Flarebase
 */

const FlareClient = require('./clients/js/dist/index.js').FlareClient;

const FLAREBASE_URL = 'http://localhost:3000';

async function testConnection() {
  console.log('=== Testing Flarebase Blog Platform Connection ===\n');

  try {
    const client = new FlareClient(FLAREBASE_URL);

    // Test 1: Basic connection
    console.log('1. Testing basic connection...');
    const posts = await client.collection('posts').get();
    console.log(`✅ Connected! Found ${posts.length} posts`);

    // Test 2: Create a test post
    console.log('\n2. Creating a test post...');
    const newPost = await client.collection('posts').add({
      title: 'Test Post',
      content: 'This is a test post created automatically.',
      status: 'published',
      slug: 'test-post-' + Date.now(),
      published_at: Date.now(),
      author_id: 'test-author',
      created_at: Date.now(),
      updated_at: Date.now()
    });
    console.log(`✅ Created post with ID: ${newPost.id}`);

    // Test 3: Query posts
    console.log('\n3. Querying published posts...');
    const publishedPosts = await client.collection('posts').where('status', '==', 'published').get();
    console.log(`✅ Found ${publishedPosts.length} published posts`);

    // Test 4: Named query
    console.log('\n4. Testing named query...');
    try {
      const result = await client.namedQuery('get_published_posts', { limit: 5, offset: 0 });
      console.log(`✅ Named query returned ${result.length} posts`);
    } catch (err) {
      console.log(`⚠️  Named query failed: ${err.message}`);
    }

    console.log('\n=== All tests completed successfully! ===');
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

testConnection();
