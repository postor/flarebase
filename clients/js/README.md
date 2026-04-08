# Flarebase JS SDK

High-performance, real-time JavaScript SDK for the Flarebase distributed document infrastructure.

## Architectural Philosophy

Flarebase is a **Passive Infrastructure** (BaaS) designed to reach "Zero-Backend" development. 

- **Generic Storage**: The server does NOT manage business logic or predefined schemas. It provides generic collection-based CRUD and Query capabilities.
- **Dynamic Collections**: Collections (like `users`, `items`, `posts`) are created on-the-fly when the client interacts with them. There is no need to define tables or schemas on the server.
- **Client-Driven**: Business flows (like Registration, Article Moderation, etc.) are implemented on the client via generic collection operations.
- **Event-Driven**: The server provides real-time event synchronization (WebSockets) and Webhooks to allow external services to react to data changes.

## Installation

```bash
npm install @flarebase/client
```

## Usage

### Initialization
```javascript
import { FlareClient } from '@flarebase/client';

const flare = new FlareClient('http://localhost:3000');
```

### Generic Document Operations
Flarebase treats all data as generic documents in collections.

```javascript
// Create
const doc = await flare.collection('articles').add({ title: 'Hello', published: false });

// Update
await flare.collection('articles').doc(doc.id).update({ published: true });

// Query
const articles = await flare.collection('articles')
    .where('published', '==', true)
    .get();
```

### Real-time Sync (Snapshots)
Implement a reactive UI by listening to collection changes directly.

```javascript
flare.collection('articles').onSnapshot((change) => {
    console.log(`${change.type}:`, change.doc || change.id);
});
```

## User Workflows (Example)

In a Firebase-like architecture, complex workflows are built using generic collections.

### Registration Flow
1. **Request Code**: Create a document in `verification_requests`.
2. **Infrastructure Hook**: A server-side hook (or external worker) reacts to the write, generates a code, and sends it (mocked in this repo).
3. **Register**: Write user data to `users` collection after verifying the code.

```javascript
// 1. Request OTP
await flare.auth.requestVerificationCode('bob@example.com');

// 2. Mock Hook generates code (e.g., '123456')

// 3. Register User
await flare.auth.register({ 
    username: 'bob@example.com', 
    name: 'Bob' 
}, '123456');
```

## Architecture Summary

| Component | Responsibility |
| --- | --- |
| **Flare Server** | Distributed Storage (Sled/Raft), Real-time Pub/Sub, Generic Query. |
| **JS Client** | Data interaction, State management, Reactive UI updates. |
| **Hooks/Triggers** | Side-effects, third-party integrations, validation. |
