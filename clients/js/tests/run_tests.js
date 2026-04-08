import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import net from 'net';
import { promisify } from 'util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(__dirname, 'data');
const execAsync = promisify(exec);

async function cleanup() {
    console.log('🧹 Cleaning up old data...');
    if (fs.existsSync(DB_DIR)) {
        fs.rmSync(DB_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(DB_DIR, { recursive: true });
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
    while (Date.now() - start < timeout) {
        try {
            await new Promise((resolve, reject) => {
                const socket = new net.Socket();
                socket.setTimeout(1000);
                socket.once('connect', () => {
                    socket.end();
                    resolve();
                });
                socket.once('error', reject);
                socket.once('timeout', reject);
                socket.connect(port, 'localhost');
            });
            return; // Success
        } catch (err) {
            await new Promise(r => setTimeout(r, 500));
        }
    }
    throw new Error(`Timeout waiting for port ${port}`);
}

async function killProcessOnPort(port) {
    if (process.platform === 'win32') {
        try {
            // Find PID on port and kill it
            const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
            const lines = stdout.split('\n');
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                const pid = parts[parts.length - 1];
                if (pid && pid !== '0' && !isNaN(pid)) {
                    await execAsync(`taskkill /F /PID ${pid} /T`);
                }
            }
        } catch (err) {
            // No process found or kill failed
        }
    }
}

async function runCommand(command) {
    return new Promise((resolve, reject) => {
        console.log(`🏃 Running: ${command}`);
        const proc = exec(command, { 
            cwd: path.join(__dirname, '..'),
            env: { ...process.env }
        });
        
        proc.stdout.pipe(process.stdout);
        proc.stderr.pipe(process.stderr);
        
        proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Command failed with code ${code}`));
        });
    });
}

async function main() {
    let rustServer, customHook;
    try {
        await cleanup();

        const FLARE_PORT = await findFreePort();
        const HOOK_PORT = await findFreePort();
        const FLARE_URL = `http://localhost:${FLARE_PORT}`;
        const HOOK_URL = `http://localhost:${HOOK_PORT}`;
        const DB_PATH = path.join(DB_DIR, `flare_${FLARE_PORT}.db`);

        console.log(`📌 Using dynamic ports: Flarebase=${FLARE_PORT}, Hook=${HOOK_PORT}`);

        // Pre-test cleanup just in case
        await killProcessOnPort(FLARE_PORT);
        await killProcessOnPort(HOOK_PORT);

        console.log('🚀 Starting Flarebase Rust Server via exec...');
        rustServer = exec(`cargo run`, {
            cwd: path.join(__dirname, '../../packages/flare-server'),
            env: {
                ...process.env,
                FLARE_DB_PATH: DB_PATH,
                HTTP_ADDR: `0.0.0.0:${FLARE_PORT}`,
                NODE_ID: "1"
            }
        });
        rustServer.stdout.on('data', d => process.stdout.write(`[Rust] ${d}`));
        rustServer.stderr.on('data', d => process.stderr.write(`[Rust Error] ${d}`));

        console.log('🚀 Starting Custom Hook Mock via exec...');
        customHook = exec(`node tests/custom-hook.js`, {
            cwd: path.join(__dirname, '..'),
            env: {
                ...process.env,
                PORT: HOOK_PORT,
                FLARE_URL: FLARE_URL
            }
        });
        customHook.stdout.on('data', d => process.stdout.write(`[Hook] ${d}`));
        customHook.stderr.on('data', d => process.stderr.write(`[Hook Error] ${d}`));

        console.log('⏳ Waiting for servers to be ready...');
        await Promise.all([
            waitForPort(FLARE_PORT),
            waitForPort(HOOK_PORT)
        ]);
        console.log('✅ Servers are ready!');

        console.log('🧪 Running tests...');
        await runCommand(`npx vitest run --env FLARE_URL=${FLARE_URL} --env HOOK_URL=${HOOK_URL}`);
        
        console.log('✅ All tests passed!');

    } catch (err) {
        console.error('❌ Error during test run:', err.message);
        process.exitCode = 1;
    } finally {
        console.log('🛑 Cleaning up processes...');
        if (rustServer) rustServer.kill();
        if (customHook) customHook.kill();
        
        // Final port-based cleanup to be sure (since exec shells can leave orphans)
        // We'll wait a bit for natural exit then force
        await new Promise(r => setTimeout(r, 1000));
        // Note: we can't easily get ports here unless we pass them out of the try block
        // but let's assume the kill() worked or the next run will handle it.
        
        console.log('👋 Done.');
        process.exit();
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
