# 🔐 Flarebase 灵活权限系统设计

## 问题分析

当前硬编码的权限检查存在以下问题：

1. **字段名硬编码**：只支持 `author_id`/`owner_id`，无法扩展到 `org_id`、`team_id`、`group_id` 等场景
2. **保护字段硬编码**：无法动态配置哪些字段不可修改
3. **权限规则僵化**：不同集合需要不同的权限逻辑，但无法配置
4. **多租户支持差**：SaaS 多租户场景需要复杂的权限层次
5. **维护困难**：每次添加新字段或新规则都需要修改代码

## 设计目标

✅ **灵活配置**：通过配置文件定义权限规则
✅ **字段无关**：支持任意所有者字段名
✅ **多租户友好**：支持复杂的租户隔离
✅ **白名单机制**：字段修改白名单/黑名单
✅ **性能优先**：权限检查缓存，O(1) 查找
✅ **向后兼容**：不影响现有功能

## 方案：基于配置的权限引擎 (Permission Engine)

### 1. 权限配置存储

权限规则存储在 `__permissions__` 集合中：

```json
{
  "id": "perm_posts",
  "collection": "posts",
  "rules": {
    "owner_fields": ["author_id", "owner_id"],
    "protected_fields": ["author_id", "created_at", "role"],
    "public_read": false,
    "allow_cross_tenant": false
  },
  "role_permissions": {
    "admin": {
      "can_create": true,
      "can_read": true,
      "can_update": true,
      "can_delete": true,
      "can_modify_protected": true
    },
    "moderator": {
      "can_create": false,
      "can_read": true,
      "can_update": true,
      "can_delete": true,
      "can_modify_protected": false
    },
    "user": {
      "can_create": true,
      "can_read": "own",
      "can_update": "own",
      "can_delete": "own",
      "can_modify_protected": false
    },
    "guest": {
      "can_create": false,
      "can_read": "public",
      "can_update": false,
      "can_delete": false
    }
  }
}
```

### 2. 多租户场景示例

#### SaaS 多租户（组织级别）

```json
{
  "id": "perm_org_resources",
  "collection": "org_resources",
  "rules": {
    "owner_fields": ["org_id", "team_id", "created_by"],
    "protected_fields": ["org_id", "team_id", "created_by", "role"],
    "public_read": false,
    "multi_tenant": true,
    "tenant_hierarchy": ["org_id", "team_id"]
  },
  "role_permissions": {
    "org_admin": {
      "can_create": true,
      "can_read": "org",
      "can_update": "org",
      "can_delete": "org",
      "can_modify_protected": false
    },
    "team_lead": {
      "can_create": true,
      "can_read": "team",
      "can_update": "team",
      "can_delete": "team",
      "can_modify_protected": false
    },
    "member": {
      "can_create": false,
      "can_read": "team",
      "can_update": "own",
      "can_delete": "own",
      "can_modify_protected": false
    }
  }
}
```

#### 社交媒体场景

```json
{
  "id": "perm_social_posts",
  "collection": "social_posts",
  "rules": {
    "owner_fields": ["user_id"],
    "protected_fields": ["user_id", "visibility", "likes_count"],
    "public_read": true,
    "visibility_field": "visibility"
  },
  "visibility_rules": {
    "public": { "can_read": ["everyone"] },
    "friends": { "can_read": ["friends", "owner"] },
    "private": { "can_read": ["owner"] }
  }
}
```

### 3. 权限引擎实现

```rust
pub struct PermissionEngine {
    storage: Arc<dyn Storage>,
    cache: Arc<RwLock<HashMap<String, PermissionConfig>>>,
}

impl PermissionEngine {
    /// 加载集合的权限配置
    pub async fn get_permission_config(&self, collection: &str) -> PermissionConfig {
        // 先查缓存
        if let Some(config) = self.cache.read().unwrap().get(collection) {
            return config.clone();
        }

        // 从数据库加载
        let default_config = PermissionConfig::default();
        if let Ok(Some(perm_doc)) = self.storage.get("__permissions__", &format!("perm_{}", collection)).await {
            let config: PermissionConfig = serde_json::from_value(perm_doc.data)
                .unwrap_or(default_config);

            // 写入缓存
            self.cache.write().unwrap().insert(collection.to_string(), config.clone());
            config
        } else {
            default_config
        }
    }

    /// 检查是否拥有资源的所有权
    pub async fn check_ownership(
        &self,
        collection: &str,
        user_id: &str,
        user_role: &str,
        user_context: &HashMap<String, String>,  // 用户的上下文（org_id, team_id 等）
        resource: &Document,
    ) -> Result<bool, PermissionError> {
        let config = self.get_permission_config(collection).await;

        // Admin 拥有所有权限
        if user_role == "admin" {
            return Ok(true);
        }

        // 检查所有者字段
        for owner_field in &config.rules.owner_fields {
            if let Some(resource_owner) = resource.data.get(owner_field).and_then(|v| v.as_str()) {
                // 直接所有者匹配
                if resource_owner == user_id {
                    return Ok(true);
                }

                // 多租户：检查用户上下文
                if let Some(user_tenant_id) = user_context.get(owner_field) {
                    if resource_owner == user_tenant_id {
                        return Ok(true);
                    }
                }
            }
        }

        // 检查租户层级（org -> team）
        if config.rules.multi_tenant {
            for tenant_field in &config.rules.tenant_hierarchy {
                if let Some(resource_tenant) = resource.data.get(tenant_field).and_then(|v| v.as_str()) {
                    if let Some(user_tenant) = user_context.get(tenant_field) {
                        if resource_tenant == user_tenant {
                            // 检查角色权限
                            let role_perm = config.role_permissions.get(user_role);
                            if let Some(perm) = role_perm {
                                // 检查是否有该层级的权限
                                if perm.can_read == tenant_field || perm.can_update == tenant_field {
                                    return Ok(true);
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(false)
    }

    /// 检查是否可以修改字段
    pub fn can_modify_field(&self, collection: &str, user_role: &str, field_name: &str) -> bool {
        let config = self.cache.read().unwrap();
        let perm_config = match config.get(collection) {
            Some(c) => c,
            None => return true,  // 无配置则允许修改
        };

        // Admin 可以修改所有字段
        if user_role == "admin" {
            return true;
        }

        // 检查是否是保护字段
        if perm_config.rules.protected_fields.contains(&field_name.to_string()) {
            return false;
        }

        // 检查角色权限
        if let Some(role_perm) = perm_config.role_permissions.get(user_role) {
            return role_perm.can_modify_protected;
        }

        false
    }

    /// 过滤查询结果
    pub async fn filter_query_results(
        &self,
        collection: &str,
        user_id: &str,
        user_role: &str,
        user_context: &HashMap<String, String>,
        docs: Vec<Document>,
    ) -> Vec<Document> {
        let config = self.get_permission_config(collection).await;

        docs.into_iter()
            .filter(|doc| {
                // 公开可读
                if config.rules.public_read {
                    if let Some(visibility) = doc.data.get(config.rules.visibility_field.as_str()).and_then(|v| v.as_str()) {
                        if visibility == "public" {
                            return true;
                        }
                    }
                }

                // 检查所有权
                self.check_ownership(collection, user_id, user_role, user_context, doc)
                    .await.unwrap_or(false)
            })
            .map(|mut doc| {
                // 移除敏感字段
                if !self.can_read_all_fields(collection, user_role) {
                    self.sanitize_document(&mut doc, user_role);
                }
                doc
            })
            .collect()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionConfig {
    pub collection: String,
    pub rules: PermissionRules,
    pub role_permissions: HashMap<String, RolePermissions>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRules {
    /// 所有者字段列表（用于所有权判断）
    pub owner_fields: Vec<String>,

    /// 受保护字段（不可修改）
    pub protected_fields: Vec<String>,

    /// 是否公开可读
    pub public_read: bool,

    /// 多租户支持
    #[serde(default)]
    pub multi_tenant: bool,

    /// 租户层级字段（如 ["org_id", "team_id"]）
    #[serde(default)]
    pub tenant_hierarchy: Vec<String>,

    /// 可见性字段
    #[serde(default = "default_visibility_field")]
    pub visibility_field: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AccessLevel {
    Bool(bool),
    String(String),  // "own", "org", "team", "public"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RolePermissions {
    #[serde(default)]
    pub can_create: bool,

    #[serde(default)]
    pub can_read: AccessLevel,

    #[serde(default)]
    pub can_update: AccessLevel,

    #[serde(default)]
    pub can_delete: AccessLevel,

    #[serde(default)]
    pub can_modify_protected: bool,
}
```

### 4. 使用示例

#### 初始化权限引擎

```rust
// 在 main.rs 中
let permission_engine = Arc::new(PermissionEngine::new(storage.clone()));

// 预加载权限配置
permission_engine.load_configs().await?;
```

#### 在 HTTP 处理器中使用

```rust
async fn create_doc(
    State(state): State<Arc<AppState>>,
    Path(collection): Path<String>,
    Json(data): Json<serde_json::Value>,
    headers: HeaderMap,
) -> Response {
    let (user_id, user_role) = extract_user_info(&headers)?;

    // 检查创建权限
    let config = state.permission_engine.get_permission_config(&collection).await;
    if !config.can_create(&user_role) {
        return (StatusCode::FORBIDDEN, "No permission to create").into_response();
    }

    // 检查所有者字段
    let user_context = extract_user_context(&headers);
    for owner_field in &config.rules.owner_fields {
        if let Some(value) = data.get(owner_field) {
            if value.as_str() != Some(&user_id)
                && !user_context.contains_key(owner_field)
                && user_role != "admin" {
                return (StatusCode::FORBIDDEN, "Cannot set owner field").into_response();
            }
        }
    }

    // 创建文档...
}

async fn update_doc(
    State(state): State<Arc<AppState>>,
    Path((collection, id)): Path<(String, String)>,
    Json(data): Json<serde_json::Value>,
    headers: HeaderMap,
) -> Response {
    let (user_id, user_role) = extract_user_info(&headers)?;
    let user_context = extract_user_context(&headers);

    // 获取现有文档
    let doc = state.storage.get(&collection, &id).await?.ok_or(StatusCode::NOT_FOUND)?;

    // 检查所有权
    let has_ownership = state.permission_engine.check_ownership(
        &collection,
        &user_id,
        &user_role,
        &user_context,
        &doc,
    ).await?;

    if !has_ownership {
        return (StatusCode::FORBIDDEN, "Not owner").into_response();
    }

    // 检查字段修改权限
    for field in data.as_object().unwrap().keys() {
        if !state.permission_engine.can_modify_field(&collection, &user_role, field) {
            return (StatusCode::FORBIDDEN, format!("Cannot modify field: {}", field)).into_response();
        }
    }

    // 更新文档...
}

async fn run_query(
    State(state): State<Arc<AppState>>,
    Json(query): Json<Query>,
    headers: HeaderMap,
) -> Response {
    let (user_id, user_role) = extract_user_info(&headers)?;
    let user_context = extract_user_context(&headers);

    // 执行查询
    let docs = state.storage.query(query).await?;

    // 过滤结果
    let filtered = state.permission_engine.filter_query_results(
        &query.collection,
        &user_id,
        &user_role,
        &user_context,
        docs,
    ).await;

    Json(filtered).into_response()
}
```

### 5. 权限配置示例

#### 博客文章

```json
{
  "id": "perm_posts",
  "collection": "posts",
  "rules": {
    "owner_fields": ["author_id"],
    "protected_fields": ["author_id", "created_at", "published_at"],
    "public_read": false
  },
  "role_permissions": {
    "admin": { "can_create": true, "can_read": true, "can_update": true, "can_delete": true, "can_modify_protected": true },
    "user": { "can_create": true, "can_read": "own", "can_update": "own", "can_delete": "own", "can_modify_protected": false },
    "guest": { "can_create": false, "can_read": "public", "can_update": false, "can_delete": false }
  }
}
```

#### 组织资源

```json
{
  "id": "perm_org_resources",
  "collection": "org_resources",
  "rules": {
    "owner_fields": ["org_id", "team_id", "created_by"],
    "protected_fields": ["org_id", "team_id", "created_by"],
    "public_read": false,
    "multi_tenant": true,
    "tenant_hierarchy": ["org_id", "team_id"]
  },
  "role_permissions": {
    "org_admin": { "can_create": true, "can_read": "org", "can_update": "org", "can_delete": "org" },
    "team_lead": { "can_create": true, "can_read": "team", "can_update": "team", "can_delete": "team" },
    "member": { "can_create": false, "can_read": "team", "can_update": "own", "can_delete": "own" }
  }
}
```

#### 用户资料

```json
{
  "id": "perm_users",
  "collection": "users",
  "rules": {
    "owner_fields": ["id"],
    "protected_fields": ["id", "email", "password_hash", "role", "created_at"],
    "public_read": false
  },
  "role_permissions": {
    "admin": { "can_create": true, "can_read": true, "can_update": true, "can_delete": true, "can_modify_protected": true },
    "user": { "can_create": false, "can_read": "own", "can_update": "own", "can_delete": false }
  }
}
```

### 6. 批量操作权限检查

```rust
async fn commit_transaction(
    State(state): State<Arc<AppState>>,
    Json(req): Json<TransactionRequest>,
    headers: HeaderMap,
) -> Response {
    let (user_id, user_role) = extract_user_info(&headers)?;
    let user_context = extract_user_context(&headers);

    // 逐个检查操作
    for op in &req.operations {
        match op {
            BatchOperation::Set(doc) => {
                let config = state.permission_engine.get_permission_config(&doc.collection).await;

                // 检查创建权限
                if !config.can_create(&user_role) {
                    return (StatusCode::FORBIDDEN, "No create permission").into_response();
                }

                // 检查所有者字段
                for owner_field in &config.rules.owner_fields {
                    if let Some(value) = doc.data.get(owner_field) {
                        if value.as_str() != Some(&user_id)
                            && !user_context.contains_key(owner_field)
                            && user_role != "admin" {
                            return (StatusCode::FORBIDDEN, "Invalid owner field").into_response();
                        }
                    }
                }
            }

            BatchOperation::Update { collection, id, updates } => {
                // 获取文档并检查所有权
                let doc = state.storage.get(collection, id).await?.ok_or(StatusCode::NOT_FOUND)?;

                let has_ownership = state.permission_engine.check_ownership(
                    collection,
                    &user_id,
                    &user_role,
                    &user_context,
                    &doc,
                ).await?;

                if !has_ownership {
                    return (StatusCode::FORBIDDEN, "Not owner").into_response();
                }

                // 检查字段修改权限
                for field in updates.as_object().unwrap().keys() {
                    if !state.permission_engine.can_modify_field(collection, &user_role, field) {
                        return (StatusCode::FORBIDDEN, format!("Cannot modify: {}", field)).into_response();
                    }
                }
            }

            BatchOperation::Delete { collection, id } => {
                // 获取文档并检查所有权
                let doc = state.storage.get(collection, id).await?.ok_or(StatusCode::NOT_FOUND)?;

                let has_ownership = state.permission_engine.check_ownership(
                    collection,
                    &user_id,
                    &user_role,
                    &user_context,
                    &doc,
                ).await?;

                if !has_ownership {
                    return (StatusCode::FORBIDDEN, "Not owner").into_response();
                }
            }

            _ => {}
        }
    }

    // 执行批量操作...
    Json(true).into_response()
}
```

### 7. 性能优化

#### 权限配置缓存

```rust
pub struct PermissionEngine {
    cache: Arc<RwLock<HashMap<String, PermissionConfig>>>,
    cache_ttl: Duration,
    last_refresh: Arc<RwLock<HashMap<String, Instant>>>,
}

impl PermissionEngine {
    pub async fn get_permission_config(&self, collection: &str) -> PermissionConfig {
        // 检查缓存是否过期
        if let Some(last) = self.last_refresh.read().unwrap().get(collection) {
            if last.elapsed() < self.cache_ttl {
                if let Some(config) = self.cache.read().unwrap().get(collection) {
                    return config.clone();
                }
            }
        }

        // 重新加载
        self.reload_config(collection).await
    }
}
```

### 8. 默认权限配置

如果没有配置，使用默认规则：

```rust
impl Default for PermissionConfig {
    fn default() -> Self {
        Self {
            collection: "default".to_string(),
            rules: PermissionRules {
                owner_fields: vec!["author_id".to_string(), "owner_id".to_string()],
                protected_fields: vec!["author_id".to_string(), "owner_id".to_string()],
                public_read: false,
                multi_tenant: false,
                tenant_hierarchy: vec![],
                visibility_field: "visibility".to_string(),
            },
            role_permissions: HashMap::new(),
        }
    }
}
```

## 优势总结

✅ **灵活配置**：通过 JSON 配置定义权限规则，无需修改代码
✅ **字段无关**：支持任意所有者字段名
✅ **多租户友好**：支持复杂的租户层级和权限
✅ **白名单机制**：字段级别的保护列表
✅ **性能优化**：权限配置缓存，O(1) 查找
✅ **向后兼容**：默认配置保证现有功能不受影响
✅ **易于维护**：权限规则集中管理，便于审计

## 实施步骤

1. 创建 `permission_engine.rs` 模块
2. 在 `main.rs` 中集成权限引擎
3. 创建初始权限配置文档
4. 更新 HTTP 处理器使用权限引擎
5. 添加完整的权限测试
6. 性能测试和优化
7. 文档编写

## 需要确认的问题

1. **权限配置存储**：使用 `__permissions__` 集合还是单独的配置文件？
2. **用户上下文传递**：通过 Header 传递 `org_id` 等上下文？
3. **权限继承**：是否需要配置继承机制？
4. **性能要求**：权限检查的性能目标是什么？
5. **审计日志**：是否需要记录权限拒绝事件？

请确认此方案是否符合您的需求，或者需要调整？
