use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use flare_db::{SledStorage, Storage};
use flare_protocol::{Document, Event, EventType, Webhook, Query, TransactionRequest, BatchOperation};
use flare_protocol::cluster::cluster_service_server::ClusterServiceServer;
use socketioxide::{
    extract::{Data, SocketRef},
    SocketIo,
};
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tonic::transport::Server;
use tokio::time::Duration;
use async_trait::async_trait;

mod cluster;
mod hooks;
mod hook_manager;
mod permissions;

use cluster::ClusterManager;
use hooks::{EventBus, WebhookDispatcher, WebhooksProvider};
use hook_manager::HookManager;
use permissions::{Authorizer, PermissionContext, ResourceType};
use flare_protocol::{HookRegister, HookResponse};

#[async_trait]
impl WebhooksProvider for SledStorage {
    async fn get_webhooks_for_event(&self, event_type: &EventType) -> anyhow::Result<Vec<Webhook>> {
        let docs = self.list("__webhooks__").await?;
        let mut result = Vec::new();
        for doc in docs {
            let webhook: Webhook = serde_json::from_value(doc.data)?;
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
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let node_id: u64 = std::env::var("NODE_ID").unwrap_or("1".to_string()).parse()?;
    let grpc_addr = std::env::var("GRPC_ADDR").unwrap_or("0.0.0.0:50051".to_string());
    let http_addr = std::env::var("HTTP_ADDR").unwrap_or("0.0.0.0:3000".to_string());

    let (io_layer, io) = SocketIo::builder().build_layer();

    let db_path = std::env::var("FLARE_DB_PATH").unwrap_or(format!("./flare_{}.db", node_id));
    let storage = Arc::new(SledStorage::new(db_path)?);
    let cluster = Arc::new(ClusterManager::new());
    let (event_bus, event_rx) = EventBus::new();
    let event_bus = Arc::new(event_bus);
    let hook_manager = Arc::new(HookManager::new());

    // --- Start webhook dispatcher before creating state ---
    let webhooks_provider = storage.clone() as Arc<dyn WebhooksProvider>;
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

        socket.on("call_hook", move |socket: SocketRef, Data((event, params)): Data<(String, serde_json::Value)>| {
            let stc = Arc::clone(&st);
            let session_id = socket.id.to_string();
            tokio::spawn(async move {
                match stc.hook_manager.call_hook(event, session_id, params, |hook_sid, req_data| {
                    // Send to the hook socket in /hooks namespace
                    let _ = stc.io.to(hook_sid).emit("hook_request", &req_data);
                }).await {
                    Ok(res) => { let _ = socket.emit("hook_success", &res); }
                    Err(e) => { let _ = socket.emit("hook_error", &e.to_string()); }
                }
            });
        });
    });

    let hook_manager_ns = Arc::clone(&state.hook_manager);
    io.ns("/hooks", move |socket: SocketRef| {
        let hm = Arc::clone(&hook_manager_ns);
        let sid = socket.id.to_string();
        
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

    let app = Router::new()
        .route("/collections/:collection", post(create_doc).get(list_docs))
        .route("/collections/:collection/:id", get(get_doc).put(update_doc).delete(delete_doc))
        .route("/query", post(run_query))
        .route("/transaction", post(commit_transaction))
        .route("/call_hook/:event", post(call_hook))
        .layer(CorsLayer::permissive())
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
    let mut doc = state.storage.get(&collection, &id).await.unwrap().expect("Document not found");
    doc.data = data;
    doc.version += 1;
    doc.updated_at = chrono::Utc::now().timestamp_millis();

    let _ = state.storage.insert(doc.clone()).await;

    broadcast_op(Arc::clone(&state), collection, "doc_updated", serde_json::to_value(&doc).unwrap()).await;

    let _ = state.event_bus.emit(Event {
        event_type: EventType::DocUpdated,
        payload: serde_json::to_value(&doc).unwrap(),
        timestamp: doc.updated_at,
    });

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
    match state.hook_manager.call_hook(event, "REST".to_string(), params, |hook_sid, req_data| {
        // Send to the hook socket in /hooks namespace
        let _ = io.to(hook_sid).emit("hook_request", &req_data);
    }).await {
        Ok(res) => Json(res),
        Err(e) => Json(serde_json::json!({ "error": e.to_string() })),
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
        let state = Arc::new(AppState {
            storage: storage.clone(),
            io,
            cluster: Arc::new(ClusterManager::new()),
            node_id: 1,
            event_bus: Arc::new(EventBus::new().0),
            hook_manager: Arc::new(HookManager::new()),
        });

        redact_internal_fields(&state, "users", &mut data).await;

        assert_eq!(data["username"], "alice");
        assert_eq!(data["age"], 30);
        assert!(data.get("password").is_none());
        assert!(data.get("secret").is_none());
    }
}
