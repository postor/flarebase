# TDD修复: JSON解析错误

## 问题描述
浏览器控制台错误: "Failed to execute 'json' on 'Response': Unexpected end of JSON input"

## 根本原因
服务器返回HTTP错误状态码(401/403/500等)时,响应体为空(`content-length: 0`),但客户端代码直接调用`.json()`导致解析失败。

## TDD流程

### ✅ RED Phase - 编写失败的测试
创建了 `tests/http_error_handling.test.js` (12个测试用例)

### ✅ GREEN Phase - 修复代码使测试通过
修复了以下8个方法:

1. **FlareClient.query()** - Line 469
   ```typescript
   if (!response.ok) {
     throw new Error(`Query failed: ${response.statusText} (${response.status})`);
   }
   ```

2. **FlareClient.namedQuery()** - Line 407
   ```typescript
   if (!response.ok) {
     throw new Error(`Query failed: ${response.statusText}`);
   }
   ```

3. **FlareClient.runTransaction()** - Line 493
   ```typescript
   if (!response.ok) {
     throw new Error(`Transaction failed: ${response.statusText} (${response.status})`);
   }
   ```

4. **CollectionReference.add()** - Line 690
   ```typescript
   if (!response.ok) {
     throw new Error(`Add document failed: ${response.statusText} (${response.status})`);
   }
   ```

5. **CollectionReference.get()** - Line 702
   ```typescript
   if (!response.ok && response.status !== 404) {
     throw new Error(`Get collection failed: ${response.statusText} (${response.status})`);
   }
   ```

6. **DocumentReference.get()** - Line 818
   ```typescript
   // 404 means document doesn't exist - return null
   if (response.status === 404) {
     return null;
   }
   // Other errors should throw
   if (!response.ok) {
     throw new Error(`Get document failed: ${response.statusText} (${response.status})`);
   }
   ```

7. **DocumentReference.update()** - Line 830
   ```typescript
   if (!response.ok) {
     throw new Error(`Update document failed: ${response.statusText} (${response.status})`);
   }
   ```

8. **WriteBatch.commit()** - Line 961
   ```typescript
   if (!response.ok) {
     throw new Error(`Batch commit failed: ${response.statusText} (${response.status})`);
   }
   ```

## 测试结果

### 新增测试
```
✓ http_error_handling.test.js (12 tests) - 全部通过
```

### 测试覆盖
- ✅ 401 Unauthorized处理
- ✅ 403 Forbidden处理
- ✅ 404 Not Found处理
- ✅ 500 Server Error处理
- ✅ 空响应体处理
- ✅ 所有API方法错误处理

## 错误处理策略

### HTTP状态码处理规则
- **200-299**: 成功,解析JSON响应
- **404**:
  - `DocumentReference.get()` → 返回`null`
  - 其他方法 → 抛出错误
- **401/403/4xx/5xx**: 抛出包含状态码和描述的错误

### 错误消息格式
```typescript
`<Operation> failed: <Status Text> (<Status Code>)`
```

示例:
- "Query failed: Unauthorized (401)"
- "Get document failed: Not Found (404)"
- "Transaction failed: Internal Server Error (500)"

## 验证步骤

1. **刷新Blog平台**
   ```bash
   # 浏览器中刷新 http://localhost:3002
   # 打开开发者工具控制台
   # 不应再看到 "Unexpected end of JSON input" 错误
   ```

2. **运行测试**
   ```bash
   cd clients/js
   npm test -- tests/http_error_handling.test.js
   ```

3. **检查错误信息**
   - 如果有错误,应该看到清晰的错误消息
   - 不应再有JSON解析错误

## 影响范围

### 修改文件
- `clients/js/src/FlareClient.ts` (8处修复)
- `clients/js/tests/http_error_handling.test.js` (新增)
- `clients/js/dist/` (重新构建)

### 向后兼容性
- ✅ API接口未改变
- ✅ 成功场景行为不变
- ⚠️ 错误场景从"JSON解析错误"改为"清晰的HTTP错误消息"

## 相关文档
- [TDD原则](../CLAUDE.md#️-test-driven-development-tdd-principles)
- [错误处理最佳实践](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch)
