import { describe, it, expect, beforeAll } from 'vitest';
import { FlareClient } from '../src/index.js';

const baseURL = process.env.FLARE_URL || 'http://localhost:3000';
const flare = new FlareClient(baseURL);

describe('Transactions and Batched Writes', () => {
    it('should perform a successful WriteBatch', async () => {
        const batch = flare.batch();
        const collection = 'batch_collection';
        
        const doc1 = flare.collection(collection).doc('id1');
        const doc2 = flare.collection(collection).doc('id2');

        batch.set(doc1, { foo: 'bar' });
        batch.set(doc2, { baz: 'qux' });
        
        const result = await batch.commit();
        expect(result).toBe(true);

        const res1 = await doc1.get();
        const res2 = await doc2.get();

        expect(res1.data.foo).toBe('bar');
        expect(res2.data.baz).toBe('qux');
    });

    it('should perform a simple transaction', async () => {
        const counterDoc = flare.collection('stats').doc('counter');
        await counterDoc.update({ value: 10 }).catch(async () => {
            // If it doesn't exist, create it (main.rs PUT returns 404)
            await fetch(`${baseURL}/collections/stats/counter`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ value: 10 })
            });
        });

        await flare.runTransaction(async (transaction) => {
            const doc = await transaction.get(counterDoc);
            const newValue = doc.data.value + 5;
            transaction.update(counterDoc, { value: newValue });
        });

        const updated = await counterDoc.get();
        expect(updated.data.value).toBe(15);
    });

    it('should handle batch deletions and updates together', async () => {
        const col = 'mixed_batch';
        const d1 = await flare.collection(col).add({ name: 'to_delete' });
        const d2 = await flare.collection(col).add({ name: 'to_update' });

        const batch = flare.batch();
        batch.delete(flare.collection(col).doc(d1.id));
        batch.update(flare.collection(col).doc(d2.id), { name: 'updated' });

        await batch.commit();

        const res1 = await flare.collection(col).doc(d1.id).get();
        const res2 = await flare.collection(col).doc(d2.id).get();

        expect(res1).toBeNull();
        expect(res2.data.name).toBe('updated');
    });
});
