import { spawn, exec } from 'child_process';
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

async function killProcessTree(proc) {
    if (!proc || !proc.pid) return;
    if (process.platform === 'win32') {
        try {
            await execAsync(`taskkill /pid ${proc.pid} /T /F`);
        } catch (err) {
            // Might already be dead
        }
    } else {
        proc.kill();
    }
}

async function runCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        console.log(`🏃 Running: ${command} ${args.join(' ')}`);
        const proc = spawn(command, args, { 
            stdio: 'inherit',
            shell: true,
            ...options 
        });
        
        proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`${command} exited with code ${code}`));
        });
        
        proc.on('error', reject);
    });
}

async function main() {
    await cleanup();

    const FLARE_PORT = await findFreePort();
    const HOOK_PORT = await findFreePort();
    const FLARE_URL = `http://localhost:${FLARE_PORT}`;
    const HOOK_URL = `http://localhost:${HOOK_PORT}`;
    const DB_PATH = path.join(DB_DIR, `flare_${FLARE_PORT}.db`);

    console.log(`📌 Using dynamic ports: Flarebase=${FLARE_PORT}, Hook=${HOOK_PORT}`);

    console.log('🚀 Starting Flarebase Rust Server...');
    const rustServer = spawn('cargo', ['run'], {
        cwd: path.join(__dirname, '../../packages/flare-server'),
        env: {
            ...process.env,
            FLARE_DB_PATH: DB_PATH,
            HTTP_ADDR: `0.0.0.0:${FLARE_PORT}`,
            NODE_ID: "1"
        },
        stdio: 'inherit',
        shell: true
    });

    console.log('🚀 Starting Custom Hook Mock...');
    const customHook = spawn('node', ['tests/custom-hook.js'], {
        cwd: path.join(__dirname, '..'),
        env: {
            ...process.env,
            PORT: HOOK_PORT,
            FLARE_URL: FLARE_URL
        },
        stdio: 'inherit',
        shell: true
    });

    try {
        console.log('⏳ Waiting for servers to be ready...');
        await Promise.all([
            waitForPort(FLARE_PORT),
            waitForPort(HOOK_PORT)
        ]);
        console.log('✅ Servers are ready!');

        console.log('🧪 Running tests...');
        await runCommand('npx', ['vitest', 'run'], { 
            cwd: path.join(__dirname, '..'),
            env: {
                ...process.env,
                FLARE_URL: FLARE_URL,
                HOOK_URL: HOOK_URL
            }
        });
        console.log('✅ All tests passed!');
    } catch (err) {
        console.error('❌ Error during test run:', err.message);
        process.exitCode = 1;
    } finally {
        console.log('🛑 Shutting down servers...');
        await Promise.all([
            killProcessTree(rustServer),
            killProcessTree(customHook)
        ]);
        console.log('👋 Done.');
        process.exit();
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
