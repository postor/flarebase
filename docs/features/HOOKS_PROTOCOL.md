# Hook Protocol Specification

Hooks in Flarebase are stateful services that connect via WebSockets to handle custom business logic.

## Connectivity

Hooks connect to the `/hooks` namespace of the Flarebase server.

- **URL**: `ws://<flarebase-host>:<port>/hooks`
- **Reconnection**: Standard Socket.io reconnection behavior applies.

## Message Flow

### 1. Registration (`client -> server`)

After connecting, a Hook must register its capabilities.

**Event**: `register`
**Payload**:
```json
{
  "token": "string",
  "capabilities": {
    "events": ["string[]"],
    "user_context": {
      "uid": "string",
      "role": "string"
    }
  }
}
```

- `token`: Authorization token for the Hook service.
- `events`: A list of custom event names this Hook can handle.

### 2. Hook Request (`server -> hook`)

When a client calls `callHook`, Flarebase selects a registered Hook and sends this request.

**Event**: `hook_request`
**Payload**:
```json
{
  "request_id": "uuid",
  "event_name": "string",
  "session_id": "string",
  "params": "object"
}
```

- `request_id`: Used to correlate the response.
- `session_id`: The Socket ID of the client that triggered the hook. Can be used to write to session-scoped tables.
- `params`: Arguments passed by the client.

### 3. Hook Response (`hook -> server`)

The Hook must return a response with the same `request_id`.

**Event**: `hook_response`
**Payload**:
```json
{
  "request_id": "uuid",
  "status": "success | error",
  "data": "object?",
  "error": "object?"
}
```

- `status`: Indicates success or failure.
- `data`: The payload to return to the client.
- `error`: Error details if `status` is `error`.

## Lifecycle & Timeouts

- **Correlation**: Flarebase maintains a `pending_requests` map.
- **Timeout**: Flarebase enforces a **10-second timeout** on hook responses. If a Hook does not respond within this window, the client receives a "Hook request timed out" error.
- **Failover**: If multiple Hooks register for the same event, Flarebase currently implements a round-robin or first-available selection (implementation specific).
- **Cleanup**: If a Hook disconnects, it is automatically removed from the registry.
