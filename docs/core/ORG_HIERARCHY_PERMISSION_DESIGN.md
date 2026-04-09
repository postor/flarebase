# 🏢 企业组织架构权限系统增强设计

## 场景分析

**企业组织架构权限需求：**
- **查看权限**：可以查看自己所在组织 + 上级组织 + 所有下级组织
- **管理权限**：只能管理自己是 lead 的组织 + 其下级组织

**组织结构示例：**
```
公司 (Company)
├── 总部 (HQ)
│   ├── 研发部 (R&D)
│   │   ├── 前端组 (Frontend)
│   │   └── 后端组 (Backend)
│   └── 市场部 (Marketing)
│       └── 品牌组 (Branding)
└── 分公司 A (Branch A)
    └── 销售部 (Sales)
```

**权限示例：**
- 前端组 Lead 可以：
  - 查看：前端组 + 研发部 + 总部 + 公司（向上所有层级）
  - 查看：前端组的所有子组（向下所有层级）
  - 管理：前端组 + 所有子组（因为是 lead）

## 数据结构设计

### 1. 组织架构集合 (`__organizations__`)

```json
{
  "id": "org_frontend",
  "name": "前端组",
  "type": "team",
  "parent_id": "org_rd",
  "level": 3,
  "path": "company,hq,rd,frontend",
  "ancestors": ["company", "hq", "rd"],
  "lead_id": "user_alice",
  "members": ["user_alice", "user_bob", "user_charlie"],
  "metadata": {
    "budget": 100000,
    "location": "Beijing"
  }
}
```

**关键字段：**
- `parent_id`: 父组织 ID
- `level`: 层级深度（根节点 = 0）
- `path`: 完整路径（便于查询）
- `ancestors`: 所有上级组织 ID 数组
- `lead_id`: 组织负责人

### 2. 用户组织关系集合 (`__user_org_roles__`)

```json
{
  "id": "user_alice_role",
  "user_id": "user_alice",
  "org_id": "org_frontend",
  "role": "lead",
  "permissions": ["manage", "view", "approve"]
}
```

### 3. 权限配置增强

```json
{
  "id": "perm_org_resources",
  "collection": "org_resources",
  "rules": {
    "owner_fields": ["org_id"],
    "protected_fields": ["org_id", "created_by"],
    "public_read": false,
    "hierarchy_enabled": true,
    "hierarchy_config": {
      "org_collection": "__organizations__",
      "user_role_collection": "__user_org_roles__",
      "view_scope": "ancestors_and_descendants",
      "manage_scope": "self_and_descendants_if_lead"
    }
  },
  "role_permissions": {
    "admin": { "can_create": true, "can_read": "all", "can_update": "all", "can_delete": "all" },
    "org_lead": { "can_create": true, "can_read": "tree", "can_update": "subtree", "can_delete": "subtree" },
    "org_member": { "can_create": false, "can_read": "tree", "can_update": false, "can_delete": false }
  }
}
```

## 核心算法

### 1. 层级权限检查器

```rust
use std::collections::{HashSet, HashMap};

pub struct HierarchyPermissionChecker {
    storage: Arc<dyn Storage>,
    cache: Arc<RwLock<HashMap<String, OrgNode>>>,
}

#[derive(Debug, Clone)]
struct OrgNode {
    id: String,
    parent_id: Option<String>,
    level: i32,
    path: Vec<String>,
    ancestors: Vec<String>,
    lead_id: String,
}

impl HierarchyPermissionChecker {
    /// 检查用户是否可以查看某个组织的资源
    pub async fn can_view_org_resource(
        &self,
        user_id: &str,
        resource_org_id: &str,
    ) -> Result<bool, PermissionError> {
        // 1. 获取用户所属组织
        let user_orgs = self.get_user_organizations(user_id).await?;

        // 2. 获取资源组织信息
        let resource_org = self.get_org_node(resource_org_id).await?;

        // 3. 检查是否在同一棵树中
        for user_org in &user_orgs {
            // 可以查看：自己所在组织
            if user_org.id == resource_org_id {
                return Ok(true);
            }

            // 可以查看：上级组织
            if resource_org.ancestors.contains(&user_org.id) {
                return Ok(true);
            }

            // 可以查看：下级组织
            if user_org.ancestors.contains(&resource_org.id) {
                return Ok(true);
            }

            // 可以查看：兄弟组织（共享父节点）
            if user_org.parent_id == resource_org.parent_id {
                return Ok(true);
            }
        }

        Ok(false)
    }

    /// 检查用户是否可以管理某个组织的资源
    pub async fn can_manage_org_resource(
        &self,
        user_id: &str,
        resource_org_id: &str,
    ) -> Result<bool, PermissionError> {
        // 1. 获取用户作为 lead 的组织
        let lead_orgs = self.get_user_lead_organizations(user_id).await?;

        // 2. 获取资源组织信息
        let resource_org = self.get_org_node(resource_org_id).await?;

        // 3. 检查是否是 lead 组织或其下级
        for lead_org in &lead_orgs {
            // 可以管理：自己是 lead 的组织
            if lead_org.id == resource_org_id {
                return Ok(true);
            }

            // 可以管理：下级组织（resource 的 ancestors 包含 lead_org）
            if resource_org.ancestors.contains(&lead_org.id) {
                return Ok(true);
            }
        }

        Ok(false)
    }

    /// 获取用户的所有组织
    async fn get_user_organizations(&self, user_id: &str) -> Result<Vec<OrgNode>, PermissionError> {
        // 查询 __user_org_roles__ 集合
        let query = Query {
            collection: "__user_org_roles__".to_string(),
            filters: vec![("user_id".to_string(), QueryOp::Eq(json!(user_id)))],
            ..Default::default()
        };

        let role_docs = self.storage.query(query).await?;
        let mut orgs = Vec::new();

        for role_doc in role_docs {
            if let Some(org_id) = role_doc.data.get("org_id").and_then(|v| v.as_str()) {
                let org_node = self.get_org_node(org_id).await?;
                orgs.push(org_node);
            }
        }

        Ok(orgs)
    }

    /// 获取用户作为 lead 的组织
    async fn get_user_lead_organizations(&self, user_id: &str) -> Result<Vec<OrgNode>, PermissionError> {
        // 查询用户作为 lead 的组织
        let query = Query {
            collection: "__organizations__".to_string(),
            filters: vec![("lead_id".to_string(), QueryOp::Eq(json!(user_id)))],
            ..Default::default()
        };

        let org_docs = self.storage.query(query).await?;
        let mut orgs = Vec::new();

        for org_doc in org_docs {
            let org_node = self.parse_org_node(&org_doc)?;
            orgs.push(org_node);
        }

        Ok(orgs)
    }

    /// 获取组织节点（带缓存）
    async fn get_org_node(&self, org_id: &str) -> Result<OrgNode, PermissionError> {
        // 先查缓存
        if let Some(node) = self.cache.read().unwrap().get(org_id) {
            return Ok(node.clone());
        }

        // 从数据库加载
        let doc = self.storage.get("__organizations__", org_id).await?
            .ok_or_else(|| PermissionError::OrgNotFound(org_id.to_string()))?;

        let node = self.parse_org_node(&doc)?;

        // 写入缓存
        self.cache.write().unwrap().insert(org_id.to_string(), node.clone());

        Ok(node)
    }

    fn parse_org_node(&self, doc: &Document) -> Result<OrgNode, PermissionError> {
        Ok(OrgNode {
            id: doc.id.clone(),
            parent_id: doc.data.get("parent_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            level: doc.data.get("level")
                .and_then(|v| v.as_i64())
                .unwrap_or(0) as i32,
            path: doc.data.get("path")
                .and_then(|v| v.as_str())
                .map(|s| s.split(',').map(|x| x.to_string()).collect())
                .unwrap_or_default(),
            ancestors: doc.data.get("ancestors")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter()
                    .filter_map(|v| v.as_str())
                    .map(|s| s.to_string())
                    .collect())
                .unwrap_or_default(),
            lead_id: doc.data.get("lead_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        })
    }

    /// 获取组织树（用于前端展示）
    pub async fn get_org_tree(&self, root_org_id: &str) -> Result<OrgTree, PermissionError> {
        let root = self.get_org_node(root_org_id).await?;

        // 查询所有下级组织
        let query = Query {
            collection: "__organizations__".to_string(),
            filters: vec![
                ("ancestors".to_string(), QueryOp::Contains(json!(root_org_id)))
            ],
            ..Default::default()
        };

        let all_descendants = self.storage.query(query).await?;

        // 构建树形结构
        let tree = self.build_tree(vec![root], all_descendants)?;

        Ok(tree)
    }

    fn build_tree(&self, nodes: Vec<OrgNode>, all_nodes: Vec<Document>) -> Result<OrgTree, PermissionError> {
        // 递归构建树
        let mut children = Vec::new();

        for node in nodes {
            let node_children: Vec<_> = all_nodes.iter()
                .filter(|doc| {
                    doc.data.get("parent_id")
                        .and_then(|v| v.as_str())
                        == Some(&node.id)
                })
                .map(|doc| self.parse_org_node(doc).unwrap())
                .collect();

            let child_trees = self.build_tree(node_children, all_nodes.clone())?;
            children.push(child_trees);
        }

        Ok(OrgTree {
            id: root_org_id.to_string(),
            children: vec![],
        })
    }
}

#[derive(Debug)]
struct OrgTree {
    id: String,
    children: Vec<OrgTree>,
}
```

### 2. 增强的权限引擎

```rust
impl PermissionEngine {
    /// 检查资源访问权限（支持层级）
    pub async fn can_access_resource(
        &self,
        collection: &str,
        user_id: &str,
        operation: &str,  // "read", "manage", "delete"
        resource: &Document,
    ) -> Result<bool, PermissionError> {
        let config = self.get_permission_config(collection).await;

        // 如果没有启用层级，使用原有逻辑
        if !config.rules.hierarchy_enabled {
            return self.check_basic_permission(collection, user_id, operation, resource).await;
        }

        // 层级权限检查
        let hierarchy_config = config.rules.hierarchy_config.as_ref()
            .ok_or(PermissionError::InvalidConfig)?;

        // 获取资源所属组织
        let resource_org_id = resource.data.get("org_id")
            .and_then(|v| v.as_str())
            .ok_or(PermissionError::MissingOrgId)?;

        match operation {
            "read" => {
                match hierarchy_config.view_scope.as_str() {
                    "ancestors_and_descendants" => {
                        self.hierarchy_checker
                            .can_view_org_resource(user_id, resource_org_id)
                            .await
                    }
                    "all" => Ok(true),
                    _ => Ok(false),
                }
            }
            "manage" | "update" | "delete" => {
                match hierarchy_config.manage_scope.as_str() {
                    "self_and_descendants_if_lead" => {
                        self.hierarchy_checker
                            .can_manage_org_resource(user_id, resource_org_id)
                            .await
                    }
                    "all" => Ok(true),
                    _ => Ok(false),
                }
            }
            _ => Ok(false),
        }
    }

    /// 获取用户可查看的资源范围
    pub async fn get_viewable_orgs(&self, user_id: &str) -> Result<HashSet<String>, PermissionError> {
        let user_orgs = self.hierarchy_checker.get_user_organizations(user_id).await?;
        let mut viewable_orgs = HashSet::new();

        for user_org in user_orgs {
            // 自己所在组织
            viewable_orgs.insert(user_org.id.clone());

            // 所有上级组织
            for ancestor_id in &user_org.ancestors {
                viewable_orgs.insert(ancestor_id.clone());
            }

            // 所有下级组织
            let descendants = self.get_all_descendants(&user_org.id).await?;
            viewable_orgs.extend(descendants);
        }

        Ok(viewable_orgs)
    }

    /// 获取用户可管理的组织范围
    pub async fn get_managable_orgs(&self, user_id: &str) -> Result<HashSet<String>, PermissionError> {
        let lead_orgs = self.hierarchy_checker.get_user_lead_organizations(user_id).await?;
        let mut managable_orgs = HashSet::new();

        for lead_org in lead_orgs {
            // 自己是 lead 的组织
            managable_orgs.insert(lead_org.id.clone());

            // 所有下级组织
            let descendants = self.get_all_descendants(&lead_org.id).await?;
            managable_orgs.extend(descendants);
        }

        Ok(managable_orgs)
    }

    /// 获取所有下级组织
    async fn get_all_descendants(&self, org_id: &str) -> Result<HashSet<String>, PermissionError> {
        let query = Query {
            collection: "__organizations__".to_string(),
            filters: vec![
                ("ancestors".to_string(), QueryOp::Contains(json!(org_id)))
            ],
            ..Default::default()
        };

        let docs = self.storage.query(query).await?;
        let mut descendants = HashSet::new();

        for doc in docs {
            descendants.insert(doc.id.clone());
        }

        Ok(descendants)
    }
}
```

### 3. HTTP 处理器集成

```rust
async fn create_org_resource(
    State(state): State<Arc<AppState>>,
    Json(data): Json<serde_json::Value>,
    headers: HeaderMap,
) -> Response {
    let (user_id, user_role) = extract_user_info(&headers)?;

    // 获取要创建资源的组织
    let org_id = data.get("org_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "Missing org_id"))?;

    // 检查是否可以管理该组织
    let can_manage = state.permission_engine
        .can_access_resource("org_resources", &user_id, "manage", &Document {
            id: "temp".to_string(),
            collection: "org_resources".to_string(),
            data: data.clone(),
            version: 0,
            created_at: 0,
            updated_at: 0,
        }).await;

    if !can_manage.unwrap_or(false) {
        return (StatusCode::FORBIDDEN, "Cannot manage resources in this organization").into_response();
    }

    // 创建资源...
}

async fn query_org_resources(
    State(state): State<Arc<AppState>>,
    Json(query): Json<Query>,
    headers: HeaderMap,
) -> Response {
    let (user_id, user_role) = extract_user_info(&headers)?;

    // 执行查询
    let docs = state.storage.query(query).await?;

    // 获取用户可查看的组织范围
    let viewable_orgs = state.permission_engine
        .get_viewable_orgs(&user_id)
        .await?;

    // 过滤结果
    let filtered: Vec<_> = docs.into_iter()
        .filter(|doc| {
            if let Some(org_id) = doc.data.get("org_id").and_then(|v| v.as_str()) {
                viewable_orgs.contains(org_id)
            } else {
                false
            }
        })
        .collect();

    Json(filtered).into_response()
}
```

## 配置示例

### 企业组织资源权限配置

```json
{
  "id": "perm_org_resources",
  "collection": "org_resources",
  "rules": {
    "owner_fields": ["org_id"],
    "protected_fields": ["org_id", "created_by"],
    "public_read": false,
    "hierarchy_enabled": true,
    "hierarchy_config": {
      "org_collection": "__organizations__",
      "user_role_collection": "__user_org_roles__",
      "view_scope": "ancestors_and_descendants",
      "manage_scope": "self_and_descendants_if_lead"
    }
  }
}
```

### 场景验证

**场景：前端组 Lead Alice**

```javascript
// Alice 可以查看的资源范围
const viewableOrgs = await permissionEngine.getViewableOrgs("user_alice");
// ["org_frontend", "org_rd", "org_hq", "company", "org_backend"]

// Alice 可以管理的资源范围
const managableOrgs = await permissionEngine.getManagableOrgs("user_alice");
// ["org_frontend"] + 前端组的所有子组

// 查询操作 - 只返回可查看组织的资源
const resources = await query("org_resources", { /* 查询条件 */ });
// 自动过滤：只返回 org_id 在 viewableOrgs 中的资源

// 创建操作 - 检查是否可以管理目标组织
await create("org_resources", {
  org_id: "org_frontend",  // ✅ 可以（自己是 lead）
  // ...
});

await create("org_resources", {
  org_id: "org_backend",  // ❌ 不可以（不是 lead）
  // ...
});
```

## 性能优化

### 1. 组织缓存预加载

```rust
impl HierarchyPermissionChecker {
    /// 预加载整个组织树到缓存
    pub async fn preload_org_tree(&self, root_org_id: &str) -> Result<(), PermissionError> {
        let query = Query {
            collection: "__organizations__".to_string(),
            filters: vec![],
            ..Default::default()
        };

        let all_orgs = self.storage.query(query).await?;

        let mut cache = self.cache.write().unwrap();
        for org_doc in all_orgs {
            let node = self.parse_org_node(&org_doc)?;
            cache.insert(node.id.clone(), node);
        }

        Ok(())
    }
}
```

### 2. 用户权限缓存

```rust
pub struct UserPermissionCache {
    viewable_orgs: Arc<RwLock<HashMap<String, HashSet<String>>>>,
    managable_orgs: Arc<RwLock<HashMap<String, HashSet<String>>>>,
    cache_ttl: Duration,
}
```

## 测试案例

```rust
#[tokio::test]
async fn test_hierarchy_permissions() {
    // 设置组织结构
    setup_org_tree().await;

    // Alice 是前端组 Lead
    assert!(can_view_resource("user_alice", "org_frontend").await);  // ✅ 自己
    assert!(can_view_resource("user_alice", "org_rd").await);       // ✅ 上级
    assert!(can_view_resource("user_alice", "org_hq").await);       // ✅ 上级
    assert!(can_view_resource("user_alice", "company").await);      // ✅ 根节点
    assert!(can_view_resource("user_alice", "org_backend").await);  // ✅ 兄弟组织

    assert!(can_manage_resource("user_alice", "org_frontend").await); // ✅ 自己是 lead
    assert!(can_manage_resource("user_alice", "org_rd").await.is_err()); // ❌ 不是 lead

    // Bob 是后端组成员（不是 lead）
    assert!(can_view_resource("user_bob", "org_rd").await);        // ✅ 上级
    assert!(can_view_resource("user_bob", "org_frontend").await);  // ✅ 兄弟组织
    assert!(can_manage_resource("user_bob", "org_backend").await.is_err()); // ❌ 不是 lead
}
```

## 总结

### ✅ 能够解决的问题

1. **层级查看权限**：可以查看上级 + 自己 + 下级 + 兄弟组织
2. **lead 管理权限**：只能管理自己是 lead 的组织及其下级
3. **灵活的组织结构**：支持任意深度的树形结构
4. **性能优化**：通过缓存和预加载优化性能
5. **查询过滤**：自动过滤用户无权访问的资源

### 需要额外支持的

1. **权限继承**：子组织是否继承父组织的权限？
2. **临时授权**：如何处理临时的跨组织授权？
3. **权限审计**：记录谁访问了哪些组织的资源
4. **动态组织结构**：组织结构调整时的权限更新

这个增强设计完全能够解决您提出的企业组织架构权限场景！
