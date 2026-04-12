# Flarebase - QWEN.md

## Project Overview

**Flarebase** is a distributed document database (Backend-as-a-Service) written in Rust with JavaScript/TypeScript client SDKs. It provides real-time data synchronization, custom plugin integration, and secure query execution.

### Core Architecture

- **Storage Layer** (`flare-db`): Embedded document storage using Sled/Redb
- **Server Layer** (`flare-server`): HTTP REST API + WebSocket (Socket.IO) + gRPC cluster coordination
- **Protocol** (`flare-protocol`): Shared types and protobuf definitions
- **CLI** (`flare-cli`): Command-line tooling

### Key Features

1. **WebSocket-First Realtime Sync**: Client subscriptions via Socket.IO with room-based routing
2. **REST for SSR/SWR**: Named queries for server-side rendering and React SWR patterns
3. **Custom Plugins**: WebSocket-based external business logic (replaces webhooks)
4. **Session-Scoped Collections**: Private real-time data per client session (`_session_{sid}_*`)
5. **Security Layers**: JWT authentication, whitelist queries, field-level redaction

## Workspace Structure

```
flarebase/
├── packages/
│   ├── flare-db/          # Storage layer (Sled + Redb embedded DB)
│   ├── flare-server/      # HTTP/WebSocket/gRPC server (Axum + Socket.IO)
│   ├── flare-protocol/    # Shared types and protobuf definitions
│   └── flare-cli/         # CLI tooling
├── clients/               # JavaScript/TypeScript SDKs
├── docs/                  # Technical documentation hub
│   ├── architecture/      # System design documents
│   ├── guides/            # Usage guides and patterns
│   ├── reference/         # API references
│   ├── security/          # Security documentation
│   └── operations/        # Testing and operations
├── docker/                # Docker deployment configs
├── scripts/               # Utility scripts
└── examples/              # Example projects
```

## Building and Running

### Prerequisites

- Rust (latest stable)
- Node.js (for client SDKs)

### Build Commands

```bash
# Build entire workspace
cargo build

# Build specific packages
cargo build -p flare-server
cargo build -p flare-db
cargo build -p flare-protocol

# Release build
cargo build --release
```

### Running the Server

```bash
# Run with defaults (HTTP: 3000, gRPC: 50051)
cargo run -p flare-server

# Custom configuration
NODE_ID=1 HTTP_ADDR="0.0.0.0:3000" GRPC_ADDR="0.0.0.0:50051" cargo run -p flare-server

# Custom database path
FLARE_DB_PATH="./custom.db" cargo run -p flare-server

# Memory storage backend
FLARE_STORAGE_BACKEND=memory cargo run -p flare-server
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ID` | `1` | Node identifier for cluster |
| `HTTP_ADDR` | `0.0.0.0:3000` | HTTP bind address |
| `GRPC_ADDR` | `0.0.0.0:50051` | gRPC bind address |
| `FLARE_DB_PATH` | `./flare_{NODE_ID}.db` | Database file path |
| `FLARE_STORAGE_BACKEND` | `redb` | Storage backend: `memory`, `sled`, `redb` |
| `FLARE_MEMORY_SNAPSHOT_PATH` | `./flare_{NODE_ID}_memory.json` | Memory snapshot path |
| `FLARE_MEMORY_SNAPSHOT_INTERVAL` | `60` | Snapshot interval (seconds) |
| `WHITELIST_CONFIG_PATH` | `named_queries.json` | Named queries config |
| `JWT_SECRET` | (required) | JWT signing secret |

### Testing

```bash
# Run all tests
cargo test

# Run server tests
cargo test -p flare-server

# Run specific module tests
cargo test jwt_middleware --lib
cargo test hook_manager --lib
cargo test whitelist --lib

# Run integration tests
cargo test --test auth_hook_integration_tests
cargo test --test cors_integration_tests

# Run with output
cargo test --lib -- --nocapture

# Run specific test
cargo test test_generate_and_validate_token
```

## Development Conventions

### TDD (Test-Driven Development)

**CRITICAL**: All features MUST follow TDD workflow:

1. **Write tests FIRST** (Red phase) - Tests should fail initially
2. **Implement minimal code** (Green phase) - Make tests pass
3. **Refactor** - Improve code quality while tests pass

### Test Structure Requirements

**Unit Tests** (inline in modules):
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_functionality() {
        // Arrange
        let input = "test";

        // Act
        let result = process(input);

        // Assert
        assert_eq!(result, "expected");
    }

    #[tokio::test]
    async fn test_async_operation() {
        let result = async_function().await;
        assert!(result.is_ok());
    }
}
```

**Integration Tests** (`tests/` directory):
```rust
use flare_server::{HookManager, AppState};

#[tokio::test]
async fn test_integration_scenario() {
    // Setup
    let state = create_test_state().await;

    // Execute
    let result = state.hook_manager.call_hook(...).await;

    // Verify
    assert!(result.is_ok());
}
```

### Required Test Coverage

- ✅ Happy path (normal operation)
- ✅ Edge cases (empty, null, boundary values)
- ✅ Error cases (invalid input, failures)
- ✅ Concurrent operations (if applicable)
- ✅ Integration scenarios (end-to-end flows)

### Code Style

- Use `tracing::info!`, `tracing::error!` for logging
- Return `anyhow::Result<T>` for error handling
- Use `#[async_trait]` for async trait methods
- Prefix unused variables with underscore: `_unused`
- Use `Arc<dyn Trait>` for shared state

## Key Components

### HookManager (Plugin System)

Manages WebSocket-based plugin connections with **per-connection sequential processing**:

```rust
// Each plugin connection processes requests sequentially
pub struct HookManager {
    hooks: Arc<DashMap<String, Vec<(String, Arc<PluginConnection>)>>>,
    pending_requests: Arc<DashMap<String, oneshot::Sender<Value>>>,
    connections: Arc<DashMap<String, Arc<PluginConnection>>>,
}
```

**Key Properties**:
- Sequential processing per connection (no race conditions)
- Multiple connections run in parallel
- Isolated results for concurrent clients

### QueryExecutor (Whitelist Queries)

Executes pre-validated named queries for SSR/SWR:

```rust
// Secure query execution
match query_executor.execute_query(&query_name, &user_context, &params) {
    Ok(result) => { /* Return validated result */ }
    Err(err) => { /* Reject unauthorized query */ }
}
```

### JWT Middleware

Protects REST endpoints with JWT authentication:

```rust
// Extract user context from JWT
let user_context = jwt_middleware::extract_user_context(&token)?;
// user_context.user_id, user_context.email, user_context.role
```

## Architecture Patterns

### Transport Model

| Use Case | Transport | Reason |
|----------|-----------|--------|
| Realtime sync | WebSocket | Bidirectional, low latency |
| Plugin calls | WebSocket | Sequential processing |
| SSR/SSG reads | REST | Server-compatible |
| SWR mutations | REST + WebSocket | Optimistic updates |

### Plugin vs Webhook

| Aspect | Custom Plugin | Webhook |
|--------|--------------|---------|
| Connection | Persistent WebSocket | HTTP POST callback |
| State | Stateful | Stateless |
| Ordering | Sequential per connection | No ordering guarantee |
| Long operations | Supported | Timeout risk |
| Use case | Business logic | Third-party integration |

### Session-Scoped Collections

Private real-time collections per client session:

```
_session_{sid}_import_progress
_session_{sid}_temp_data
```

- Automatically routed to session room
- Cleaned up on disconnect
- Used for OTP, import progress, etc.

## Documentation References

| Topic | Document |
|-------|----------|
| Architecture | [`docs/architecture/OVERVIEW.md`](./docs/architecture/OVERVIEW.md) |
| Transport Model | [`docs/architecture/TRANSPORT.md`](./docs/architecture/TRANSPORT.md) |
| Custom Plugins | [`docs/guides/CUSTOM_PLUGINS.md`](./docs/guides/CUSTOM_PLUGINS.md) |
| Client Patterns | [`docs/guides/CLIENT_PATTERNS.md`](./docs/guides/CLIENT_PATTERNS.md) |
| Named Queries | [`docs/reference/NAMED_QUERIES.md`](./docs/reference/NAMED_QUERIES.md) |
| Security | [`docs/security/README.md`](./docs/security/README.md) |
| JWT Auth | [`docs/security/JWT_AUTH_DESIGN.md`](./docs/security/JWT_AUTH_DESIGN.md) |

## Common Tasks

### Adding a New Plugin Event

1. Register plugin capability in client SDK
2. Handle event in plugin service
3. Call from client via `callPlugin()`

### Creating a Named Query

1. Add query config to `named_queries.json`
2. Define filters/parameters
3. Call via REST or WebSocket

### Protecting a New Endpoint

1. Add to `protected_routes` in `main.rs`
2. JWT middleware extracts user context
3. Use `PermissionContext` for authorization

## Troubleshooting

### Plugin Timeout

- Check plugin is connected to `/hooks`
- Verify event name matches registration
- Check 10-second timeout in `call_hook_with_jwt`

### Query Rejected

- Verify query name in whitelist config
- Check parameter injection rules
- Ensure user has required role

### Build Errors

```bash
# Clean and rebuild
cargo clean
cargo build

# Update dependencies
cargo update
```

## Testing Guidelines

### Concurrency Testing

```rust
#[tokio::test]
async fn test_concurrent_calls() {
    let manager = Arc::new(HookManager::new());
    
    // Spawn concurrent tasks
    let mut tasks = Vec::new();
    for i in 0..5 {
        let mgr = manager.clone();
        let task = tokio::spawn(async move {
            mgr.call_hook(...).await
        });
        tasks.push(task);
    }
    
    // Verify isolation
    for task in tasks {
        let result = task.await.unwrap();
        assert!(result.is_ok());
    }
}
```

### Integration Test Pattern

```rust
use flare_server::{AppState, HookManager};
use tempfile::tempdir;

#[tokio::test]
async fn test_full_flow() {
    // Setup
    let dir = tempdir().unwrap();
    let storage = Arc::new(SledStorage::new(dir.path()).unwrap());
    let state = create_test_state(storage).await;
    
    // Execute flow
    let result = state.hook_manager.call_hook(...).await;
    
    // Verify
    assert!(result.is_ok());
}
```

## Notes

- **Edition**: Uses Rust 2024 edition
- **Async Runtime**: Tokio with full features
- **Serialization**: Serde with JSON
- **Logging**: Tracing subscriber
- **Error Handling**: Anyhow for errors, thiserror for custom types
