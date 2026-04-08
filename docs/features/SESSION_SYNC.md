# Session Synchronization & Data Scoping

Flarebase provides built-in support for session-aware data synchronization, allowing backend logic (Hooks) to communicate privately and securely with specific clients.

## Session Temporary Tables

Every client connection to Flarebase has a unique `SocketId`. Flarebase uses this ID to provide "Session-scoped" storage.

### Naming Convention

Tables with the prefix `_session_{sid}_` are special. 

Example: `_session_abc123_verification_status`

- `{sid}` is the client's public Socket ID.
- These tables are isolated by name to that specific session.

### Automatic Synchronization

When a document is written to a session-prefixed table:
1.  Flarebase identifies the `{sid}` from the collection name.
2.  The update is **automatically broadcasted** to the Socket.io room `session:{sid}`.
3.  The synchronization includes the event type (`doc_created`, `doc_updated`, `doc_deleted`) and the document data.

## Field-Level Data Redaction (Sync Policies)

To prevent sensitive information (e.g., hashed passwords, private tokens) from being synchronized to clients, Flarebase implements a **Data Redaction** system.

### Configuration

Sync policies are defined in the `__config__` collection.

**Collection to Policy mapping**: `__config__/sync_policy_{collection_name}`

**Policy Schema**:
```json
{
  "id": "sync_policy_users",
  "data": {
    "internal": ["password_hash", "secret_key", "internal_id"]
  }
}
```

- `internal`: An array of field names that should be stripped before data is synchronized to ANY WebSocket client.

### Enforcement

The `redact_internal_fields` logic is applied:
- During WebSocket broadcasts for regular collections.
- During Automatic Synchronization for session tables.
- **Note**: The redaction happens *before* the data leaves the server. The database still stores the full document.

## Client-Side Usage (JS SDK)

Clients can easily subscribe to their own session state:

```javascript
// Subscribing to a session-scoped table
flare.sessionTable("account_status").onSnapshot((doc) => {
  console.log("Current account status:", doc.status);
});
```

The SDK automatically prepends the client's current session ID to the request, ensuring they receive updates from the correct storage location.
