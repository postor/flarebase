import { FlareClient } from '../src/index.js';
import http from 'http';
import { spawn } from 'child_process';

const baseURL = 'http://localhost:3000';
const flare = new FlareClient(baseURL);

async function runTests() {
  console.log('🚀 Starting tests...');
  let exitCode = 0;

  try {
    // 1. User Lifecycle Tests
    console.log('\n--- Testing User Lifecycle ---');
    const username = 'testuser@example.com';
    
    console.log('Requesting verification code...');
    await flare.auth.requestVerificationCode(username);
    
    // In our mock server, the code is always '123456'
    const code = '123456';
    
    console.log('Registering user...');
    const user = await flare.auth.register({
      username,
      password: 'password123',
      name: 'Test User'
    }, code);
    console.log('✓ User registered:', user.id);

    console.log('Changing password...');
    // Mock server doesn't need a new code if we haven't deleted it yet, but SDK deletes it.
    // Let's re-request for password change
    await flare.auth.requestVerificationCode(username);
    const updatedUser = await flare.auth.updatePassword(user.id, 'newpassword456', code);
    if (updatedUser.data.password !== 'newpassword456') throw new Error('Password update failed');
    console.log('✓ Password changed');

    console.log('Deleting account...');
    await flare.auth.requestVerificationCode(username);
    const deleteResult = await flare.auth.deleteAccount(user.id, code);
    if (!deleteResult) throw new Error('Delete failed');
    console.log('✓ Account deleted');

    // 2. Article Flow Tests
    console.log('\n--- Testing Article Flows ---');
    const authorId = 'test-author';

    console.log('Creating article...');
    const article = await flare.collection('articles').add({
      title: 'Hello World',
      content: 'First article!',
      author_id: authorId,
      published: false
    });
    console.log('✓ Article created:', article.id);

    console.log('Modifying and publishing...');
    const updatedArticle = await flare.collection('articles').doc(article.id).update({
      ...article.data,
      title: 'Hello World Updated',
      published: true
    });
    if (updatedArticle.data.title !== 'Hello World Updated') throw new Error('Modification failed');
    if (!updatedArticle.data.published) throw new Error('Publication failed');
    console.log('✓ Article modified and published');

    console.log('Browsing lobby...');
    const feed = await flare.collection('articles').where('published', '==', true).get();
    if (feed.length === 0) throw new Error('Lobby empty');
    console.log('✓ Lobby browsing successful');

    console.log('Browsing my articles...');
    const myArticles = await flare.collection('articles').where('author_id', '==', authorId).get();
    if (myArticles.length === 0) throw new Error('My articles empty');
    console.log('✓ My articles browsing successful');

    console.log('\n✨ ALL TESTS PASSED! ✨');

  } catch (err) {
    console.error('\n❌ TEST FAILED:', err.message);
    exitCode = 1;
  }

  process.exit(exitCode);
}

// Start mock server and run tests
const mockServer = spawn('node', ['tests/mock-server.js'], { stdio: 'inherit' });

// Wait a bit for server to start
setTimeout(runTests, 1000);
