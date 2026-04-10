/**
 * Flarebase JWT Authentication - Node.js Example
 *
 * This example demonstrates how to use Flarebase with JWT authentication
 * in a Node.js environment.
 *
 * Prerequisites:
 * npm install @flarebase/sdk
 */

const { FlareClient } = require('@flarebase/sdk');

// Initialize client
const client = new FlareClient('http://localhost:3000');

async function demonstrateJWTAuthentication() {
    console.log('=== Flarebase JWT Authentication Demo (Node.js) ===\n');

    try {
        // ============================================================
        // 1. User Registration
        // ============================================================
        console.log('1. Registering new user...');
        console.log('   Email: alice@example.com');
        console.log('   Password: ••••••••\n');

        const registerResult = await client.register({
            name: 'Alice Johnson',
            email: 'alice@example.com',
            password: 'secure_password_123'
        });

        console.log('✅ Registration successful!');
        console.log('   User ID:', registerResult.user.id);
        console.log('   Name:', registerResult.user.name);
        console.log('   Email:', registerResult.user.email);
        console.log('   Role:', registerResult.user.role);
        console.log('   Token:', registerResult.token.substring(0, 20) + '...');
        console.log();

        // ============================================================
        // 2. Check Authentication Status
        // ============================================================
        console.log('2. Checking authentication status...');
        console.log('   Is Authenticated:', client.isAuthenticated());
        console.log('   Current User:', client.getCurrentUser().name);
        console.log();

        // ============================================================
        // 3. Create a Document (Authenticated)
        // ============================================================
        console.log('3. Creating a document (authenticated)...');

        const post = await client.collection('posts').add({
            title: 'My First Post',
            content: 'This is my first post using Flarebase with JWT authentication!',
            status: 'published',
            tags: ['flarebase', 'jwt', 'authentication']
        });

        console.log('✅ Document created successfully!');
        console.log('   Document ID:', post.id);
        console.log('   Title:', post.data.title);
        console.log();

        // ============================================================
        // 4. Read Document (Authenticated)
        // ============================================================
        console.log('4. Reading document back...');

        const retrievedPost = await client.collection('posts').doc(post.id).get();

        console.log('✅ Document retrieved successfully!');
        console.log('   Content:', retrievedPost.data.content.substring(0, 50) + '...');
        console.log();

        // ============================================================
        // 5. Execute Named Query (with JWT context)
        // ============================================================
        console.log('5. Executing named query (list_my_posts)...');

        try {
            const myPosts = await client.namedQuery('list_my_posts', {});

            console.log('✅ Query executed successfully!');
            console.log('   Returned posts:', Array.isArray(myPosts) ? myPosts.length : 1);
            console.log();
        } catch (error) {
            console.log('ℹ️  Query may not be configured on server:', error.message);
            console.log();
        }

        // ============================================================
        // 6. Update Document (Authenticated)
        // ============================================================
        console.log('6. Updating document...');

        const updatedPost = await client.collection('posts').doc(post.id).update({
            title: 'My Updated Post',
            content: 'This post has been updated!',
            status: 'published',
            tags: ['flarebase', 'jwt', 'authentication', 'updated']
        });

        console.log('✅ Document updated successfully!');
        console.log('   New title:', updatedPost.data.title);
        console.log('   Version:', updatedPost.version);
        console.log();

        // ============================================================
        // 7. List All Documents in Collection
        // ============================================================
        console.log('7. Listing all posts...');

        const allPosts = await client.collection('posts').get();

        console.log('✅ Retrieved all posts!');
        console.log('   Total posts:', allPosts.length);
        console.log();

        // ============================================================
        // 8. Logout
        // ============================================================
        console.log('8. Logging out...');
        client.logout();
        console.log('✅ Logged out successfully!');
        console.log('   Is Authenticated:', client.isAuthenticated());
        console.log();

        // ============================================================
        // 9. Try to Access Protected Resource (Should Fail)
        // ============================================================
        console.log('9. Attempting to access protected resource without auth...');

        try {
            await client.collection('posts').get();
            console.log('⚠️  Request succeeded (this may happen if server has no auth middleware)');
        } catch (error) {
            console.log('✅ Request correctly rejected!');
            console.log('   Error:', error.message);
        }
        console.log();

        // ============================================================
        // 10. Login Again
        // ============================================================
        console.log('10. Logging in again...');

        const loginResult = await client.login({
            email: 'alice@example.com',
            password: 'secure_password_123'
        });

        console.log('✅ Login successful!');
        console.log('   User:', loginResult.user.name);
        console.log('   Token:', loginResult.token.substring(0, 20) + '...');
        console.log();

        // ============================================================
        // 11. Cleanup (Delete Document)
        // ============================================================
        console.log('11. Cleaning up (deleting test document)...');

        await client.collection('posts').doc(post.id).delete();

        console.log('✅ Document deleted successfully!');
        console.log();

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error();

        if (error.message.includes('connect')) {
            console.error('💡 Make sure the Flarebase server is running on http://localhost:3000');
            console.error('   Run: cargo run -p flare-server');
        } else if (error.message.includes('hook')) {
            console.error('💡 Make sure an auth hook service is registered');
            console.error('   Check server logs for hook registration status');
        }

        process.exit(1);
    }

    console.log('=== Demo completed successfully ===');
}

// Run the demonstration
if (require.main === module) {
    demonstrateJWTAuthentication()
        .then(() => {
            process.exit(0);
        })
        .catch((error) => {
            console.error('Fatal error:', error);
            process.exit(1);
        });
}

// Export for use in other modules
module.exports = {
    demonstrateJWTAuthentication,
    client
};
