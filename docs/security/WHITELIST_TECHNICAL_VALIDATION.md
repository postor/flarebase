# 🔬 白名单集成技术验证脚本

## 验证目标
确认白名单系统可以在博客平台中正常工作，验证技术可行性。

## 1. 服务器端验证

### 添加白名单端点到 Flarebase 服务器

```rust
// 在 packages/flare-server/src/main.rs 中添加

use flare_server::whitelist::{QueryExecutor, UserContext};
use std::sync::Arc;
use axum::extract::Path;

// 在 AppState 中添加 QueryExecutor
pub struct AppState {
    pub storage: Arc<dyn Storage>,
    pub query_executor: Arc<QueryExecutor>, // 新增
    pub io: SocketIo,
    pub cluster: Arc<ClusterManager>,
    pub node_id: u64,
    pub event_bus: Arc<EventBus>,
    pub hook_manager: Arc<HookManager>,
}

// 新的白名单查询端点
pub async fn run_named_query(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(name): Path<String>,
    Json(params): Json<serde_json::Value>
) -> Result<Json<serde_json::Value>, StatusCode> {
    // 1. 提取用户信息
    let (user_id, user_role) = match extract_user_info(&headers) {
        Ok(info) => info,
        Err(status) => return Err(status),
    };

    // 2. 创建用户上下文
    let user_context = UserContext {
        user_id,
        user_role,
    };

    // 3. 转换参数格式
    let client_params = if let Ok(obj) = serde_json::from_value::<std::collections::HashMap<String, serde_json::Value>>(params) {
        obj
    } else {
        return Err(StatusCode::BAD_REQUEST);
    };

    // 4. 执行白名单查询
    let result = state.query_executor
        .execute_query(&name, &user_context, &client_params)
        .map_err(|err| {
            eprintln!("Query execution error: {:?}", err);
            StatusCode::FORBIDDEN
        })?;

    // 5. 转换结果为JSON
    let json_result = serde_json::to_value(result)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(json_result))
}

// 在路由中添加白名单端点
fn create_router() -> Router<Arc<AppState>> {
    Router::new()
        // ... 现有路由
        .route("/queries/:name", post(run_named_query)) // 新增
        .layer(CorsLayer::permissive())
}

// 在服务器启动时加载白名单配置
async fn start_query_executor() -> anyhow::Result<Arc<QueryExecutor>> {
    let config_json = r#"
    {
      "queries": {
        "list_published_posts": {
          "type": "simple",
          "collection": "posts",
          "filters": [
            ["status", {"Eq": "published"}]
          ]
        }
      }
    }
    "#;

    let executor = QueryExecutor::from_json(config_json)?;
    Ok(Arc::new(executor))
}
```

## 2. 验证测试脚本

### Rust 集成测试

```rust
// packages/flare-server/tests/whitelist_blog_integration.rs

use flare_server::{QueryExecutor, UserContext};
use std::collections::HashMap;

#[tokio::test]
async fn test_blog_published_posts_query() {
    let config = r#"
    {
      "queries": {
        "list_published_posts": {
          "type": "simple",
          "collection": "posts",
          "filters": [
            ["status", {"Eq": "published"}]
          ]
        }
      }
    }
    "#;

    let executor = QueryExecutor::from_json(config).expect("Failed to load config");

    // 测试未认证用户可以访问公开文章
    let guest_context = UserContext {
        user_id: "".to_string(),
        user_role: "guest".to_string(),
    };

    let result = executor.execute_query(
        "list_published_posts",
        &guest_context,
        &HashMap::new()
    );

    assert!(result.is_ok(), "Guest users should access published posts");
}

#[tokio::test]
async fn test_blog_my_posts_query_enforcement() {
    let config = r#"
    {
      "queries": {
        "list_my_posts": {
          "type": "simple",
          "collection": "posts",
          "filters": [
            ["author_id", {"Eq": "$USER_ID"}]
          ]
        }
      }
    }
    "#;

    let executor = QueryExecutor::from_json(config).expect("Failed to load config");

    // 测试用户隔离
    let user1_context = UserContext {
        user_id: "user-123".to_string(),
        user_role: "author".to_string(),
    };

    let result = executor.execute_query(
        "list_my_posts",
        &user1_context,
        &HashMap::new()
    );

    assert!(result.is_ok(), "Users should access their own posts");

    // 验证查询结果包含正确的用户ID过滤
    let query_result = result.unwrap();
    if let flare_server::QueryResult::Simple(simple) = query_result {
        assert_eq!(simple.collection, "posts");
        assert!(simple.filters.iter().any(|f| {
            f["field"] == "author_id" && f["value"] == "user-123"
        }));
    }
}

#[tokio::test]
async fn test_blog_prevents_unauthorized_queries() {
    let config = r#"
    {
      "queries": {
        "safe_query": {
          "type": "simple",
          "collection": "posts"
        }
      }
    }
    "#;

    let executor = QueryExecutor::from_json(config).expect("Failed to load config");

    let user_context = UserContext {
        user_id: "user-123".to_string(),
        user_role: "author".to_string(),
    };

    // 尝试执行不存在的查询
    let result = executor.execute_query(
        "malicious_query",
        &user_context,
        &HashMap::new()
    );

    assert!(result.is_err(), "Should reject non-whitelisted queries");
}
```

### JavaScript 前端测试

```javascript
// examples/blog-platform/tests/whitelist.test.js

import { createWhitelistClient } from '../src/lib/flarebase_whitelist';

describe('Blog Whitelist Queries', () => {
  let client;

  beforeEach(() => {
    client = createWhitelistClient(
      'http://localhost:3000',
      () => ({ 'Authorization': 'Bearer test-user-123:author:test@example.com' })
    );
  });

  test('should fetch published posts', async () => {
    const posts = await client.blogQueries.getPublishedPosts(10);
    expect(Array.isArray(posts)).toBe(true);
    expect(posts.length).toBeLessThanOrEqual(10);
  });

  test('should enforce user isolation for my posts', async () => {
    const posts = await client.blogQueries.getMyPosts(10);
    expect(posts.every(post => post.data.author_id === 'test-user-123')).toBe(true);
  });

  test('should get post with author info', async () => {
    const post = await client.blogQueries.getPostWithAuthor('post-123');
    expect(post).toHaveProperty('title');
    expect(post).toHaveProperty('author');
    expect(post.author).toHaveProperty('name');
  });

  test('should reject invalid query names', async () => {
    await expect(
      client.namedQuery('nonexistent_query', {})
    ).rejects.toThrow();
  });

  test('should validate parameter ranges', async () => {
    // 测试参数验证
    await expect(
      client.blogQueries.getPublishedPosts(99999) // 超出范围
    ).rejects.toThrow();
  });
});
```

## 3. 端到端验证脚本

```bash
#!/bin/bash
# whitelist_integration_test.sh

echo "🧪 Starting Whitelist Integration Tests..."

# 1. 启动 Flarebase 服务器
echo "📡 Starting Flarebase server..."
cd packages/flare-server
cargo run &
FLAREBASE_PID=$!
sleep 5

# 2. 运行 Rust 测试
echo "🦀 Running Rust integration tests..."
cargo test --test whitelist_blog_integration

if [ $? -ne 0 ]; then
    echo "❌ Rust tests failed"
    kill $FLAREBASE_PID
    exit 1
fi

# 3. 运行前端测试
echo "🌐 Running frontend tests..."
cd ../../examples/blog-platform
npm test -- whitelist.test.js

if [ $? -ne 0 ]; then
    echo "❌ Frontend tests failed"
    kill $FLAREBASE_PID
    exit 1
fi

# 4. 清理
echo "🧹 Cleaning up..."
kill $FLAREBASE_PID

echo "✅ All integration tests passed!"
```

## 4. 性能基准测试

```rust
// packages/flare-server/benches/whitelist_performance.rs

use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use flare_server::QueryExecutor;
use std::collections::HashMap;

fn benchmark_query_execution(c: &mut Criterion) {
    let config = r#"
    {
      "queries": {
        "simple_query": {
          "type": "simple",
          "collection": "posts",
          "filters": [
            ["status", {"Eq": "published"}]
          ]
        },
        "complex_query": {
          "type": "pipeline",
          "steps": [
            {
              "id": "post",
              "action": "get",
              "collection": "posts",
              "id_param": "$params.id"
            },
            {
              "id": "author",
              "action": "get",
              "collection": "users",
              "id_param": "$post.data.author_id"
            }
          ]
        }
      }
    }
    "#;

    let executor = QueryExecutor::from_json(config).expect("Failed to load config");
    let user_context = flare_server::UserContext {
        user_id: "user-123".to_string(),
        user_role: "author".to_string(),
    };

    c.bench_function("simple_query_execution", |b| {
        b.iter(|| {
            executor.execute_query(
                black_box("simple_query"),
                black_box(&user_context),
                black_box(&HashMap::new())
            )
        })
    });

    c.bench_function("pipeline_query_execution", |b| {
        let mut params = HashMap::new();
        params.insert("id".to_string(), serde_json::json!("post-123"));

        b.iter(|| {
            executor.execute_query(
                black_box("complex_query"),
                black_box(&user_context),
                black_box(&params)
            )
        })
    });
}

criterion_group!(benches, benchmark_query_execution);
criterion_main!(benches);
```

## 5. 安全验证清单

```markdown
## 安全验证测试清单

### 认证测试
- [ ] 未认证用户无法访问受限查询
- [ ] 过期的Token被拒绝
- [ ] 无效的Token格式被拒绝
- [ ] 管理员Token可以访问所有查询

### 授权测试
- [ ] 用户只能访问自己的资源
- [ ] 角色权限正确执行
- [ ] 跨用户访问被拒绝
- [ ] 权限提升攻击被阻止

### 参数验证测试
- [ ] 注入攻击被阻止
- [ ] 参数范围验证生效
- [ ] 特殊字符被正确过滤
- [ ] 参数类型验证正确

### 数据隔离测试
- [ ] 多租户数据正确隔离
- [ ] 用户无法绕过过滤条件
- [ ] 管理员可以看到所有数据
- [ ] 敏感字段正确脱敏

### 性能测试
- [ ] 查询响应时间 < 100ms
- [ ] 并发查询处理正常
- [ ] 内存使用在合理范围
- [ ] 无内存泄漏
```

## 6. 部署验证脚本

```bash
#!/bin/bash
# verify_deployment.sh

echo "🚀 Verifying Whitelist Deployment..."

# 检查配置文件
if [ ! -f "named_queries.json" ]; then
    echo "❌ named_queries.json not found"
    exit 1
fi

# 验证JSON格式
if ! jq empty named_queries.json >/dev/null 2>&1; then
    echo "❌ Invalid JSON in named_queries.json"
    exit 1
fi

# 检查必需的查询
REQUIRED_QUERIES=(
    "list_published_posts"
    "list_my_posts"
    "get_post_with_author"
)

for query in "${REQUIRED_QUERIES[@]}"; do
    if ! jq -r ".queries | keys | .[]" named_queries.json | grep -q "^$query$"; then
        echo "❌ Missing required query: $query"
        exit 1
    fi
done

echo "✅ All deployment checks passed!"
```

## 7. 监控和日志验证

```rust
// 添加查询执行日志
pub async fn run_named_query_with_logging(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(name): Path<String>,
    Json(params): Json<serde_json::Value>
) -> Result<Json<serde_json::Value>, StatusCode> {
    let start_time = std::time::Instant::now();

    // 记录查询请求
    eprintln!("🔍 Query Request: {} | Params: {:?}", name, params);

    let result = run_named_query(
        State(state.clone()),
        headers,
        Path(name),
        Json(params)
    ).await;

    let duration = start_time.elapsed();

    match &result {
        Ok(_) => {
            eprintln!("✅ Query Success: {} | Time: {:?}", name, duration);
        }
        Err(error) => {
            eprintln!("❌ Query Failed: {} | Error: {:?} | Time: {:?}", name, error, duration);
        }
    }

    result
}
```

## 验证结果预期

### ✅ 成功标准
1. **功能正确**: 所有测试用例通过
2. **性能达标**: 查询响应时间 < 100ms
3. **安全有效**: 所有攻击被正确阻止
4. **兼容良好**: 不影响现有功能

### 📊 性能基准
- 简单查询: < 50ms
- 管道查询: < 100ms
- 并发处理: 支持100+并发查询

### 🛡️ 安全验证
- 阻止率: 100% 的未授权查询
- 误报率: 0% 的合法查询被误拒
- 漏报率: 0% 的恶意查询被放行

这个验证脚本提供了全面的技术验证，确保白名单系统在博客平台中安全可靠地运行！