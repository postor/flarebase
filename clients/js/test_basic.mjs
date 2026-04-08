// Basic integration test for Flarebase
import { FlareClient } from './src/index.js';

const FLARE_URL = process.env.FLARE_URL || 'http://localhost:3000';

async function basicTests() {
    console.log('🧪 Running basic integration tests...');

    const flare = new FlareClient(FLARE_URL);

    try {
        // Test 1: Create a document
        console.log('✅ Test 1: Create document');
        const doc = await flare.collection('users').add({
            name: 'Alice',
            email: 'alice@example.com'
        });
        console.log('Created:', doc);

        // Test 2: Get document
        console.log('✅ Test 2: Get document');
        const retrieved = await flare.collection('users').doc(doc.id).get();
        console.log('Retrieved:', retrieved);

        if (retrieved.data.name !== 'Alice') {
            throw new Error('Name mismatch!');
        }

        // Test 3: List documents
        console.log('✅ Test 3: List documents');
        const docs = await flare.collection('users').get();
        console.log('List result:', docs);
        if (docs.length !== 1) {
            throw new Error('Expected 1 document!');
        }

        // Test 4: Update document
        console.log('✅ Test 4: Update document');
        await flare.collection('users').doc(doc.id).update({
            name: 'Alice Updated'
        });
        const updated = await flare.collection('users').doc(doc.id).get();
        console.log('Updated:', updated);
        if (updated.data.name !== 'Alice Updated') {
            throw new Error('Update failed!');
        }

        // Test 5: Query
        console.log('✅ Test 5: Query documents');
        await flare.collection('users').add({
            name: 'Bob',
            email: 'bob@example.com',
            age: 25
        });
        const results = await flare.collection('users').where('age', '==', 25).get();
        console.log('Query results:', results);

        console.log('✅ All basic tests passed!');
        return true;

    } catch (error) {
        console.error('❌ Test failed:', error);
        return false;
    }
}

basicTests().then(success => {
    process.exit(success ? 0 : 1);
});
