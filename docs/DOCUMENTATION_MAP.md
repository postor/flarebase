# 📚 Flarebase 文档地图

完整的文档导航和快速索引。

---

## 🗂️ 文档结构

```
docs/
├── README.md                    # 主索引
├── core/                        # 核心架构
│   ├── ARCHITECTURE.md
│   ├── MEMORY_STORAGE_DESIGN.md
│   ├── INDEXING_DESIGN.md
│   ├── CLUSTER_COMPUTING_DESIGN.md
│   ├── DATA_DURABILITY.md
│   ├── SECURITY.md
│   ├── PERMISSION_DESIGN.md
│   ├── FLEXIBLE_PERMISSION_DESIGN.md
│   └── ORG_HIERARCHY_PERMISSION_DESIGN.md
├── security/                    # 安全系统 ⭐ NEW
│   ├── README.md                # 安全文档索引
│   ├── SECURITY_RULES.md        # 无服务器权限系统 ⭐ NEW
│   ├── QUERY_WHITELIST.md       # 查询白名单规范
│   ├── MIGRATION_GUIDE.md       # 迁移指南 ⭐ NEW
│   ├── HYBRID_QUERY_PATTERN.md
│   ├── WHITELIST_TECHNICAL_VALIDATION.md
│   ├── WHITELIST_INTEGRATION_FEASIBILITY.md
│   └── WHITELIST_TDD_IMPLEMENTATION.md
├── features/                    # 功能特性
│   ├── HOOKS_PROTOCOL.md
│   ├── SESSION_SYNC.md
│   ├── MEMORY_STORAGE.md
│   ├── MEMORY_STORAGE_GUIDE.md
│   └── SUBSCRIPTION_DESIGN.md
├── clients/                     # 客户端 SDK
│   ├── USAGE_GUIDE.md
│   ├── REACT_TDD_REPORT.md
│   ├── VUE_TDD_REPORT.md
│   └── TDD_DEVELOPMENT_SUMMARY.md
├── flows/                       # 业务流程
│   └── USER_AND_ARTICLE_FLOWS.md
└── tests/                       # 测试文档
    ├── README.md
    ├── HOOK_TESTS.md
    ├── REGISTRATION_TESTS_SUMMARY.md
    └── ...
```

---

## 🎯 按角色查找文档

### 👨‍💻 开发者

**入门**
- [Architecture Overview](./core/ARCHITECTURE.md) - 系统架构概览
- [Client SDK Usage](./clients/USAGE_GUIDE.md) - SDK 使用指南

**安全开发**
- [Security Rules](./security/SECURITY_RULES.md) ⭐ - 权限系统完整指南
- [Query Whitelist](./security/QUERY_WHITELIST.md) - 安全查询模板
- [Migration Guide](./security/MIGRATION_GUIDE.md) ⭐ - 迁移指南

**功能实现**
- [User & Article Flows](./flows/USER_AND_ARTICLE_FLOWS.md) - 用户和文章流程
- [Session Sync](./features/SESSION_SYNC.md) - 会话同步
- [Hook Protocol](./features/HOOKS_PROTOCOL.md) - Hook 协议

### 🏗️ 架构师

**系统设计**
- [Architecture Overview](./core/ARCHITECTURE.md) - 架构设计
- [Cluster Computation](./core/CLUSTER_COMPUTING_DESIGN.md) - 集群计算
- [Memory Storage](./core/MEMORY_STORAGE_DESIGN.md) - 内存存储

**安全架构**
- [Security & Permissions](./core/SECURITY.md) - 权限系统设计
- [Security Rules](./security/SECURITY_RULES.md) ⭐ - 无服务器安全
- [Permission Design](./core/PERMISSION_DESIGN.md) - 权限设计

**高级功能**
- [Hybrid Query Pattern](./security/HYBRID_QUERY_PATTERN.md) - 混合查询模式
- [Data Durability](./core/DATA_DURABILITY.md) - 数据持久性

### 🧪 测试工程师

**测试指南**
- [Tests README](./tests/README.md) - 测试文档索引
- [Hook Tests](./tests/HOOK_TESTS.md) - Hook 测试
- [Registration Tests](./tests/REGISTRATION_TESTS_SUMMARY.md) - 注册测试

**测试方法论**
- [TDD Implementation](./security/WHITELIST_TDD_IMPLEMENTATION.md) - TDD 方法
- [Technical Validation](./security/WHITELIST_TECHNICAL_VALIDATION.md) - 技术验证

### 🔧 运维工程师

**部署和运维**
- [Memory Storage Guide](./features/MEMORY_STORAGE_GUIDE.md) - 内存存储指南
- [Data Durability](./core/DATA_DURABILITY.md) - 数据持久性
- [Migration Guide](./security/MIGRATION_GUIDE.md) ⭐ - 迁移指南

---

## 🔍 按主题查找文档

### 安全性 (Security)

**核心文档**
- [Security Rules](./security/SECURITY_RULES.md) ⭐ - 完整的无服务器权限系统
- [Security & Permissions](./core/SECURITY.md) - 权限系统概述
- [Query Whitelist](./security/QUERY_WHITELIST.md) - 查询白名单

**进阶主题**
- [Hybrid Query Pattern](./security/HYBRID_QUERY_PATTERN.md) - 混合查询模式
- [Permission Design](./core/PERMISSION_DESIGN.md) - 权限设计
- [Flexible Permission Design](./core/FLEXIBLE_PERMISSION_DESIGN.md) - 灵活权限设计

**迁移和部署**
- [Migration Guide](./security/MIGRATION_GUIDE.md) ⭐ - 迁移指南
- [Integration Feasibility](./security/WHITELIST_INTEGRATION_FEASIBILITY.md) - 集成可行性

### 存储 (Storage)

**核心设计**
- [Memory Storage Design](./core/MEMORY_STORAGE_DESIGN.md) - 内存存储设计
- [Data Durability](./core/DATA_DURABILITY.md) - 数据持久性
- [Index System](./core/INDEXING_DESIGN.md) - 索引系统

**使用指南**
- [Memory Storage Guide](./features/MEMORY_STORAGE_GUIDE.md) - 内存存储指南

### 分布式系统 (Distributed Systems)

**集群和计算**
- [Cluster Computation](./core/CLUSTER_COMPUTING_DESIGN.md) - 集群计算
- [Architecture Overview](./core/ARCHITECTURE.md) - 架构概览

### 实时功能 (Real-time)

**同步和订阅**
- [Session Synchronization](./features/SESSION_SYNC.md) - 会话同步
- [Hook Protocol](./features/HOOKS_PROTOCOL.md) - Hook 协议
- [Subscription Design](./features/SUBSCRIPTION_DESIGN.md) - 订阅设计

### 客户端开发 (Client Development)

**SDK 使用**
- [Client Usage Guide](./clients/USAGE_GUIDE.md) - 客户端使用指南
- [React SDK](./clients/REACT_TDD_REPORT.md) - React SDK
- [Vue SDK](./clients/VUE_TDD_REPORT.md) - Vue SDK

---

## 🆕 新增文档

### 最新更新 (2026-04)

- ⭐ [Security Rules](./security/SECURITY_RULES.md) - 无服务器权限系统的完整方案
- ⭐ [Migration Guide](./security/MIGRATION_GUIDE.md) - 从白名单迁移到 Security Rules
- ⭐ [Security README](./security/README.md) - 安全文档索引

### 核心概念

**Security Rules** 是一个基于数据库的权限系统，类似 Firebase Security Rules：

- 规则存储在 Flarebase 中
- Flarebase 服务器执行规则验证
- 完全无服务器
- 每个应用独立管理规则

**与旧白名单系统的区别**：

| 特性 | 旧白名单 | Security Rules |
|------|---------|----------------|
| 存储位置 | 服务器配置 | 数据库 |
| 部署 | 配置服务器 | CLI 部署 |
| 多应用隔离 | 不支持 | 支持 |
| 权限表达式 | 不支持 | 支持 |

---

## 📖 阅读顺序建议

### 快速上手 (30分钟)

1. [Architecture Overview](./core/ARCHITECTURE.md) - 了解系统架构
2. [Client Usage Guide](./clients/USAGE_GUIDE.md) - 学习使用 SDK
3. [Security Rules](./security/SECURITY_RULES.md) - 设置权限

### 深入学习 (2小时)

1. 完成快速上手
2. [Query Whitelist](./security/QUERY_WHITELIST.md) - 理解查询白名单
3. [Session Synchronization](./features/SESSION_SYNC.md) - 学习实时同步
4. [Hook Protocol](./features/HOOKS_PROTOCOL.md) - 理解 Hook 系统

### 精通 (1天)

1. 完成深入学习
2. [Cluster Computation](./core/CLUSTER_COMPUTING_DESIGN.md) - 分布式计算
3. [Data Durability](./core/DATA_DURABILITY.md) - 数据持久性
4. [Hybrid Query Pattern](./security/HYBRID_QUERY_PATTERN.md) - 高级查询模式

---

## 🔗 外部资源

- [主 README](../README.md) - 项目概述
- [CLAUDE.md](../CLAUDE.md) - Claude Code 指令
- [ flare-protocol](../packages/flare-protocol/src/lib.rs) - 协议定义

---

## 📞 获取帮助

### 文档问题？

- 查看 [FAQ](./security/SECURITY_RULES.md#faq)
- 阅读 [常见问题](./security/SECURITY_RULES.md)
- 检查 [故障排除](./security/MIGRATION_GUIDE.md#故障排除)

### 技术支持？

- GitHub Issues: [anthropics/flarebase](https://github.com/anthropics/flarebase)
- 文档反馈: 提交 PR 或 Issue

---

## 📝 文档贡献

欢迎贡献文档！请参阅：

1. [文档贡献指南](./CONTRIBUTING.md) - 如何贡献文档
2. [文档风格指南](./STYLE_GUIDE.md) - 文档写作规范
3. [文档更新日志](./CHANGELOG.md) - 更新历史

---

**最后更新**: 2026-04-09
**文档版本**: v1.0.0
