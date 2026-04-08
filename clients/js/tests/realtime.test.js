import { describe, it, expect, beforeAll } from 'vitest';
import { FlareClient } from '../src/index.js';

const baseURL = process.env.FLARE_URL || 'http://localhost:3000';
const flare = new FlareClient(baseURL);

describe('Real-time Subscriptions (onSnapshot)', () => {
    it('should receive real-time updates for document creation', async () => {
        const collectionName = `realtime_${Date.now()}`;
        const results = [];
        
        // 1. Subscribe
        flare.collection(collectionName).onSnapshot((change) => {
            results.push(change);
        });

        // 2. Wait for subscription to establish (Socket.io join room)
        await new Promise(r => setTimeout(r, 500));

        // 3. Create a document
        const testData = { hello: 'world' };
        await flare.collection(collectionName).add(testData);

        // 4. Wait for event
        await new Promise(r => setTimeout(r, 1000));

        expect(results.length).toBeGreaterThanOrEqual(1);
        const added = results.find(r => r.type === 'added');
        expect(added).toBeDefined();
        expect(added.doc.data.hello).toBe('world');
    });

    it('should receive real-time updates for document modifications', async () => {
        const collectionName = `mods_${Date.now()}`;
        const results = [];
        
        const doc = await flare.collection(collectionName).add({ status: 'old' });

        flare.collection(collectionName).onSnapshot((change) => {
            results.push(change);
        });

        await new Promise(r => setTimeout(r, 500));

        // Update the document
        await flare.collection(collectionName).doc(doc.id).update({ status: 'new' });

        await new Promise(r => setTimeout(r, 1000));

        const modified = results.find(r => r.type === 'modified');
        expect(modified).toBeDefined();
        expect(modified.doc.data.status).toBe('new');
    });

    it('should receive real-time updates for document deletions', async () => {
        const collectionName = `deletes_${Date.now()}`;
        const results = [];
        
        const doc = await flare.collection(collectionName).add({ to_be: 'deleted' });

        flare.collection(collectionName).onSnapshot((change) => {
            results.push(change);
        });

        await new Promise(r => setTimeout(r, 500));

        // Delete the document
        await flare.collection(collectionName).doc(doc.id).delete();

        await new Promise(r => setTimeout(r, 1000));

        const removed = results.find(r => r.type === 'removed');
        expect(removed).toBeDefined();
        // Socketioxide might return just ID or full doc, but our Index.js handles both
        expect(removed.id).toBe(doc.id);
    });
});
