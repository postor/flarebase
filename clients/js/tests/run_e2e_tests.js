/**
 * E2E Test Orchestrator
 * 
 * Starts from EMPTY DB:
 * 1. Cleans up old data
 * 2. Starts flare-server with fresh DB
 * 3. Starts real E2E plugin service
 * 4. Waits for both to be ready
 * 5. Runs E2E tests
 * 6. Cleans up
 */

import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import net from 'net';
import { promisify } from 'util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execAsync = promisify(exec);

// E2E test DB directory (separate from unit tests)
const E2E_DB_DIR = path.join(__dirname, 'data-e2e');

async function cleanup() {
    console.log('🧹 Cleaning up E2E test data...');
    try {
        if (fs.existsSync(E2E_DB_DIR)) {
            fs.rmSync(E2E_DB_DIR, { recursive: true, force: true, maxRetries: 3 });
        }
        await new Promise(r => setTimeout(r, 100));
        fs.mkdirSync(E2E_DB_DIR, { recursive: true });
    } catch (err) {
        console.warn(`⚠️ Cleanup warning: ${err.message}`);
    }
}

async function findFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(0, () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
        server.on('error', reject);
    });
}

async function waitForPort(port, timeout = 30000) {
    const start = Date.now();
    let attempt = 0;
    while (Date.now() - start < timeout) {
        attempt++;
        try {
            await new Promise((resolve, reject) => {
                const socket = new net.Socket();
                socket.setTimeout(2000);
                socket.once('connect', () => {
                    socket.end();
                    resolve();
                });
                socket.once('error', reject);
                socket.once('timeout', reject);
                socket.connect(port, '127.0.0.1');
            });
            return true;
        } catch (err) {
            await new Promise(r => setTimeout(r, 500));
        }
    }
    throw new Error(`Timeout waiting for port ${port} after ${attempt} attempts`);
}

async function killProcessOnPort(port) {
    if (process.platform === 'win32') {
        try {
            const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
            const lines = stdout.split('\n');
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                const pid = parts[parts.length - 1];
                if (pid && pid !== '0' && !isNaN(pid)) {
                    await execAsync(`taskkill /F /PID ${pid} /T`).catch(() => {});
                }
            }
        } catch (err) {
            // No process on port
        }
    }
}

async function runTests() {
    let rustServer = null;
    let e2ePlugin = null;

    try {
        await cleanup();

        const FLARE_PORT = await findFreePort();
        const GRPC_PORT = await findFreePort();
        const PLUGIN_HTTP_PORT = await findFreePort();
        const FLARE_URL = `http://localhost:${FLARE_PORT}`;
        const DB_PATH = path.join(E2E_DB_DIR, `e2e_${FLARE_PORT}.db`);

        console.log(`\n${'='.repeat(60)}`);
        console.log(`🚀 E2E TEST ORCHESTRATOR`);
        console.log(`${'='.repeat(60)}`);
        console.log(`  Flarebase Server: ${FLARE_URL}`);
        console.log(`  gRPC Port:        ${GRPC_PORT}`);
        console.log(`  Plugin HTTP:      ${PLUGIN_HTTP_PORT}`);
        console.log(`  DB Path:          ${DB_PATH}`);
        console.log(`${'='.repeat(60)}\n`);

        // Pre-test cleanup
        await killProcessOnPort(FLARE_PORT);
        await killProcessOnPort(GRPC_PORT);
        await killProcessOnPort(PLUGIN_HTTP_PORT);

        // 1. Start Flarebase Rust Server
        console.log('📦 Step 1: Starting Flarebase server (empty DB)...');
        const repoRoot = path.join(__dirname, '../../../');
        const serverBinary = path.join(repoRoot, 'target/release/flare-server.exe');
        
        rustServer = exec(serverBinary, {
            cwd: repoRoot,
            windowsHide: true,
            env: {
                ...process.env,
                FLARE_DB_PATH: DB_PATH,
                HTTP_ADDR: `127.0.0.1:${FLARE_PORT}`,
                GRPC_ADDR: `127.0.0.1:${GRPC_PORT}`,
                NODE_ID: "1",
                FLARE_STORAGE_BACKEND: "redb"
            }
        });

        let serverReady = false;
        rustServer.stdout.on('data', d => {
            const text = d.toString();
            process.stdout.write(`[Rust] ${text}`);
            if (text.includes('listening on HTTP')) {
                serverReady = true;
                console.log('✅ Flarebase server ready');
            }
            if (text.includes('Plugin registered') || text.includes('Hook registered')) {
                console.log(`✅ Hook registration detected: ${text.trim()}`);
            }
        });
        rustServer.stderr.on('data', d => process.stderr.write(`[Rust] ${d}`));

        // Wait for server
        await waitForPort(FLARE_PORT, 30000);
        console.log('✅ Flarebase server is accepting connections');

        // 2. Start E2E Plugin Service
        console.log('🔌 Step 2: Starting E2E plugin service...');
        e2ePlugin = exec(`node tests/e2e-plugin.js`, {
            cwd: path.join(__dirname, '..'),
            env: {
                ...process.env,
                FLARE_URL,
                PORT: String(PLUGIN_HTTP_PORT)
            }
        });

        e2ePlugin.stdout.on('data', d => {
            const text = d.toString();
            if (text.includes('E2E Plugin connected') || text.includes('Readiness HTTP server')) {
                console.log(`✅ E2E Plugin: ${text.trim()}`);
            }
        });
        e2ePlugin.stderr.on('data', d => process.stderr.write(`[Plugin Error] ${d}`));

        // Wait for plugin HTTP readiness
        await waitForPort(PLUGIN_HTTP_PORT, 15000);
        console.log('✅ E2E plugin is ready');

        // Small delay to ensure WebSocket registration is fully processed by server
        console.log('⏳ Waiting for plugin registration to propagate...');
        await new Promise(r => setTimeout(r, 3000));

        // 3. Run E2E Tests
        console.log('\n🧪 Step 3: Running E2E tests...\n');
        process.env.FLARE_URL = FLARE_URL;
        process.env.E2E_PLUGIN_HTTP_PORT = String(PLUGIN_HTTP_PORT);
        process.env.E2E_TEST_MODE = 'true';

        return new Promise((resolve, reject) => {
            const vitest = exec(`npx vitest run --config vitest.e2e.config.js`, {
                cwd: path.join(__dirname, '..'),
                env: {
                    ...process.env,
                    FLARE_URL,
                    E2E_PLUGIN_HTTP_PORT: String(PLUGIN_HTTP_PORT),
                    E2E_TEST_MODE: 'true'
                }
            });

            vitest.stdout.pipe(process.stdout);
            vitest.stderr.pipe(process.stderr);

            vitest.on('close', (code) => {
                if (code === 0) {
                    console.log('\n✅ All E2E tests passed!');
                    resolve();
                } else {
                    reject(new Error(`E2E tests failed with code ${code}`));
                }
            });
        });

    } catch (err) {
        console.error(`\n❌ E2E test failed: ${err.message}`);
        throw err;
    } finally {
        console.log('\n🛑 Cleaning up...');
        if (rustServer) {
            rustServer.kill();
            console.log('  - Flarebase server stopped');
        }
        if (e2ePlugin) {
            e2ePlugin.kill();
            console.log('  - E2E plugin stopped');
        }
        console.log('👋 E2E test run complete.\n');
    }
}

runTests().catch(err => {
    console.error('Fatal E2E error:', err);
    process.exit(1);
});
