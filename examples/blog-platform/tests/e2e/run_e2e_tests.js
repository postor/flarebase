/**
 * E2E Test Orchestrator for Blog Platform
 *
 * Starts from EMPTY DB:
 * 1. Cleans up old data
 * 2. Starts flare-server with fresh DB
 * 3. Starts E2E plugin service
 * 4. Starts server.js (which includes auth plugin integrated)
 * 5. Waits for all services to be ready
 * 6. Runs E2E tests
 * 7. Cleans up
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { promisify } = require('util');

const execAsync = promisify(require('child_process').exec);

// E2E test DB directory (separate from development)
const E2E_DB_DIR = path.join(__dirname, '..', 'data-e2e');

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
  let blogServer = null;

  try {
    await cleanup();

    const FLARE_PORT = await findFreePort();
    const GRPC_PORT = await findFreePort();
    const BLOG_SERVER_PORT = await findFreePort();
    const FLARE_URL = `http://localhost:${FLARE_PORT}`;
    const DB_PATH = path.join(E2E_DB_DIR, `blog_e2e_${FLARE_PORT}.db`);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 BLOG PLATFORM E2E TEST ORCHESTRATOR`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  Flarebase Server:   ${FLARE_URL}`);
    console.log(`  gRPC Port:          ${GRPC_PORT}`);
    console.log(`  Blog Server (HTTP): ${BLOG_SERVER_PORT}`);
    console.log(`  DB Path:            ${DB_PATH}`);
    console.log(`${'='.repeat(60)}\n`);

    // Pre-test cleanup
    await killProcessOnPort(FLARE_PORT);
    await killProcessOnPort(GRPC_PORT);
    await killProcessOnPort(BLOG_SERVER_PORT);

    // 1. Start Flarebase Rust Server
    console.log('📦 Step 1: Starting Flarebase server (empty DB)...');
    const repoRoot = path.join(__dirname, '..', '..', '..', '..'); // tests/e2e -> .. -> tests -> .. -> blog-platform -> .. -> examples -> .. -> flarebase
    const serverBinary = path.join(repoRoot, 'target', 'release', 'flare-server.exe');

    // Fallback to debug build if release doesn't exist
    const finalBinary = fs.existsSync(serverBinary) ? serverBinary : path.join(repoRoot, 'target', 'debug', 'flare-server.exe');

    rustServer = spawn(finalBinary, [], {
      cwd: repoRoot,
      windowsHide: true,
      env: {
        ...process.env,
        FLARE_DB_PATH: DB_PATH,
        HTTP_ADDR: `127.0.0.1:${FLARE_PORT}`,
        GRPC_ADDR: `127.0.0.1:${GRPC_PORT}`,
        NODE_ID: "1",
        FLARE_STORAGE_BACKEND: "redb",
        JWT_SECRET: "e2e_test_secret_key_change_in_production"
      }
    });

    let serverReady = false;
    rustServer.stdout.on('data', d => {
      const text = d.toString();
      process.stdout.write(`[Rust] ${text}`);
      if (text.includes('listening on HTTP') || text.includes('Server started')) {
        serverReady = true;
        console.log('✅ Flarebase server ready');
      }
    });
    rustServer.stderr.on('data', d => process.stderr.write(`[Rust Error] ${d}`));

    // Wait for server
    await waitForPort(FLARE_PORT, 30000);
    console.log('✅ Flarebase server is accepting connections');

    // 2. Start Blog Server (server.js includes auth plugin integrated)
    console.log('🌐 Step 2: Starting Blog server (with integrated auth plugin)...');
    blogServer = spawn('node', ['server.js'], {
      cwd: path.join(__dirname, '..', '..'), // tests/e2e -> .. -> tests -> .. -> blog-platform
      env: {
        ...process.env,
        FLAREBASE_URL: FLARE_URL,
        PORT: String(BLOG_SERVER_PORT),
        NODE_ENV: 'development'
      }
    });

    blogServer.stdout.on('data', d => {
      const text = d.toString();
      if (text.includes('Auth') || text.includes('✅') || text.includes('📡') || text.includes('Ready on')) {
        console.log(`[Blog Server] ${text.trim()}`);
      }
    });
    blogServer.stderr.on('data', d => process.stderr.write(`[Blog Server Error] ${d}`));

    // Wait for blog server readiness
    await waitForPort(BLOG_SERVER_PORT, 30000);
    console.log('✅ Blog server is ready (auth plugin integrated)');

    // Small delay to ensure plugin registration is fully processed
    console.log('⏳ Waiting for plugin registration to propagate...');
    await new Promise(r => setTimeout(r, 3000));

    // 3. Run E2E Tests
    console.log('\n🧪 Step 3: Running E2E tests...\n');
    process.env.FLARE_URL = FLARE_URL;
    process.env.FLAREBASE_URL = FLARE_URL;
    process.env.E2E_TEST_MODE = 'true';

    const isWindows = process.platform === 'win32';
    const vitestCmd = isWindows ? 'cmd' : 'npx';
    const vitestArgs = isWindows
      ? ['/c', 'npx', 'vitest', 'run', 'tests/e2e/blog.test.ts', '--config', 'vitest.e2e.config.js']
      : ['vitest', 'run', 'tests/e2e/blog.test.ts', '--config', 'vitest.e2e.config.js'];

    const vitestCode = await new Promise((resolve) => {
      const vitest = spawn(vitestCmd, vitestArgs, {
        cwd: path.join(__dirname, '..', '..'), // tests/e2e -> .. -> tests -> .. -> blog-platform
        env: {
          ...process.env,
          FLARE_URL: FLARE_URL,
          FLAREBASE_URL: FLARE_URL,
          E2E_TEST_MODE: 'true'
        },
        stdio: 'inherit'
      });

      vitest.on('close', (code) => {
        resolve(code);
      });

      vitest.on('error', (err) => {
        console.error('Vitest spawn error:', err);
        resolve(1);
      });
    });

    if (vitestCode !== 0) {
      throw new Error(`E2E tests failed with code ${vitestCode}`);
    }

    console.log('\n✅ All E2E tests passed!');

  } catch (err) {
    console.error(`\n❌ E2E test failed: ${err.message}`);
    throw err;
  } finally {
    console.log('\n🛑 Cleaning up...');
    if (rustServer) {
      rustServer.kill();
      console.log('  - Flarebase server stopped');
    }
    if (blogServer) {
      blogServer.kill();
      console.log('  - Blog server (with auth plugin) stopped');
    }
    console.log('👋 E2E test run complete.\n');
  }
}

runTests().catch(err => {
  console.error('Fatal E2E error:', err);
  process.exit(1);
});
