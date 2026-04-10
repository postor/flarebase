# 🔒 Security Documentation

Flarebase 安全系统的完整文档。

## 📑 核心文档

### [Security Rules](./SECURITY_RULES.md)
**无服务器权限管理的完整方案**

数据库驱动的权限系统，规则存储在 Flarebase 中，由 Flarebase 服务器执行，完全无需用户维护任何服务器。

**主要内容**:
- 核心概念和架构设计
- 规则语法和变量注入
- 部署流程和使用示例
- 安全保证和最佳实践

**适合读者**: 开发者、架构师

---

### [Query Whitelist](./QUERY_WHITELIST.md)
**查询白名单规范**

预定义安全的查询模板，客户端只能通过名称调用这些模板。

**主要内容**:
- 白名单配置结构
- Simple Query 和 Pipeline Query
- 变量注入和过滤器操作符
- 客户端使用方法

**适合读者**: 开发者

---

### [Hybrid Query Pattern](./HYBRID_QUERY_PATTERN.md)
**混合查询模式**

结合灵活查询和安全约束的查询模式设计。

**主要内容**:
- 混合模式架构
- 查询转换和验证
- 性能优化策略

**适合读者**: 架构师、高级开发者

## 🔬 技术分析文档

### [Technical Validation](./WHITELIST_TECHNICAL_VALIDATION.md)
技术验证和安全测试方法论。

### [Integration Feasibility](./WHITELIST_INTEGRATION_FEASIBILITY.md)
不同集成方案的可行性分析。

### [TDD Implementation](./WHITELIST_TDD_IMPLEMENTATION.md)
测试驱动开发方法在白名单系统中的应用。

## 📚 相关资源

- [Security & Permissions](../core/SECURITY.md) - 核心权限系统概述
- [Architecture Overview](../core/ARCHITECTURE.md) - 系统架构设计
- [Client SDK Usage](../clients/USAGE_GUIDE.md) - 客户端 SDK 使用指南

## 🎯 快速导航

### 我想了解...

**如何设置权限规则？**
→ [Security Rules](./SECURITY_RULES.md#部署流程)

**如何定义安全的查询？**
→ [Query Whitelist](./QUERY_WHITELIST.md#白名单配置)

**如何使用白名单查询？**
→ [Query Whitelist](./QUERY_WHITELIST.md#客户端使用)

**白名单和 Security Rules 的区别？**
→ [Security Rules](./SECURITY_RULES.md#与白名单查询的区别)

**如何部署安全规则？**
→ [Security Rules](./SECURITY_RULES.md#部署流程)

**有哪些安全最佳实践？**
→ [Security Rules](./SECURITY_RULES.md#最佳实践)

## 🔧 技术栈

- **语言**: Rust (服务器端), TypeScript (客户端)
- **存储**: Flarebase 数据库 (规则存储)
- **认证**: JWT Token
- **验证**: 表达式引擎

## 📞 获取帮助

- 查看 [FAQ](./SECURITY_RULES.md#faq)
- 阅读 [示例代码](./SECURITY_RULES.md#使用示例)
- 参考 [最佳实践](./SECURITY_RULES.md#最佳实践)
