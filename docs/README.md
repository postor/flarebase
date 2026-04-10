# Flarebase Documentation Hub

Welcome to the technical documentation library for Flarebase, a distributed, high-performance BaaS.

## 🏛️ Core Architecture
- **[Architecture Overview](./core/ARCHITECTURE.md)**: Conceptual design, data flow, and philosophical principles.
- **[Memory Storage Design](./core/MEMORY_STORAGE_DESIGN.md)**: High-performance in-memory storage implementation with benchmarks.
- **[Index System](./core/INDEXING_DESIGN.md)**: Secondary index trees, query optimization, and maintenance logic.
- **[Cluster Computation](./core/CLUSTER_COMPUTING_DESIGN.md)**: Sharding, distributed query execution, and load-balanced hook processing.
- **[Data Durability & Persistence](./core/DATA_DURABILITY.md)**: Crash recovery, durability levels (Sled vs Memory), and WAL roadmap.
- **[Security & Permissions](./core/SECURITY.md)**: Resource-based authorization, data sanitization, and sync policies.

## 🔒 Security & Authorization
- **[JWT Authentication](./security/JWT_AUTH_DESIGN.md)**: JWT-based authentication for REST API and Hooks.
- **[Security Rules](./security/SECURITY_RULES.md)**: Database-driven permission system for serverless security.
- **[Query Whitelist](./security/QUERY_WHITELIST.md)**: Safe named query templates to prevent unauthorized access.
- **[Hybrid Query Pattern](./security/HYBRID_QUERY_PATTERN.md)**: Combining flexible queries with security constraints.
- **[Technical Validation](./security/WHITELIST_TECHNICAL_VALIDATION.md)**: Security validation and testing methodology.
- **[Integration Feasibility](./security/WHITELIST_INTEGRATION_FEASIBILITY.md)**: Analysis of integration approaches.
- **[TDD Implementation](./security/WHITELIST_TDD_IMPLEMENTATION.md)**: Test-driven development approach.

## 🚀 Features & Protocols
- **[Stateful Hook Protocol](./features/HOOKS_PROTOCOL.md)**: WebSocket-based bi-directional logic integration.
- **[Session Synchronization](./features/SESSION_SYNC.md)**: Private data scoping and automatic synchronization for specific client connections.
- **[Memory Storage Guide](./features/MEMORY_STORAGE_GUIDE.md)**: Using in-memory storage with persistence.
- **[Subscription Design](./features/SUBSCRIPTION_DESIGN.md)**: Real-time data subscription patterns.

## 🛠️ Developer Guides
- **[User & Article Flows](./flows/USER_AND_ARTICLE_FLOWS.md)**: Step-by-step logic for registration and content moderation.
- **[Client SDK Usage](./clients/USAGE_GUIDE.md)**: JavaScript SDK integration guide.
- **[React SDK](./clients/REACT_TDD_REPORT.md)**: React-specific implementation and testing.
- **[Vue SDK](./clients/VUE_TDD_REPORT.md)**: Vue-specific implementation and testing.
- **Common Commands**: See the main [CLAUDE.md](../CLAUDE.md).
- **Protocol Definitions**: Protobuf and common types are in [flare-protocol](../packages/flare-protocol/src/lib.rs).
