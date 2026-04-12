const express = require('express');
const { createServer } = require('http');
const next = require('next');
const { Server } = require('socket.io');
const cors = require('cors');
const { io: ioClient } = require('socket.io-client');
const { startAuthPlugin } = require('./src/lib/auth-plugin');

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = parseInt(process.env.PORT, 10) || 3001;

const FLAREBASE_URL = process.env.FLAREBASE_URL || 'http://localhost:3000';

// Initialize Next.js app
const nextApp = next({ dev, hostname, port });
const nextHandler = nextApp.getRequestHandler();

async function startServer() {
  await nextApp.prepare();

  const app = express();
  const httpServer = createServer(app);

  // Configure Socket.IO for client connections
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Start auth plugin (connect to Flarebase /plugins namespace and handle auth)
  let flarebasePlugins = null;
  try {
    console.log('🔌 Attempting to connect auth plugin to Flarebase...');
    flarebasePlugins = await startAuthPlugin(FLAREBASE_URL);
    console.log('✅ Auth plugin connected successfully');
  } catch (error) {
    console.warn('⚠️  Auth Plugin failed to connect, server will continue without it:', error.message);
  }

  // Connect to Flarebase for real-time event forwarding (read-only, no hooks)
  let flarebaseSocket = null;

  function connectToFlarebase() {
    console.log('📡 Connecting to Flarebase for real-time events...');
    flarebaseSocket = ioClient(FLAREBASE_URL);

    flarebaseSocket.on('connect', () => {
      console.log('✅ Connected to Flarebase:', FLAREBASE_URL);
      console.log('  Socket ID:', flarebaseSocket.id);

      // Subscribe to real-time updates for forwarding to clients
      flarebaseSocket.emit('subscribe', 'users');
      flarebaseSocket.emit('subscribe', 'posts');
      flarebaseSocket.emit('subscribe', 'comments');
      console.log('  Subscribed to: users, posts, comments');
    });

    flarebaseSocket.on('disconnect', () => {
      console.log('❌ Disconnected from Flarebase');
    });

    flarebaseSocket.on('connect_error', (err) => {
      console.error('❌ Flarebase connection error:', err.message);
    });

    // Listen for Flarebase events and forward to clients
    flarebaseSocket.on('doc_created', (doc) => {
      console.log('📄 Document created:', doc.collection, doc.id);
      io.emit('flarebase:doc_created', doc);
    });

    flarebaseSocket.on('doc_updated', (doc) => {
      console.log('📝 Document updated:', doc.collection, doc.id);
      io.emit('flarebase:doc_updated', doc);
    });

    flarebaseSocket.on('doc_deleted', (payload) => {
      console.log('🗑️  Document deleted:', payload.collection, payload.id);
      io.emit('flarebase:doc_deleted', payload);
    });
  }

  connectToFlarebase();

  // Client Socket.IO connection handler
  io.on('connection', (socket) => {
    console.log(`🔗 Client connected: ${socket.id}`);
    console.log(`  Transport: ${socket.conn.transport.name}`);
    console.log(`  Rooms: ${JSON.stringify([...socket.rooms])}`);

    // Forward client subscriptions to Flarebase
    socket.on('subscribe', (collection) => {
      console.log(`📡 Client ${socket.id} subscribing to: ${collection}`);
      if (flarebaseSocket && flarebaseSocket.connected) {
        flarebaseSocket.emit('subscribe', collection);
      }
      socket.join(`collection:${collection}`);
    });

    // Forward client unsubscriptions
    socket.on('unsubscribe', (collection) => {
      console.log(`📡 Client ${socket.id} unsubscribing from: ${collection}`);
      if (flarebaseSocket && flarebaseSocket.connected) {
        flarebaseSocket.emit('unsubscribe', collection);
      }
      socket.leave(`collection:${collection}`);
    });

    // Handle client disconnection
    socket.on('disconnect', (reason) => {
      console.log(`🔌 Client disconnected: ${socket.id} (reason: ${reason})`);
    });
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      flarebase: {
        connected: flarebaseSocket ? flarebaseSocket.connected : false,
        url: FLAREBASE_URL,
        authPlugin: flarebasePlugins ? flarebasePlugins.connected : false
      }
    });
  });

  // Flarebase proxy endpoint (for direct client access if needed)
  // 🔒 SECURITY: Add permission checks for write operations
  app.use('/flarebase', async (req, res) => {
    try {
      const { method, url, headers, body } = req;
      const urlObj = new URL(url, `http://localhost:${req.socket.localPort}${url}`);

      // Extract collection and document ID from URL
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      const collection = pathParts[1]; // /flarebase/collections/:collection/:id
      const docId = pathParts[2];

      // 🔒 SECURITY CHECK: Write operations require authentication
      if (['POST', 'PUT', 'DELETE'].includes(method)) {
        const authHeader = headers['authorization'];

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({
            error: 'Authentication required',
            message: 'You must be logged in to perform this operation'
          });
        }

        // Parse token and check permissions
        const token = authHeader.substring(7); // Remove 'Bearer '
        const [userId, userRole, userEmail] = token.split(':');

        // For DELETE operations, check ownership
        if (method === 'DELETE' && docId && collection) {
          try {
            // Fetch the document to check ownership
            const docResponse = await fetch(`${FLAREBASE_URL}/collections/${collection}/${docId}`);
            if (docResponse.ok) {
              const doc = await docResponse.json();

              // Check if user owns this document or is admin
              const authorId = doc.data?.author_id || doc.data?.owner_id;
              if (authorId && authorId !== userId && userRole !== 'admin') {
                console.log(`🚨 SECURITY: User ${userId} attempted to delete document owned by ${authorId}`);
                return res.status(403).json({
                  error: 'Permission denied',
                  message: 'You can only delete your own documents',
                  user_id: userId,
                  document_owner: authorId
                });
              }
            }
          } catch (error) {
            console.error('Error checking document ownership:', error);
          }
        }

        // For PUT operations, check ownership and prevent author changes
        if (method === 'PUT' && docId && collection) {
          try {
            const docResponse = await fetch(`${FLAREBASE_URL}/collections/${collection}/${docId}`);
            if (docResponse.ok) {
              const currentDoc = await docResponse.json();

              // Parse body - Express has already parsed it as an object
              let updates = {};
              if (req.body && typeof req.body === 'object') {
                updates = req.body;
              } else if (typeof req.body === 'string') {
                try {
                  updates = JSON.parse(req.body);
                } catch (e) {
                  console.error('Failed to parse request body:', e);
                  updates = {};
                }
              }

              console.log(`🔒 PUT request for ${collection}/${docId} by user ${userId}`);
              console.log('   Current doc author:', currentDoc.data?.author_id);
              console.log('   Updates:', updates);

              // Check ownership
              const authorId = currentDoc.data?.author_id || currentDoc.data?.owner_id;
              if (authorId && authorId !== userId && userRole !== 'admin') {
                console.log(`🚨 SECURITY: User ${userId} attempted to modify document owned by ${authorId}`);
                return res.status(403).json({
                  error: 'Permission denied',
                  message: 'You can only modify your own documents'
                });
              }

              // Prevent changing author_id (CRITICAL SECURITY CHECK)
              if (updates.author_id && updates.author_id !== authorId) {
                console.log(`🚨 SECURITY: Attempt to change author_id from ${authorId} to ${updates.author_id}`);
                return res.status(403).json({
                  error: 'Invalid update',
                  message: 'Cannot change document author'
                });
              }
            }
          } catch (error) {
            console.error('Error checking update permissions:', error);
          }
        }

        // Log write operations for audit
        console.log(`🔒 ${method} ${urlObj.pathname} - User: ${userId} (${userRole})`);
      }

      const flarebaseRes = await fetch(`${FLAREBASE_URL}${url}`, {
        method,
        headers,
        body: method !== 'GET' ? JSON.stringify(req.body) : undefined
      });

      const data = await flarebaseRes.json();
      res.status(flarebaseRes.status).json(data);
    } catch (error) {
      console.error('Error in Flarebase proxy:', error);
      res.status(500).json({ error: 'Proxy error' });
    }
  });

  // Handle all other routes with Next.js
  app.use((req, res) => {
    return nextHandler(req, res);
  });

  // Start server
  httpServer
    .once('error', (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
      console.log(`> Flarebase URL: ${FLAREBASE_URL}`);
    });
}

startServer().catch((err) => {
  console.error('Error starting server:', err);
  process.exit(1);
});
