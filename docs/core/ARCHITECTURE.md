# Architecture Documentation

Canonical architecture documentation:

- [../architecture/OVERVIEW.md](../architecture/OVERVIEW.md)
- [../architecture/TRANSPORT.md](../architecture/TRANSPORT.md)
- [../guides/CUSTOM_PLUGINS.md](../guides/CUSTOM_PLUGINS.md)

## Key Changes

- **Terminology**: `custom hook` renamed to `custom plugin`
- **Transport**: All plugins use WebSocket connections (no HTTP POST)
- **REST API**: Used for SSR / SWR, plugins handle business logic

## Implementation Notes

Current implementation uses `HookManager`, `call_hook`, `hook_request` events. These will be renamed to plugin terminology in future releases.

## Security

See [Security Documentation](../security/README.md) for:
- JWT authentication
- Named queries and whitelisting
- Plugin isolation and execution

## Storage

See [Indexing Design](./INDEXING_DESIGN.md) for database architecture details.
