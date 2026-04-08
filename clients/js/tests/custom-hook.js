import { FlareClient, FlareHook } from '../src/index.js';

const FLARE_URL = process.env.FLARE_URL || 'http://localhost:3000';
const flare = new FlareClient(FLARE_URL);

console.log(`[FlareHook] Connecting to ${FLARE_URL}...`);

const hook = new FlareHook(FLARE_URL, 'MOCK_TOKEN', {
    events: ['register_user', 'request_otp'],
    userContext: { role: 'admin', service: 'auth-hook' }
});

hook.on('request_otp', async (req) => {
    const { sessionId, params } = req;
    const { email } = params;
    
    console.log(`[FlareHook] Generating OTP for ${email}`);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Store OTP in a private table
    await flare.collection('_internal_otps').add({
        email,
        otp,
        expires_at: Date.now() + 300000
    });

    // Update session table to notify client
    await flare.collection(`_session_${sessionId}_otp_status`).add({
        status: 'sent',
        email
    });

    return { success: true };
});

hook.on('register_user', async (req) => {
    const { sessionId, params } = req;
    const { email, otp, password } = params;

    console.log(`[FlareHook] Attempting registration for ${email}`);

    // Verify OTP
    const otps = await flare.query('_internal_otps', [['email', { Eq: email }]]);
    const validOtp = otps.find(o => o.data.otp === otp && o.data.expires_at > Date.now());

    if (!validOtp) {
        throw new Error('Invalid or expired OTP');
    }

    // Create user with hashed password
    const user = await flare.collection('users').add({
        email,
        hashed_password: 'hashed_' + password, // Mock hash
        created_at: Date.now()
    });

    // Update registration status in session table
    await flare.collection(`_session_${sessionId}_reg_status`).add({
        status: 'success',
        account_id: user.id
    });

    return { success: true, account_id: user.id };
});

console.log('[FlareHook] Hook service is active and listening for events.');

// Add a dummy HTTP server for readiness check by run_tests.js
import http from 'http';
const PORT = process.env.PORT || 3001;
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Hook is ready');
}).listen(PORT, () => {
    console.log(`[FlareHook] Readiness HTTP server running on port ${PORT}`);
});
