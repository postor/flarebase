# Flarebase React Client - 测试覆盖报告

## 测试文件总览

| 文件名 | 测试类型 | 测试数量 | 主要覆盖范围 |
|--------|----------|----------|--------------|
| `FlarebaseProvider.test.jsx` | Provider基础测试 | 5 | Provider渲染、上下文提供 |
| `hooks.test.jsx` | 遗留Hooks测试 | 11 | useCollection, useDocument, useQuery |
| `swr.test.jsx` | SWR Hooks测试 | 12 | useFlarebaseSWR, useFlarebaseDocumentSWR, useFlarebaseQuerySWR |
| `security.test.jsx` | 安全测试 | 3 | 用户权限验证 |
| `simple-hooks.test.jsx` | 简化测试 | 2 | useCollection 基础功能 |
| `simple-swr.test.jsx` | 简化测试 | 2 | useFlarebaseSWR 基础功能 |
| `auth-state.test.jsx` | **新增** | **4** | **认证状态验证** |
| `swr-data-fetch.test.jsx` | **新增** | **10** | **SWR 数据获取** |
| `auth-login-logout.test.jsx` | **新增** | **6** | **登录登出方法** |

---

## 新增测试文件详细覆盖

### 1. auth-state.test.jsx - 认证状态测试

| 测试用例 | 描述 |
|----------|------|
| `should throw error when useFlarebase is used outside FlarebaseProvider` | 验证 Provider 外使用 hook 抛出错误 |
| `should provide context when used inside FlarebaseProvider` | 验证 Provider 内正确提供上下文 |
| `should have correct initial auth state` | 验证初始认证状态 (未登录) |
| `should accept initialJWT and initialUser props` | 验证 Provider 接受初始 JWT 参数 |

### 2. swr-data-fetch.test.jsx - SWR 数据获取测试

| 测试用例 | 描述 |
|----------|------|
| `should fetch collection data with correct structure` | 验证 Collection 数据结构 |
| `should fetch data with correct URL and headers` | 验证请求 URL 和 Headers |
| `should handle empty collection response` | 验证空集合响应 |
| `should set isLoading correctly during fetch` | 验证加载状态转换 |
| `should fetch document data` | 验证单文档数据获取 |
| `should not fetch when id is undefined` | 验证 undefined id 不请求 |
| `should provide update method` | 验证 update 方法存在 |
| `should execute query and return filtered results` | 验证查询结果 |
| `should provide invalidate function` | 验证 invalidate 方法存在 |
| `should return empty array for query with no results` | 验证无结果查询 |

### 3. auth-login-logout.test.jsx - 登录登出测试

| 测试用例 | 描述 |
|----------|------|
| `should provide login method on client` | 验证 login 方法存在 |
| `should provide auth object with correct properties` | 验证 auth 对象属性 |
| `should have initial unauthenticated state` | 验证初始未认证状态 |
| `should allow calling login method` | 验证 login 方法可调用 |
| `should allow calling register method` | 验证 register 方法可调用 |
| `should allow calling logout method` | 验证 logout 方法可调用 |

---

## 测试执行命令

```bash
# ✅ 推荐：非阻塞模式 - 只运行特定测试文件，不监听文件变化
cd clients/react && npm test -- --run

# 运行新增的测试（推荐使用 --run 避免卡住）
cd clients/react && npm test -- --run tests/auth-state.test.jsx
cd clients/react && npm test -- --run tests/swr-data-fetch.test.jsx
cd clients/react && npm test -- --run tests/auth-login-logout.test.jsx

# 一次运行多个测试文件
cd clients/react && npm test -- --run tests/auth-state.test.jsx tests/swr-data-fetch.test.jsx tests/auth-login-logout.test.jsx

# 运行所有测试（非阻塞模式）
npm test -- --run

# 运行所有测试并显示覆盖率
npm test -- --run --coverage
```

## ⚠️ 避免卡住的注意事项

1. **使用 `--run` 参数**：这会以非阻塞模式运行测试，只执行一次后退出，不会持续监听文件变化
2. **避免运行所有测试**：如果已有失败的测试，可能导致测试套件卡住
3. **按需运行**：优先运行需要验证的特定测试文件
4. **避免长时间运行的集成测试**：需要真实后端的测试应该在隔离环境中运行

---

## 覆盖范围总结

### ✅ 已覆盖场景

1. **注册/未注册的 useXxx React hooks**
   - Provider 外部使用抛出错误
   - Provider 内部使用返回正确上下文
   - 初始状态验证

2. **useSWR 的后端数据获取**
   - Collection 数据获取
   - 单文档数据获取
   - 带过滤器的查询数据获取
   - JWT 认证头注入
   - 空数据处理
   - 加载状态转换

3. **登录登出方法验证**
   - login/register/logout 方法存在性
   - auth 对象属性验证
   - 初始未认证状态

4. **Provider 用户数据验证**
   - auth.isAuthenticated 状态
   - auth.user 属性
   - auth.jwt 属性
   - null 处理

### 测试统计

- **总测试文件数**: 9
- **新增测试文件**: 3
- **新增测试用例**: 20
