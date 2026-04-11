use axum::{
    extract::{Path, State},
    http::{StatusCode, Method},
    routing::{get, post, put, delete},
    Json, Router,
};
use flare_db::redb::RedbStorage;
use flare_db::{SledStorage, Storage, memory::MemoryStorage, persistence::PersistenceManager};
use flare_protocol::{Document, Event, EventType, Webhook, Query, TransactionRequest, BatchOperation};
use flare_protocol::cluster::cluster_service_server::ClusterServiceServer;
use socketioxide::{
    extract::{Data, SocketRef},
    SocketIo,
};
use std::sync::Arc;
use tower_http::cors::{CorsLayer, Any};
use tonic::transport::Server;
use tokio::time::Duration;
use async_trait::async_trait;

pub mod cluster;
pub mod hooks;
pub mod hook_manager;
pub mod permissions;
pub mod whitelist; // 新增白名单模块
pub mod jwt_middleware; // JWT认证中间件
pub mod cors_config; // CORS配置模块

// Re-export for integration tests
pub use cluster::ClusterManager;
pub use hooks::{EventBus, WebhookDispatcher, WebhooksProvider};
pub use hook_manager::HookManager;
pub use permissions::{Authorizer, PermissionContext, ResourceType};
pub use whitelist::{QueryExecutor, QueryResult, UserContext};
use flare_protocol::{HookRegister, HookResponse};

/// Parse HTTP method from string
fn parse_method(method: &str) -> Option<Method> {
    match method.to_uppercase().as_str() {
        "GET" => Some(Method::GET),
        "POST" => Some(Method::POST),
        "PUT" => Some(Method::PUT),
        "DELETE" => Some(Method::DELETE),
        "PATCH" => Some(Method::PATCH),
        "OPTIONS" => Some(Method::OPTIONS),
        "HEAD" => Some(Method::HEAD),
        _ => None,
    }
}

#[async_trait]
impl WebhooksProvider for RedbStorage {
    async fn get_webhooks_for_event(&self, event_type: &EventType) -> anyhow::Result<Vec<Webhook>> {
        let docs = self.list("__webhooks__").await?;
        let mut result = Vec::new();
        for doc in docs {
            let url = doc.data.get("url")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing url in webhook"))?
                .to_string();
            let secret = doc.data.get("secret")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let events: Vec<EventType> = serde_json::from_value(
                doc.data.get("events")
                    .cloned()
                    .unwrap_or(serde_json::json!([]))
            )?;

            let webhook = Webhook {
                id: doc.id.clone(),
                url,
                events,
                secret,
            };

            if webhook.events.contains(event_type) {
                result.push(webhook);
            }
        }
        Ok(result)
    }
}

#[async_trait]
impl WebhooksProvider for SledStorage {
    async fn get_webhooks_for_event(&self, event_type: &EventType) -> anyhow::Result<Vec<Webhook>> {
        let docs = self.list("__webhooks__").await?;
        let mut result = Vec::new();
        for doc in docs {
            // Extract webhook fields directly from doc.data
            let url = doc.data.get("url")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing url in webhook"))?
                .to_string();
            let secret = doc.data.get("secret")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let events: Vec<EventType> = serde_json::from_value(
                doc.data.get("events")
                    .cloned()
                    .unwrap_or(serde_json::json!([]))
            )?;

            let webhook = Webhook {
                id: doc.id.clone(),
                url,
                events,
                secret,
            };

            if webhook.events.contains(event_type) {
                result.push(webhook);
            }
        }
        Ok(result)
    }
}

#[async_trait]
impl WebhooksProvider for MemoryStorage {
    async fn get_webhooks_for_event(&self, event_type: &EventType) -> anyhow::Result<Vec<Webhook>> {
        use flare_db::Storage;

        let docs = self.list("__webhooks__").await?;
        let mut result = Vec::new();
        for doc in docs {
            // Extract webhook fields directly from doc.data
            let url = doc.data.get("url")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing url in webhook"))?
                .to_string();
            let secret = doc.data.get("secret")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let events: Vec<EventType> = serde_json::from_value(
                doc.data.get("events")
                    .cloned()
                    .unwrap_or(serde_json::json!([]))
            )?;

            let webhook = Webhook {
                id: doc.id.clone(),
                url,
                events,
                secret,
            };

            if webhook.events.contains(event_type) {
                result.push(webhook);
            }
        }
        Ok(result)
    }
}

pub struct AppState {
    storage: Arc<dyn Storage>,
    io: SocketIo,
    cluster: Arc<ClusterManager>,
    node_id: u64,
    event_bus: Arc<EventBus>,
    hook_manager: Arc<HookManager>,
    query_executor: Arc<QueryExecutor>, // 新增白名单查询执行器
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let node_id: u64 = std::env::var("NODE_ID").unwrap_or("1".to_string()).parse()?;
    let grpc_addr = std::env::var("GRPC_ADDR").unwrap_or("0.0.0.0:50051".to_string());
    let http_addr = std::env::var("HTTP_ADDR").unwrap_or("0.0.0.0:3000".to_string());

    let (io_layer, io) = SocketIo::builder().build_layer();

    // Storage backend selection
    let storage_backend = std::env::var("FLARE_STORAGE_BACKEND").unwrap_or("redb".to_string());
    let storage: Arc<dyn Storage> = match storage_backend.as_str() {
        "memory" => {
            tracing::info!("Using in-memory storage backend");

            // Check if persistence is enabled
            let snapshot_path = std::env::var("FLARE_MEMORY_SNAPSHOT_PATH")
                .unwrap_or(format!("./flare_{}_memory.json", node_id));
            let snapshot_interval = std::env::var("FLARE_MEMORY_SNAPSHOT_INTERVAL")
                .unwrap_or("60".to_string())
                .parse::<u64>()
                .unwrap_or(60);

            let memory_storage = MemoryStorage::new();

            // Start persistence manager if snapshot path is provided
            if !snapshot_path.is_empty() {
                let mut persistence_manager = PersistenceManager::new(
                    memory_storage.clone(),
                    snapshot_path.clone(),
                    Duration::from_secs(snapshot_interval),
                );

                persistence_manager.start().await?;
                tracing::info!("Memory persistence enabled: snapshot every {}s to {}", snapshot_interval, snapshot_path);
            }

            Arc::new(memory_storage)
        }
        "sled" => {
            tracing::info!("Using SledDB storage backend");
            let db_path = std::env::var("FLARE_DB_PATH").unwrap_or(format!("./flare_{}.db", node_id));
            Arc::new(SledStorage::new(db_path)?)
        }
        _ => {
            tracing::info!("Using Redb storage backend");
            let db_path = std::env::var("FLARE_DB_PATH").unwrap_or(format!("./flare_{}.redb", node_id));
            Arc::new(RedbStorage::new(db_path)?)
        }
    };

    let cluster = Arc::new(ClusterManager::new());
    let (event_bus, event_rx) = EventBus::new();
    let event_bus = Arc::new(event_bus);
    let hook_manager = Arc::new(HookManager::new());

    // 🔒 加载白名单查询配置
    let query_executor = {
        let default_config = r#"
        {
          "queries": {
            "list_published_posts": {
              "type": "simple",
              "collection": "posts",
              "filters": [
                ["status", {"Eq": "published"}]
              ]
            },
            "list_my_posts": {
              "type": "simple",
              "collection": "posts",
              "filters": [
                ["author_id", {"Eq": "$USER_ID"}]
              ]
            },
            "get_post_with_author": {
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
              ],
              "output": {
                "title": "$post.data.title",
                "content": "$post.data.content",
                "author_name": "$author.data.name"
              }
            }
          }
        }
        "#;

        // 尝试从配置文件加载，如果失败则使用默认配置
        let config_path = std::env::var("WHITELIST_CONFIG_PATH").unwrap_or("named_queries.json".to_string());
        let config_json = if std::path::Path::new(&config_path).exists() {
            tracing::info!("Loading whitelist config from: {}", config_path);
            std::fs::read_to_string(&config_path).unwrap_or_else(|_| {
                tracing::warn!("Failed to read whitelist config file, using defaults");
                default_config.to_string()
            })
        } else {
            tracing::info!("Using default whitelist config");
            default_config.to_string()
        };

        match QueryExecutor::from_json(&config_json) {
            Ok(executor) => {
                tracing::info!("✅ Whitelist query executor initialized successfully");
                Arc::new(QueryExecutor::with_storage(executor.config, storage.clone()))
            }
            Err(err) => {
                tracing::error!("❌ Failed to initialize whitelist query executor: {:?}", err);
                tracing::error!("🔄 Falling back to empty whitelist (no queries allowed)");
                // 使用空配置作为回退
                let fallback_executor = QueryExecutor::from_json("{\"queries\": {}}").unwrap();
                Arc::new(QueryExecutor::with_storage(fallback_executor.config, storage.clone()))
            }
        }
    };

    // --- Start webhook dispatcher before creating state ---
    // Create a simple wrapper that implements WebhooksProvider
    let webhooks_provider = {
        struct ProviderWrapper(Arc<dyn Storage>);
        #[async_trait::async_trait]
        impl WebhooksProvider for ProviderWrapper {
            async fn get_webhooks_for_event(&self, event_type: &EventType) -> anyhow::Result<Vec<Webhook>> {
                let docs = self.0.list("__webhooks__").await?;
                let mut result = Vec::new();
                for doc in docs {
                    let url = doc.data.get("url")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| anyhow::anyhow!("Missing url in webhook"))?
                        .to_string();
                    let secret = doc.data.get("secret")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let events: Vec<EventType> = serde_json::from_value(
                        doc.data.get("events")
                            .cloned()
                            .unwrap_or(serde_json::json!([]))
                    )?;

                    let webhook = Webhook {
                        id: doc.id.clone(),
                        url,
                        events,
                        secret,
                    };

                    if webhook.events.contains(event_type) {
                        result.push(webhook);
                    }
                }
                Ok(result)
            }
        }
        Arc::new(ProviderWrapper(storage.clone()))
    };
    tokio::spawn(async move {
        let dispatcher = WebhookDispatcher::new();
        dispatcher.run(event_rx, webhooks_provider).await;
    });

    let state = Arc::new(AppState {
        storage,
        io: io.clone(),
        cluster,
        node_id,
        event_bus,
        hook_manager,
        query_executor, // 添加白名单查询执行器
    });

    // --- WebSocket Namespaces ---

    let state_ns = Arc::clone(&state);
    io.ns("/", move |socket: SocketRef| {
        let st = Arc::clone(&state_ns);
        tracing::info!("socket connected: {}", socket.id);

        let _ = socket.join(format!("session:{}", socket.id));

        socket.on("subscribe", |socket: SocketRef, Data(collection): Data<String>| {
            let _ = socket.join(collection);
        });

        // 为每个事件处理器单独克隆状态
        let st_hook = Arc::clone(&st);
        socket.on("call_hook", move |socket: SocketRef, Data((event, params)): Data<(String, serde_json::Value)>| {
            let stc = Arc::clone(&st_hook);
            let session_id = socket.id.to_string();
            let event_name = event.clone();
            tokio::spawn(async move {
                match stc.hook_manager.call_hook(event, session_id, params, |hook_sid, req_data| {
                    // Send to the hook socket in /hooks namespace by targeting the global hook room
                    tracing::info!("Sending hook request to socket {} for event {}", hook_sid, event_name);
                    // Use the global hook room that the hook socket joined
                    let _ = stc.io.to(format!("global_hook_{}", hook_sid)).emit("hook_request", &req_data);
                }).await {
                    Ok(res) => {
                        tracing::info!("Hook call successful for event {:?}", res);
                        let _ = socket.emit("hook_success", &res);
                    }
                    Err(e) => {
                        tracing::error!("Hook call failed for event {}: {}", event_name, e);
                        let _ = socket.emit("hook_error", &e.to_string());
                    }
                }
            });
        });

        // 🔒 白名单查询支持 - 通过 WebSocket 执行安全的命名查询
        let st_query = Arc::clone(&st);
        socket.on("named_query", move |socket: SocketRef, Data(data): Data<serde_json::Value>| {
            let stc = Arc::clone(&st_query);
            let socket_id = socket.id.to_string();

            eprintln!("🔍 [DEBUG] named_query received data: {:?}", data);

            tokio::spawn(async move {
                // 解析传入的数据 - 支持数组格式 [query_name, params]
                let (query_name, params) = if data.is_array() {
                    let arr = data.as_array().unwrap();
                    if arr.len() >= 2 {
                        let qn = arr[0].as_str().unwrap_or("").to_string();
                        let pr = arr[1].clone();
                        (qn, pr)
                    } else {
                        eprintln!("❌ [DEBUG] named_query: array too short");
                        let _ = socket.emit("query_error", &serde_json::json!({"error": "Invalid query format"}));
                        return;
                    }
                } else if data.get("query").is_some() {
                    let qn = data.get("query").unwrap().as_str().unwrap_or("").to_string();
                    let pr = data.get("params").cloned().unwrap_or(serde_json::json!({}));
                    (qn, pr)
                } else {
                    eprintln!("❌ [DEBUG] named_query: unrecognized format");
                    let _ = socket.emit("query_error", &serde_json::json!({"error": "Invalid query format"}));
                    return;
                };

                eprintln!("🔍 [DEBUG] parsed query_name: {}, params: {:?}", query_name, params);

                use std::collections::HashMap;

                // 从 WebSocket 连接中提取用户信息 (假设在连接时已认证)
                let user_id = "guest".to_string();
                let user_role = "guest".to_string();

                let user_context = UserContext {
                    user_id: user_id.clone(),
                    user_role: user_role.clone(),
                };

                // 转换参数格式
                let client_params: HashMap<String, serde_json::Value> =
                    serde_json::from_value(params).unwrap_or_else(|_| HashMap::new());

                // 执行白名单查询
                let start_time = std::time::Instant::now();
                eprintln!("🔍 [DEBUG] Executing query: {} with params: {:?}", query_name, client_params);

                match stc.query_executor.execute_query(&query_name, &user_context, &client_params) {
                    Ok(result) => {
                        let duration = start_time.elapsed();
                        eprintln!("✅ [DEBUG] Query executed successfully: {} | Time: {:?}", query_name, duration);

                        // 转换结果为 JSON
                        if let Ok(json_result) = serde_json::to_value(&result) {
                            let _ = socket.emit("query_success", &json_result);
                        } else {
                            eprintln!("❌ [DEBUG] Failed to serialize query result");
                            let _ = socket.emit("query_error", &serde_json::json!({
                                "error": "Failed to serialize query result"
                            }));
                        }
                    }
                    Err(err) => {
                        let duration = start_time.elapsed();
                        eprintln!("❌ [DEBUG] Query execution failed: {} | Error: {:?} | Time: {:?}", query_name, err, duration);

                        let _ = socket.emit("query_error", &serde_json::json!({
                            "error": err.to_string(),
                            "query": query_name
                        }));
                    }
                }
            });
        });

        // 📝 集合操作 - 通过 Socket.IO
        let st_collection = Arc::clone(&st);
        socket.on("insert", move |socket: SocketRef, Data(data): Data<serde_json::Value>| {
            let stc = Arc::clone(&st_collection);

            tokio::spawn(async move {
                let collection = data.get("collection").and_then(|v| v.as_str()).unwrap_or("");
                let doc_data = data.get("data").cloned().unwrap_or(serde_json::json!({}));

                let doc = Document::new(collection.to_string(), doc_data);

                match stc.storage.insert(doc.clone()).await {
                    Ok(_) => {
                        broadcast_op(Arc::clone(&stc), collection.to_string(), "doc_created", serde_json::to_value(&doc).unwrap()).await;
                        let _ = socket.emit("insert_success", &doc);
                    }
                    Err(e) => {
                        let _ = socket.emit("insert_error", &serde_json::json!({"error": e.to_string()}));
                    }
                }
            });
        });

        let st_get = Arc::clone(&st);
        socket.on("get", move |socket: SocketRef, Data(data): Data<serde_json::Value>| {
            let stc = Arc::clone(&st_get);

            tokio::spawn(async move {
                let collection = data.get("collection").and_then(|v| v.as_str()).unwrap_or("");
                let id = data.get("id").and_then(|v| v.as_str()).unwrap_or("");

                match stc.storage.get(collection, id).await {
                    Ok(Some(doc)) => { let _ = socket.emit("get_success", &doc); }
                    Ok(None) => { let _ = socket.emit("get_success", serde_json::json!(null)); }
                    Err(e) => { let _ = socket.emit("get_error", &serde_json::json!({"error": e.to_string()})); }
                }
            });
        });

        let st_list = Arc::clone(&st);
        socket.on("list", move |socket: SocketRef, Data(data): Data<serde_json::Value>| {
            let stc = Arc::clone(&st_list);

            tokio::spawn(async move {
                let collection = data.get("collection").and_then(|v| v.as_str()).unwrap_or("");

                match stc.storage.list(collection).await {
                    Ok(docs) => {
                        // 将数组包装在对象中发送，避免 Socket.IO 的数组处理问题
                        let response = serde_json::json!({
                            "results": docs,
                            "count": docs.len()
                        });
                        let _ = socket.emit("list_success", &response);
                    }
                    Err(e) => { let _ = socket.emit("list_error", &serde_json::json!({"error": e.to_string()})); }
                }
            });
        });

        let st_update = Arc::clone(&st);
        socket.on("update", move |socket: SocketRef, Data(data): Data<serde_json::Value>| {
            let stc = Arc::clone(&st_update);
            let collection_clone = data.get("collection").and_then(|v| v.as_str()).map(|s| s.to_string());

            tokio::spawn(async move {
                let collection = data.get("collection").and_then(|v| v.as_str()).unwrap_or("");
                let id = data.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let update_data = data.get("data").cloned().unwrap_or(serde_json::json!({}));

                let result = stc.storage.get(collection, id).await;
                let (doc, is_new) = match result {
                    Ok(Some(mut d)) => {
                        d.data = update_data;
                        d.version += 1;
                        d.updated_at = chrono::Utc::now().timestamp_millis();
                        (d, false)
                    }
                    _ => {
                        let mut doc = Document::new(collection.to_string(), update_data);
                        doc.id = id.to_string();
                        (doc, true)
                    }
                };

                match stc.storage.insert(doc.clone()).await {
                    Ok(_) => {
                        if let Some(coll) = collection_clone {
                            if is_new {
                                broadcast_op(Arc::clone(&stc), coll, "doc_created", serde_json::to_value(&doc).unwrap()).await;
                            } else {
                                broadcast_op(Arc::clone(&stc), coll, "doc_updated", serde_json::to_value(&doc).unwrap()).await;
                            }
                        }
                        let _ = socket.emit("update_success", &doc);
                    }
                    Err(e) => {
                        let _ = socket.emit("update_error", &serde_json::json!({"error": e.to_string()}));
                    }
                }
            });
        });

        let st_delete = Arc::clone(&st);
        socket.on("delete", move |socket: SocketRef, Data(data): Data<serde_json::Value>| {
            let stc = Arc::clone(&st_delete);
            let collection_clone = data.get("collection").and_then(|v| v.as_str()).map(|s| s.to_string());

            tokio::spawn(async move {
                let collection = data.get("collection").and_then(|v| v.as_str()).unwrap_or("");
                let id = data.get("id").and_then(|v| v.as_str()).unwrap_or("");

                match stc.storage.delete(collection, id).await {
                    Ok(_) => {
                        if let Some(coll) = collection_clone {
                            let _ = stc.io.to(coll).emit("doc_deleted", &id);
                        }
                        let _ = socket.emit("delete_success", true);
                    }
                    Err(e) => {
                        let _ = socket.emit("delete_error", &serde_json::json!({"error": e.to_string()}));
                    }
                }
            });
        });
    });

    let hook_manager_ns = Arc::clone(&state.hook_manager);
    io.ns("/hooks", move |socket: SocketRef| {
        let hm = Arc::clone(&hook_manager_ns);
        let sid = socket.id.to_string();

        // Join a room with the same name as the socket ID for easy targeting
        socket.join(sid.clone());

        // Also join a global hook room that can be targeted from any namespace
        socket.join(format!("global_hook_{}", sid));

        socket.on("register", move |socket: SocketRef, Data(reg): Data<HookRegister>| {
            hm.register_hook(socket.id.to_string(), reg);
        });
        
        let hm_resp = Arc::clone(&hook_manager_ns);
        socket.on("hook_response", move |Data(resp): Data<HookResponse>| {
            hm_resp.handle_response(resp);
        });

        let hm_disconnect = Arc::clone(&hook_manager_ns);
        let sid_disconnect = sid.clone();
        socket.on_disconnect(move || {
            hm_disconnect.remove_hook(&sid_disconnect);
        });
    });

    // --- Background Tasks ---

    let monitor_state = Arc::clone(&state);
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        loop {
            interval.tick().await;
            monitor_nodes(&monitor_state).await;
        }
    });

    let grpc_cluster = state.cluster.clone();
    let grpc_addr_parsed = grpc_addr.parse()?;
    tokio::spawn(async move {
        Server::builder()
            .add_service(ClusterServiceServer::from_arc(grpc_cluster))
            .serve(grpc_addr_parsed)
            .await
            .expect("gRPC server failed");
    });

    // --- HTTP Router ---

    // 公开端点（不需要JWT认证）
    let public_routes = Router::new()
        .route("/call_hook/auth", post(call_hook)) // auth hook 用于登录/注册
        .route("/health", get(health_check))
        .route("/queries/:name", post(run_named_query)); // ✅ 白名单查询公开访问 (用于 SWR)

    // 受保护端点（需要JWT认证）
    let protected_routes = Router::new()
        .route("/collections/:collection", post(create_doc).get(list_docs))
        .route("/collections/:collection/:id", get(get_doc))
        .route("/collections/:collection/:id", put(update_doc))
        .route("/collections/:collection/:id", delete(delete_doc))
        .route("/query", post(run_query))
        .route("/transaction", post(commit_transaction))
        .route("/call_hook/:event", post(call_hook))
        .layer(axum::middleware::from_fn(
            jwt_middleware::jwt_middleware,
        ));

    // --- CORS Configuration ---
    // Load CORS configuration from file or use defaults
    let cors_config = cors_config::load_cors_config_from_env();
    tracing::info!("CORS Configuration: {} origins, credentials: {}",
                   cors_config.allowed_origins.len(),
                   cors_config.allow_credentials);

    // Build CORS layer from configuration
    let methods: Vec<Method> = cors_config.allowed_methods
        .iter()
        .filter_map(|m| parse_method(m))
        .collect();

    let headers: Vec<axum::http::HeaderName> = cors_config.allowed_headers
        .iter()
        .filter_map(|h| h.parse().ok())
        .collect();

    let cors = if cors_config.allowed_origins.contains(&"*".to_string()) {
        // Wildcard origin - cannot use with credentials
        if cors_config.allow_credentials {
            tracing::warn!("CORS: Cannot use wildcard origin with credentials. Disabling credentials.");
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(methods)
                .allow_headers(headers)
                .allow_credentials(false)
                .max_age(std::time::Duration::from_secs(cors_config.max_age_secs))
        } else {
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(methods)
                .allow_headers(headers)
                .allow_credentials(false)
                .max_age(std::time::Duration::from_secs(cors_config.max_age_secs))
        }
    } else if cors_config.allowed_origins.is_empty() {
        // No origins specified - use common development origins
        let default_origins = vec![
            "http://localhost:3000".parse::<axum::http::HeaderValue>().unwrap(),
            "http://127.0.0.1:3000".parse::<axum::http::HeaderValue>().unwrap(),
            "http://localhost:3001".parse::<axum::http::HeaderValue>().unwrap(),
            "http://localhost:3002".parse::<axum::http::HeaderValue>().unwrap(),
            "http://127.0.0.1:3002".parse::<axum::http::HeaderValue>().unwrap(),
        ];
        tracing::info!("CORS: No origins specified, using common development origins");

        CorsLayer::new()
            .allow_origin(tower_http::cors::AllowOrigin::list(default_origins))
            .allow_methods(methods)
            .allow_headers(headers)
            .allow_credentials(cors_config.allow_credentials)
            .max_age(std::time::Duration::from_secs(cors_config.max_age_secs))
    } else {
        // Specific origins
        let origins: Vec<_> = cors_config.allowed_origins
            .iter()
            .filter_map(|o| o.parse().ok())
            .collect();

        CorsLayer::new()
            .allow_origin(tower_http::cors::AllowOrigin::list(origins))
            .allow_methods(methods)
            .allow_headers(headers)
            .allow_credentials(cors_config.allow_credentials)
            .max_age(std::time::Duration::from_secs(cors_config.max_age_secs))
    };

    let app = public_routes
        .merge(protected_routes)
        .layer(cors)
        .layer(io_layer)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(http_addr).await?;
    tracing::info!("Flarebase Node listening on HTTP {}", listener.local_addr()?);
    axum::serve(listener, app).await?;

    Ok(())
}

async fn monitor_nodes(state: &AppState) {
    let now = chrono::Utc::now().timestamp_millis();
    let mut nodes = state.cluster.nodes.write().unwrap();
    let dead_nodes: Vec<u64> = nodes.iter()
        .filter(|n| now - n.last_heartbeat > 15000)
        .map(|n| n.id)
        .collect();

    for id in dead_nodes {
        tracing::warn!("Node {} is dead, triggered re-balancing...", id);
        nodes.retain(|n| n.id != id);
    }
}

// --- HTTP Handlers ---

/// Health check endpoint (public, no auth required)
async fn health_check() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "healthy",
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}

async fn create_doc(
    State(state): State<Arc<AppState>>,
    Path(collection): Path<String>,
    Json(data): Json<serde_json::Value>,
) -> Json<Document> {
    let doc = Document::new(collection.clone(), data);
    let _ = state.storage.insert(doc.clone()).await;

    broadcast_op(Arc::clone(&state), collection, "doc_created", serde_json::to_value(&doc).unwrap()).await;

    let _ = state.event_bus.emit(Event {
        event_type: EventType::DocCreated,
        payload: serde_json::to_value(&doc).unwrap(),
        timestamp: doc.updated_at,
    });

    Json(doc)
}

async fn update_doc(
    State(state): State<Arc<AppState>>,
    Path((collection, id)): Path<(String, String)>,
    Json(data): Json<serde_json::Value>,
) -> Json<Document> {
    let (doc, is_new) = match state.storage.get(&collection, &id).await.unwrap() {
        Some(mut d) => {
            d.data = data;
            d.version += 1;
            d.updated_at = chrono::Utc::now().timestamp_millis();
            (d, false)
        }
        None => {
            // Create new document with specific ID (upsert behavior)
            let mut doc = Document::new(collection.clone(), data);
            doc.id = id;
            (doc, true)
        }
    };

    let _ = state.storage.insert(doc.clone()).await;

    if is_new {
        broadcast_op(Arc::clone(&state), collection.clone(), "doc_created", serde_json::to_value(&doc).unwrap()).await;
        let _ = state.event_bus.emit(Event {
            event_type: EventType::DocCreated,
            payload: serde_json::to_value(&doc).unwrap(),
            timestamp: doc.updated_at,
        });
    } else {
        broadcast_op(Arc::clone(&state), collection.clone(), "doc_updated", serde_json::to_value(&doc).unwrap()).await;
        let _ = state.event_bus.emit(Event {
            event_type: EventType::DocUpdated,
            payload: serde_json::to_value(&doc).unwrap(),
            timestamp: doc.updated_at,
        });
    }

    Json(doc)
}

async fn list_docs(State(state): State<Arc<AppState>>, Path(collection): Path<String>) -> Json<Vec<Document>> {
    let docs = state.storage.list(&collection).await.unwrap();
    Json(docs)
}

async fn get_doc(State(state): State<Arc<AppState>>, Path((collection, id)): Path<(String, String)>) -> Json<Option<Document>> {
    let doc = state.storage.get(&collection, &id).await.unwrap();
    Json(doc)
}

async fn delete_doc(
    State(state): State<Arc<AppState>>,
    Path((collection, id)): Path<(String, String)>,
) -> Json<bool> {
    let _ = state.storage.delete(&collection, &id).await;
    let _ = state.io.to(collection.clone()).emit("doc_deleted", &id);

    let _ = state.event_bus.emit(Event {
        event_type: EventType::DocDeleted,
        payload: serde_json::json!({ "id": id, "collection": collection }),
        timestamp: chrono::Utc::now().timestamp_millis(),
    });

    Json(true)
}

async fn run_query(State(state): State<Arc<AppState>>, Json(query): Json<Query>) -> Json<Vec<Document>> {
    let docs = state.storage.query(query).await.unwrap();
    Json(docs)
}

/// 🔒 白名单查询 REST 端点 - 用于 SWR 缓存和初始加载
/// 通过 HTTP 执行安全的命名查询，支持浏览器缓存
async fn run_named_query(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    Path(name): Path<String>,
    Json(params): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    use std::collections::HashMap;

    // 1. 提取用户信息 (如果提供了认证头)
    let (user_id, user_role) = match extract_user_info_auth(&headers) {
        Ok(info) => info,
        Err(_) => ("guest".to_string(), "guest".to_string()), // 允许guest访问公开查询
    };

    // 2. 创建用户上下文
    let user_context = UserContext {
        user_id: user_id.clone(),
        user_role: user_role.clone(),
    };

    // 3. 转换参数格式
    let client_params: HashMap<String, serde_json::Value> = if let Ok(obj) = serde_json::from_value(params) {
        obj
    } else {
        eprintln!("❌ Invalid parameters format for query '{}'", name);
        return Err(StatusCode::BAD_REQUEST);
    };

    // 4. 执行白名单查询 (带日志)
    let start_time = std::time::Instant::now();
    eprintln!("🔍 REST Whitelist Query: {} | User: {} ({})", name, user_id, user_role);

    let result = state.query_executor
        .execute_query(&name, &user_context, &client_params)
        .map_err(|err| {
            eprintln!("❌ Query execution failed: {} | Error: {:?}", name, err);
            StatusCode::FORBIDDEN
        })?;

    let duration = start_time.elapsed();
    eprintln!("✅ Query executed successfully: {} | Time: {:?}", name, duration);

    // 5. 临时修复：如果返回的是查询定义，执行实际的数据库查询
    let json_result = match &result {
        QueryResult::Simple(simple) => {
            // 这意味着查询执行器只返回了查询定义，需要实际执行查询
            eprintln!("⚠️  Query executor returned definition, executing actual query for: {}", name);

            // 获取所有文档，然后在内存中过滤（临时方案）
            let all_docs = state.storage.list(&simple.collection).await.unwrap_or_default();

            // 应用filters
            let filtered_docs: Vec<_> = all_docs.into_iter()
                .filter(|doc| {
                    // Check if document matches all filters
                    simple.filters.iter().all(|filter| {
                        let field_name = filter.get("field").and_then(|f| f.as_str());
                        let operator = filter.get("operator").and_then(|o| o.as_str());
                        let expected_value = filter.get("value");

                        if let (Some(field), Some(op), Some(expected)) = (field_name, operator, expected_value) {
                            // Get the actual field value from document data
                            let actual_value = doc.data.get(field);

                            match op {
                                "Eq" => actual_value == Some(expected),
                                "Ne" => actual_value != Some(expected),
                                "Contains" => {
                                    if let (Some(actual_str), Some(expected_str)) = (actual_value.and_then(|v| v.as_str()), expected.as_str()) {
                                        actual_str.contains(expected_str)
                                    } else {
                                        false
                                    }
                                }
                                _ => true // Unsupported operators pass through
                            }
                        } else {
                            true // Malformed filter passes through
                        }
                    })
                })
                .collect();

            serde_json::to_value(filtered_docs).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        }
        QueryResult::Pipeline(pipeline) => {
            // Pipeline查询保持原有逻辑
            serde_json::to_value(&result).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        }
    };

    Ok(Json(json_result))
}

/// 辅助函数：从HTTP头中提取用户信息
fn extract_user_info_auth(headers: &axum::http::HeaderMap) -> Result<(String, String), StatusCode> {
    use axum::http::header::AUTHORIZATION;

    let auth_header = headers.get(AUTHORIZATION)
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let token = auth_header.to_str()
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    let token = token.strip_prefix("Bearer ")
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let parts: Vec<&str> = token.split(':').collect();
    if parts.len() < 2 {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let user_id = parts[0].to_string();
    let user_role = parts[1].to_string();

    Ok((user_id, user_role))
}

async fn commit_transaction(
    State(state): State<Arc<AppState>>,
    Json(req): Json<TransactionRequest>,
) -> Json<bool> {
    let _ = state.storage.apply_batch(req.operations.clone()).await;
    
    for op in &req.operations {
        match op {
            BatchOperation::Set(doc) => {
                broadcast_op(Arc::clone(&state), doc.collection.clone(), "doc_created", serde_json::to_value(doc).unwrap()).await;
                let _ = state.event_bus.emit(Event {
                    event_type: EventType::DocCreated,
                    payload: serde_json::to_value(doc).unwrap(),
                    timestamp: doc.updated_at,
                });
            }
            BatchOperation::Update { collection, id, .. } => {
                if let Ok(Some(doc)) = state.storage.get(collection, id).await {
                    broadcast_op(Arc::clone(&state), collection.clone(), "doc_updated", serde_json::to_value(&doc).unwrap()).await;
                    let _ = state.event_bus.emit(Event {
                        event_type: EventType::DocUpdated,
                        payload: serde_json::to_value(&doc).unwrap(),
                        timestamp: doc.updated_at,
                    });
                }
            }
            BatchOperation::Delete { collection, id, .. } => {
                let _ = state.io.to(collection.clone()).emit("doc_deleted", id);
                let _ = state.event_bus.emit(Event {
                    event_type: EventType::DocDeleted,
                    payload: serde_json::json!({ "id": id, "collection": collection }),
                    timestamp: chrono::Utc::now().timestamp_millis(),
                });
            }
            _ => {}
        }
    }

    Json(true)
}

async fn call_hook(
    State(state): State<Arc<AppState>>,
    Path(event): Path<String>,
    Json(params): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let io = state.io.clone();
    match state.hook_manager.call_hook(event.clone(), "REST".to_string(), params, |hook_sid, req_data| {
        // Send to the hook socket in /hooks namespace by targeting the global hook room
        tracing::info!("HTTP: Sending hook request to socket {} for event {}", hook_sid, event);
        // Use the global hook room that the hook socket joined
        let _ = io.to(format!("global_hook_{}", hook_sid)).emit("hook_request", &req_data);
    }).await {
        Ok(res) => {
            tracing::info!("HTTP: Hook call successful for event {:?}", res);
            Json(res)
        }
        Err(e) => {
            tracing::error!("HTTP: Hook call failed for event {}: {}", event, e);
            Json(serde_json::json!({ "error": e.to_string() }))
        }
    }
}

async fn broadcast_op(state: Arc<AppState>, collection: String, event: &'static str, data: serde_json::Value) {
    let mut sync_data = data;
    redact_internal_fields(&state, &collection, &mut sync_data).await;

    if collection.starts_with("_session_") {
        let parts: Vec<&str> = collection.split('_').collect();
        if parts.len() >= 3 {
             let sid = parts[2];
             let _ = state.io.to(format!("session:{}", sid)).emit(event, sync_data);
        }
    } else {
        let _ = state.io.to(collection).emit(event, sync_data);
    }
}

async fn redact_internal_fields(state: &Arc<AppState>, collection: &str, data: &mut serde_json::Value) {
    if let Ok(Some(policy_doc)) = state.storage.get("__config__", &format!("sync_policy_{}", collection)).await {
        if let Some(internal_fields) = policy_doc.data.get("internal").and_then(|v| v.as_array()) {
            if let Some(obj) = data.as_object_mut() {
                for field in internal_fields {
                    if let Some(f_str) = field.as_str() {
                        obj.remove(f_str);
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flare_db::Storage;
    use serde_json::json;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_redact_internal_fields() {
        let dir = tempdir().unwrap();
        let storage = Arc::new(flare_db::SledStorage::new(dir.path()).unwrap());

        let mut policy = Document::new("__config__".to_string(), json!({ "internal": ["password", "secret"] }));
        policy.id = "sync_policy_users".to_string();
        storage.insert(policy).await.unwrap();

        let mut data = json!({ "username": "alice", "password": "hashed_password", "secret": "my_secret_token", "age": 30 });

        let (io_layer, io) = SocketIo::builder().build_layer();

        // 为测试创建一个简单的查询执行器
        let test_query_config = r#"{"queries": {}}"#;
        let query_executor = Arc::new(QueryExecutor::from_json(test_query_config).unwrap());

        let state = Arc::new(AppState {
            storage: storage.clone(),
            io,
            cluster: Arc::new(ClusterManager::new()),
            node_id: 1,
            event_bus: Arc::new(EventBus::new().0),
            hook_manager: Arc::new(HookManager::new()),
            query_executor, // 添加查询执行器
        });

        redact_internal_fields(&state, "users", &mut data).await;

        assert_eq!(data["username"], "alice");
        assert_eq!(data["age"], 30);
        assert!(data.get("password").is_none());
        assert!(data.get("secret").is_none());
    }
}
