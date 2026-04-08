import { describe, it, expect, beforeAll } from 'vitest';
import { FlareClient } from '../src/index.js';

const baseURL = process.env.FLARE_URL || 'http://localhost:3000';
const flare = new FlareClient(baseURL);

describe('Article Flows', () => {
    let articleId;
    let authorId = 'test-author';

    it('should create an article', async () => {
        const article = await flare.collection('articles').add({
            title: 'Hello World',
            content: 'This is my first flarebase article!',
            author_id: authorId,
            published: false
        });

        expect(article.id).toBeDefined();
        expect(article.data.title).toBe('Hello World');
        articleId = article.id;
    });

    it('should modify and publish an article', async () => {
        // 1. Modify
        const updated = await flare.collection('articles').doc(articleId).update({
            title: 'Hello World Updated',
            content: 'Updated content!',
            author_id: authorId,
            published: false
        });
        expect(updated.data.title).toBe('Hello World Updated');

        // 2. Publish
        const published = await flare.collection('articles').doc(articleId).update({
            ...updated.data,
            published: true
        });
        expect(published.data.published).toBe(true);
    });

    it('should browse articles in the lobby (feed)', async () => {
        const feed = await flare.collection('articles')
            .where('published', '==', true)
            .get();
        
        expect(feed).toBeDefined();
        expect(feed.length).toBeGreaterThanOrEqual(1);
    });

    it('should browse my articles', async () => {
        const myArticles = await flare.collection('articles')
            .where('author_id', '==', authorId)
            .get();
        
        expect(myArticles).toBeDefined();
        expect(myArticles.length).toBeGreaterThanOrEqual(1);
        expect(myArticles[0].data.author_id).toBe(authorId);
    });
});
