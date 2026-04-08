import http from 'http';
import { FlareClient } from '../src/index.js';

const FLARE_URL = process.env.FLARE_URL || 'http://localhost:3000';
const flare = new FlareClient(FLARE_URL);

const server = http.createServer(async (req, res) => {
    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const event = JSON.parse(body);
                console.log(`[CustomHook] Received event: ${event.event_type}`);

                if (event.event_type === 'DocCreated' && event.payload.collection === 'verification_requests') {
                    const target = event.payload.data.target;
                    const code = Math.floor(100000 + Math.random() * 900000).toString();
                    
                    console.log(`[CustomHook] Generating code ${code} for ${target}`);

                    // Write back to Flarebase using the client
                    // This mirrors what the internal hook used to do
                    await flare.collection('__internal_verification__').doc(target).update({
                        target,
                        code,
                        expires_at: Date.now() + 300000
                    }).catch(async () => {
                        // If doc doesn't exist, 'update' might fail depending on implementation, 
                        // but our JS client 'update' doesn't have upsert yet.
                        // Actually, let's use a direct add or set if we had it.
                        // For now, our FlareClient.add is for collections.
                        // Let's use the REST API directly or just assume it exists if we created it.
                        // Wait, main.rs: update_doc returns 404 if not found.
                        // So let's try to create it first.
                        await fetch(`${FLARE_URL}/collections/__internal_verification__/${target}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                target,
                                code,
                                expires_at: Date.now() + 300000
                            })
                        });
                    });
                    
                    console.log(`[CustomHook] Code ${code} written to Flarebase`);
                }
                
                res.writeHead(200);
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                console.error('[CustomHook] Error:', err);
                res.writeHead(500);
                res.end(JSON.stringify({ error: err.message }));
            }
        });
    } else {
        res.writeHead(404);
        res.end();
    }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`[CustomHook] Mock Webhook listener running on port ${PORT}`);
});
