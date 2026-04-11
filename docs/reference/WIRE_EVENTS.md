# Wire Events

Reference documentation for all Socket.IO events on the wire.

## Overview

Flarebase uses Socket.IO for real-time communication. Server emits `plugin_*` events when calling external plugins.

## Client <-> Server

| Direction | Event | Meaning |
| --- | --- | --- |
| client -> server | `subscribe` | Subscribe to collection changes |
| client -> server | `call_plugin` | Call custom plugin endpoint |
| client -> server | `named_query` | Execute named query via WebSocket |
| server -> client | `plugin_success` | Plugin succeeded |
| server -> client | `plugin_error` | Plugin failed |
| server -> client | `query_success` | Named query succeeded |
| server -> client | `query_error` | Named query failed |
| server -> client | `doc_created` | Document created |
| server -> client | `doc_updated` | Document updated |
| server -> client | `doc_deleted` | Document deleted |

## Plugin <-> Server

Plugins connect to the `/hooks` namespace for plugin protocol:

| Direction | Event | Meaning |
| --- | --- | --- |
| plugin -> server | `register` | Register plugin capabilities |
| server -> plugin | `plugin_request` | Plugin invocation request |
| plugin -> server | `plugin_response` | Plugin response |

## Plugin Request Payload

Server sends to plugin:

```json
{
  "request_id": "uuid",
  "event_name": "request_otp",
  "session_id": "socket-id",
  "params": {
    "email": "user@example.com"
  },
  "$jwt": {
    "user_id": "u_123",
    "email": "user@example.com",
    "role": "user"
  }
}
```

For unauthenticated requests:
```json
{
  "$jwt": {
    "user_id": null,
    "email": null,
    "role": "guest"
  }
}
```

## Plugin Response Payload

Plugin responds to server:

**Success**:
```json
{
  "request_id": "uuid",
  "status": "success",
  "data": {
    "ok": true
  }
}
```

**Error**:
```json
{
  "request_id": "uuid",
  "status": "error",
  "error": "verification failed"
}
```

## Session-scoped Data Push

For long-running operations (file uploads, contact imports), plugins can write to session-specific collections. Server broadcasts changes to the requesting client only.

### Flow

1. Client includes `session_id` in request
2. Plugin writes to `_session_{session_id}_{name}`
3. Flarebase broadcasts changes to that session only
4. Client subscribes to session collection for updates

### Example

Plugin processing contact import:
```javascript
// Plugin writes progress
await db.collection('_session_abc123_import_progress').insert({
  status: 'running',
  progress: 45,
  total: 1000
});

// Client receives update automatically
db.collection('_session_abc123_import_progress').subscribe((docs) => {
  console.log('Progress:', docs[0].progress);
});
```

This avoids HTTP callback polling and provides real-time updates.

## Naming Convention Migration

To align with "plugin" terminology, consider updating:

| Current | Recommended |
| --- | --- |
| `call_hook` | `call_plugin` |
| `hook_request` | `plugin_request` |
| `hook_response` | `plugin_response` |
| `FlareHook` | `FlarePluginClient` |
