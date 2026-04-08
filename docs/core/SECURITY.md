# Security & Permissions

Flarebase implements a layered security model to ensure data integrity and privacy across distributed nodes and external clients.

## Authorization System (`Authorizer`)

Flarebase uses a resource-based authorization system that evaluates permissions based on a `PermissionContext`.

### Permission Levels
- **Read**: View resource data.
- **Write**: Update existing resources.
- **Delete**: Remove resources.
- **Admin**: Full access to all resources and system configurations.

### Permission Context
Every authorization check requires a context:
```rust
pub struct PermissionContext {
    pub user_id: String,
    pub user_role: String,
    pub resource_id: String,
    pub resource_type: ResourceType,
}
```

### Resource Types
Currently supported resource types:
- `User`: Profile and account information.
- `Article`: Content documents.
- `Comment`: User-generated responses.
- `SystemConfig`: Internal Flarebase settings.

## Data Sanitization

The `Authorizer` provides a `sanitize_user_data` method to prevent sensitive information leak when viewing other users' profiles.

**Sanitization Logic**:
- **Owner**: Full access to all fields.
- **Admin**: Full access to all fields.
- **Others**: Sensitive fields like `password_hash`, `email`, and `status` are removed before transmission.

## Validation & Business Rules

Flarebase enforces strict validation on certain resource updates to prevent unauthorized state transitions.

### Article Update Rules
- **Author Retention**: The `author_id` of an article is immutable once created.
- **Moderation Flow**: Direct status changes to `published` are restricted. Articles must typically move through `draft` -> `pending_review` -> `moderated`.

## Data Visibility (Redaction)

In addition to programmatic authorization, Flarebase uses **Sync Policies** to redact fields at the synchronization layer. This ensures that even if a user has "Read" permission to a collection, specific sensitive technical fields never leave the server over WebSockets. (See [SESSION_SYNC.md](./SESSION_SYNC.md) for details).

## Secure Hook Communication

External logic providers (Hooks) must provide a `token` during registration. This token is validated by the `HookManager` to ensure only authorized services can handle system events and access session data.
