# Flarebase Documentation Hub

Welcome to the technical documentation library for Flarebase, a distributed, high-performance BaaS.

## 🏛️ Core Architecture
- **[Architecture Overview](./core/ARCHITECTURE.md)**: Conceptual design, data flow, and philosophical principles.
- **[Security & Permissions](./core/SECURITY.md)**: Resource-based authorization, data sanitization, and sync policies.

## 🚀 Features & Protocols
- **[Stateful Hook Protocol](./features/HOOKS_PROTOCOL.md)**: WebSocket-based bi-directional logic integration.
- **[Session Synchronization](./features/SESSION_SYNC.md)**: Private data scoping and automatic synchronization for specific client connections.

## 🛠️ Developer Guides
- **[User & Article Flows](./flows/USER_AND_ARTICLE_FLOWS.md)**: Step-by-step logic for registration and content moderation.
- **Common Commands**: See the main [CLAUDE.md](../CLAUDE.md).
- **Protocol Definitions**: Protobuf and common types are in [flare-protocol](../packages/flare-protocol/src/lib.rs).
