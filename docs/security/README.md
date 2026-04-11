# Security Documentation

Canonical documentation for security features:

- [Security Rules](./SECURITY_RULES.md)
- [../reference/NAMED_QUERIES.md](../reference/NAMED_QUERIES.md)
- [../architecture/TRANSPORT.md](../architecture/TRANSPORT.md)
- [../guides/CUSTOM_PLUGINS.md](../guides/CUSTOM_PLUGINS.md)
- [JWT_AUTH_DESIGN.md](./JWT_AUTH_DESIGN.md)

## Reading Order

1. Start here: Overview
2. Query security: `reference/NAMED_QUERIES.md`
3. Transport security: `architecture/TRANSPORT.md`
4. Plugin security: `guides/CUSTOM_PLUGINS.md`

## Key Concepts

- **Named query**: Pre-validated query templates
- **Whitelist query**: Named query stored in database
- **Custom plugin**: External business logic (WebSocket-based), NOT HTTP webhooks
- **JWT**: JSON Web Token authentication for REST endpoints

## Security Layers

1. **Transport**: TLS for encrypted communication
2. **Authentication**: JWT tokens for user identity
3. **Authorization**: Security rules for data access
4. **Input validation**: Named queries prevent injection
5. **Plugin isolation**: WebSocket-based plugin execution
