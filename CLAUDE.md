# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 📖 Documentation Hub
A comprehensive set of technical documents is available in the [**docs/**](./docs/README.md) directory:
- [Architecture Overview](./docs/core/ARCHITECTURE.md)
- [Security & Permissions](./docs/core/SECURITY.md)
- [Hook Protocol](./docs/features/HOOKS_PROTOCOL.md)
- [Session Synchronization](./docs/features/SESSION_SYNC.md)
- [User & Article Flows](./docs/flows/USER_AND_ARTICLE_FLOWS.md)

## Overview

Flarebase is a distributed document database (Backend-as-a-Service) written in Rust with a JavaScript client SDK. The architecture follows a **"Passive Infrastructure"** pattern where the server provides generic storage capabilities without managing business logic or predefined schemas.

### Key Architecture Principles

- **Generic Storage**: Collections are created on-the-fly. No schema definitions required. (See [Architecture](./docs/core/ARCHITECTURE.md))
- **Event-Driven**: Real-time sync via WebSockets (Socket.IO) and HTTP webhooks.
- **Distributed**: Multi-node cluster with gRPC-based coordination.
- **Client-Driven**: Workflows are implemented client-side using collection operations.

## Workspace Structure

```
flarebase/
├── packages/
│   ├── flare-db/          # Storage layer (Sled embedded DB)
│   ├── flare-server/      # HTTP/WebSocket/gRPC server
│   ├── flare-protocol/    # Shared types and protobuf definitions
│   └── flare-cli/         # CLI tooling
├── clients/js/            # JavaScript SDK
├── docs/                  # Technical documentation hub [NEW]
├── docker/                # Docker deployment configs
└── scripts/               # Utility scripts
```

## Common Development Commands

### Building & Running

```bash
cargo build -p flare-server                      # Build server
cargo run -p flare-server                        # Run server (default ports)
FLARE_DB_PATH=./custom.db cargo run -p flare-server # Custom storage path
```

### Testing

```bash
cargo test -p flare-server                       # Run Rust server tests
cd clients/js && node tests/run_tests.js        # Run full integration suite
```

## Architecture Deep Dive

### Storage Layer (`flare-db`)

- Uses **Sled** as an embedded KV database.
- Each collection maps to a Sled tree. (Details in [Architecture Layer](./docs/core/ARCHITECTURE.md))
- Supports atomic batch operations via `runTransaction`.

### Server Layer (`flare-server`)

- **HTTP API**: RESTful endpoints for documents.
- **WebSocket API**: Socket.IO for subscriptions and Hooks.
- **gRPC API**: Node-to-node heartbeats and coordination.

### Hooks & Webhooks

Flarebase supports two types of external logic integration:

1.  **Webhooks (Stateless)**: HTTP POST callbacks. (Configurations in `__webhooks__`)
2.  **Stateful Hooks (WebSocket)**: Persistent connections in `/hooks`. (See [Hook Protocol](./docs/features/HOOKS_PROTOCOL.md))

### Session-scoped Synchronization

A unique feature for private, real-time data sync per client session.
- Uses `_session_{sid}_` collection prefixing. (See [Session Sync Guide](./docs/features/SESSION_SYNC.md))
- Automatic room-based routing.

### Security & Permissions

Flarebase uses a resource-based authorization model and sync policies.
- **Authorizer**: Programmatic permission checks (See [Security Overview](./docs/core/SECURITY.md)).
- **SyncPolicy**: Field-level data redaction during broadcast.

## Environment Variables

- `NODE_ID`: Node identifier (default: 1)
- `HTTP_ADDR`: HTTP bind (default: "0.0.0.0:3000")
- `GRPC_ADDR`: gRPC bind (default: "0.0.0.0:50051")
- `FLARE_DB_PATH`: DB file path (default: "./flare_{NODE_ID}.db")
