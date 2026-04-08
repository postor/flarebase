# Flarebase Architecture

Flarebase is a distributed Backend-as-a-Service (BaaS) designed for high-performance, real-time data synchronization and flexible business logic integration through stateful hooks.

## Core Philosophical Principles

1.  **Passive Infrastructure**: The database provides generic storage. Business logic lives in external "Hooks".
2.  **Stateful Interaction**: Real-time communication via WebSockets (Socket.io) instead of one-way stateless webhooks.
3.  **Session Isolation**: Automatic synchronization and scoping of data to specific user sessions.
4.  **Zero Configuration**: Collections and schemas are created dynamically by client usage.

## Component Overview

### 1. Storage Layer (`flare-db`)
Uses **Sled** as an embedded key-value engine.
- Each collection is a separate Sled Tree.
- Supports atomic batch operations with optimistic concurrency control (preconditions).

### 2. Server Layer (`flare-server`)
The multi-protocol interface.
- **HTTP**: Generic CRUD API.
- **WebSocket**: Real-time subscriptions and Hook signaling.
- **gRPC**: Internal cluster coordination and replication.

### 3. Hook Manager
Orchestrates communication with external logic providers.
- **Registration**: Hooks register their "Capabilities" (events they handle).
- **Correlation**: Maps request IDs to `oneshot` channels to provide a synchronous-like `await` experience for asynchronous WebSocket calls.

## Data Flow: Custom Hook Trajectory

1.  **Client Request**: Client calls `flare.callHook("verify_otp", { code: "1234" })` via WebSocket.
2.  **Signal Routing**: `HookManager` identifies an active Hook connection registered for `verify_otp`.
3.  **Dispatch**: Flarebase sends a `hook_request` to the Hook service.
4.  **External Logic**: The Hook service queries the DB, validates the OTP, and performs any side effects (e.g., updating user status).
5.  **Return Path**: The Hook sends a `hook_response`. `HookManager` correlates the event and returns the result to the initial client's `Promise`.

## Synchronization & Session Scoping

Flarebase supports a unique "Session Table" pattern:
- Tables named `_session_{sid}_name` are private to connection `sid`.
- Any write to these tables automatically triggers an `emit` to the `session:{sid}` room.
- This allows Hooks to "push" state to a specific client (e.g., "Verification Successful") without the client polling or the Hook knowing the client's public address.

## Security Model

Security is handled at three levels:
1.  **Authentication**: Provided by the application layer (often facilitated by Hooks).
2.  **Authorization (`Authorizer`)**: Resource-based permission checking (Read/Write/Delete/Moderate).
3.  **Data Redaction (`SyncPolicy`)**: Field-level visibility rules that strip sensitive data (like `password_hash`) before it is synchronized to external clients.
