import http from 'http';

const db = {
    users: {},
    articles: {},
    __internal_verification__: {}
};

const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const path = url.pathname;
        const jsonBody = body ? JSON.parse(body) : {};

        // Route: /auth/request_verification
        if (path === '/auth/request_verification' && req.method === 'POST') {
            const target = jsonBody.target;
            const code = '123456'; // Constant for testing
            db.__internal_verification__[target] = {
                id: target,
                collection: '__internal_verification__',
                data: {
                    target,
                    code,
                    expires_at: Date.now() + 300000
                }
            };
            res.end(JSON.stringify(true));
            return;
        }

        // Route: /query
        if (path === '/query' && req.method === 'POST') {
            const { collection, filters } = jsonBody;
            let results = Object.values(db[collection] || {});
            
            if (filters && filters.length > 0) {
                results = results.filter(doc => {
                    return filters.every(([field, op]) => {
                        const val = doc.data[field];
                        if (op.Eq !== undefined) return val === op.Eq;
                        return true;
                    });
                });
            }
            res.end(JSON.stringify(results));
            return;
        }

        // Route: /collections/:collection
        const listMatch = path.match(/^\/collections\/([^/]+)$/);
        if (listMatch) {
            const collection = listMatch[1];
            if (req.method === 'GET') {
                res.end(JSON.stringify(Object.values(db[collection] || {})));
            } else if (req.method === 'POST') {
                const id = Math.random().toString(36).substr(2, 9);
                const doc = {
                    id,
                    collection,
                    data: jsonBody,
                    version: 1,
                    updated_at: Date.now()
                };
                if (!db[collection]) db[collection] = {};
                db[collection][id] = doc;
                res.end(JSON.stringify(doc));
            }
            return;
        }

        // Route: /collections/:collection/:id
        const docMatch = path.match(/^\/collections\/([^/]+)\/([^/]+)$/);
        if (docMatch) {
            const collection = docMatch[1];
            const id = docMatch[2];
            if (req.method === 'GET') {
                res.end(JSON.stringify(db[collection]?.[id] || null));
            } else if (req.method === 'PUT') {
                if (db[collection]?.[id]) {
                    db[collection][id].data = jsonBody;
                    db[collection][id].version++;
                    db[collection][id].updated_at = Date.now();
                    res.end(JSON.stringify(db[collection][id]));
                } else {
                    res.writeHead(404);
                    res.end(JSON.stringify({ error: 'Not found' }));
                }
            } else if (req.method === 'DELETE') {
                if (db[collection]?.[id]) {
                    delete db[collection][id];
                    res.end(JSON.stringify(true));
                } else {
                    res.end(JSON.stringify(false));
                }
            }
            return;
        }

        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
    });
});

const port = 3000;
server.listen(port, () => {
    console.log(`Mock Flarebase Server running at http://localhost:${port}`);
});
