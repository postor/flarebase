import { FlareClient, FlareHook } from '../src/index.js';
import { io } from 'socket.io-client';

const FLARE_URL = process.env.FLARE_URL || 'http://localhost:3000';
const flare = new FlareClient(FLARE_URL);

console.log(`[FlareHook] Connecting to ${FLARE_URL}...`);

const hook = new FlareHook(FLARE_URL, 'MOCK_TOKEN', {
    events: ['register_user', 'request_otp'],
    userContext: { role: 'admin', service: 'auth-hook' }
});

// Temporary workaround: Also listen to main namespace for hook_request events
// This is needed because the server emits to the main namespace, not /hooks namespace
const mainNamespaceSocket = io(FLARE_URL);

mainNamespaceSocket.on('connect', () => {
    console.log('[FlareHook] Also connected to main namespace for workaround, socket ID:', mainNamespaceSocket.id);

    // Get the hook socket ID from the /hooks namespace
    hook.socket.on('connect', () => {
        const hookSocketId = hook.socket.id;
        console.log('[FlareHook] Hook socket ID:', hookSocketId);

        // Join the same room as the hook socket in the main namespace
        const globalHookRoom = `global_hook_${hookSocketId}`;
        console.log('[FlareHook] Joining room in main namespace:', globalHookRoom);

        // Register as a hook in the main namespace with the same socket ID
        mainNamespaceSocket.emit('register', {
            token: 'MAIN_NAMESPACE_TOKEN',
            capabilities: {
                events: ['register_user', 'request_otp'],
                user_context: { role: 'admin', service: 'auth-hook-main' }
            }
        });
    });
});

mainNamespaceSocket.on('hook_request', async (req) => {
    console.log('[FlareHook] Received hook_request in main namespace:', req);
    if (req.event_name === 'request_otp') {
        try {
            const { params } = req;
            const { email } = params;

            console.log(`[FlareHook] Processing request_otp for ${email}`);
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            console.log(`[FlareHook] Generated OTP: ${otp}`);

            // Store OTP in a private table
            await flare.collection('_internal_otps').add({
                email,
                otp,
                created_at: Date.now(),
                expires_at: Date.now() + 300000,
                used: false
            });

            // Update session table to notify client
            await flare.collection(`_session_${req.session_id}_otp_status`).add({
                status: 'sent',
                email
            });

            mainNamespaceSocket.emit('hook_response', {
                request_id: req.request_id,
                status: 'success',
                data: { success: true }
            });
            console.log('[FlareHook] Sent success response for request_otp');
        } catch (error) {
            console.error('[FlareHook] Error in request_otp:', error);
            mainNamespaceSocket.emit('hook_response', {
                request_id: req.request_id,
                status: 'error',
                error: error.message
            });
        }
    } else if (req.event_name === 'register_user') {
        try {
            const { params } = req;
            const { email, otp, password } = params;

            console.log(`[FlareHook] Processing register_user for ${email}`);

            // Verify OTP
            const otps = await flare.query('_internal_otps', [['email', { Eq: email }]]);
            const validOtp = otps.find(o => o.data.otp === otp && !o.data.used && o.data.expires_at > Date.now());

            if (!validOtp) {
                throw new Error('Invalid or expired OTP');
            }

            // Create user with hashed password
            const user = await flare.collection('users').add({
                email,
                hashed_password: 'hashed_' + password, // Mock hash
                created_at: Date.now()
            });

            // Mark OTP as used
            await flare.collection('_internal_otps').doc(validOtp.id).update({
                used: true,
                used_at: Date.now()
            });

            // Update registration status in session table
            await flare.collection(`_session_${req.session_id}_reg_status`).add({
                status: 'success',
                account_id: user.id
            });

            mainNamespaceSocket.emit('hook_response', {
                request_id: req.request_id,
                status: 'success',
                data: { success: true, account_id: user.id }
            });
            console.log('[FlareHook] Sent success response for register_user');
        } catch (error) {
            console.error('[FlareHook] Error in register_user:', error);
            mainNamespaceSocket.emit('hook_response', {
                request_id: req.request_id,
                status: 'error',
                error: error.message
            });
        }
    }
});

hook.on('request_otp', async (req) => {
    const { sessionId, params } = req;
    const { email } = params;

    console.log(`[FlareHook] Received request_otp in /hooks namespace for ${email}, sessionId: ${sessionId}`);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    console.log(`[FlareHook] Generated OTP: ${otp}`);

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
