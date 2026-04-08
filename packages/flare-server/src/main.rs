use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use flare_db::{SledStorage, Storage};
use flare_protocol::{Document, Event, EventType, Webhook, Query, QueryOp, TransactionRequest, BatchOperation};
use flare_protocol::cluster::cluster_service_server::ClusterServiceServer;
use socketioxide::{
    extract::{Data, SocketRef},
    SocketIo,
};
use serde_json::json;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tonic::transport::Server;
use tokio::time::{self, Duration};
use async_trait::async_trait;

mod cluster;
mod hooks;

use cluster::ClusterManager;
use hooks::{EventBus, WebhookDispatcher, WebhooksProvider};

#[async_trait]
impl WebhooksProvider for SledStorage {
    async fn get_webhooks_for_event(&self, event_type: &EventType) -> anyhow::Result<Vec<Webhook>> {
        // Fetch all webhooks from the special __webhooks__ collection
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

struct AppState {
    storage: Arc<dyn Storage>,
    io: SocketIo,
    cluster: Arc<ClusterManager>,
    node_id: u64,
    event_bus: Arc<EventBus>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let node_id: u64 = std::env::var("NODE_ID").unwrap_or("1".to_string()).parse()?;
    let grpc_addr = std::env::var("GRPC_ADDR").unwrap_or("0.0.0.0:50051".to_string());
    let http_addr = std::env::var("HTTP_ADDR").unwrap_or("0.0.0.0:3000".to_string());

    let (io_layer, io) = SocketIo::builder().build_layer();
    io.ns("/", on_connect);

    let storage = Arc::new(SledStorage::new(format!("./flare_{}.db", node_id))?);
    let cluster = Arc::new(ClusterManager::new());
    let (event_bus, event_rx) = EventBus::new();
    let event_bus = Arc::new(event_bus);
    
    let state = Arc::new(AppState {
        storage: storage.clone(),
        io: io.clone(),
        cluster: cluster.clone(),
        node_id,
        event_bus: event_bus.clone(),
    });

    // Start Webhook Dispatcher
    let dispatcher = WebhookDispatcher::new();
    let webhooks_provider = storage.clone();
    tokio::spawn(async move {
        dispatcher.run(event_rx, webhooks_provider).await;
    });

    // Mock Verification Hook (Infrastructure side-car)
    // Listens for generic 'verification_requests' and generates an OTP
    let mock_bus = event_bus.clone();
    let mock_storage = storage.clone();
    tokio::spawn(async move {
        let mut rx = mock_bus.sender.subscribe();
        while let Ok(event) = rx.recv().await {
            if event.event_type == EventType::DocCreated {
                if let Some(collection) = event.payload.get("collection").and_then(|v| v.as_str()) {
                    if collection == "verification_requests" {
                        if let Some(target) = event.payload.get("data").and_then(|v| v.get("target")).and_then(|v| v.as_str()) {
                            use rand::Rng;
                            let code = rand::rng().random_range(100000..999999).to_string();
                            tracing::info!("MOCK HOOK: Generating code {} for {}", code, target);
                            
                            let mut doc = Document::new("__internal_verification__".to_string(), json!({
                                "target": target,
                                "code": code,
                                "expires_at": chrono::Utc::now().timestamp_millis() + 300000
                            }));
                            doc.id = target.to_string();
                            let _ = mock_storage.insert(doc).await;
                        }
                    }
                }
            }
        }
    });

    // Background task for node health monitoring & re-balancing
    let monitor_state = state.clone();
    tokio::spawn(async move {
        let mut interval = time::interval(Duration::from_secs(5));
        loop {
            interval.tick().await;
            monitor_nodes(&monitor_state).await;
        }
    });

    // Start gRPC Server
    let grpc_cluster = cluster.clone();
    let grpc_addr_parsed = grpc_addr.parse()?;
    tokio::spawn(async move {
        Server::builder()
            .add_service(ClusterServiceServer::from_arc(grpc_cluster))
            .serve(grpc_addr_parsed)
            .await
            .expect("gRPC server failed");
    });

    let app = Router::new()
        .route("/collections/:collection", post(create_doc).get(list_docs))
        .route("/collections/:collection/:id", get(get_doc).put(update_doc).delete(delete_doc))
        .route("/query", post(run_query))
        .route("/transaction", post(commit_transaction))
        .layer(CorsLayer::permissive())
        .layer(io_layer)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(http_addr).await?;
    tracing::info!("Flarebase Node {} listening on HTTP {}", node_id, listener.local_addr()?);
    axum::serve(listener, app).await?;

    Ok(())
}

async fn monitor_nodes(state: &AppState) {
    let now = chrono::Utc::now().timestamp_millis();
    let mut nodes = state.cluster.nodes.write().unwrap();
    let dead_nodes: Vec<u64> = nodes.iter()
        .filter(|n| now - n.last_heartbeat > 15000) // 15 seconds threshold
        .map(|n| n.id)
        .collect();

    for id in dead_nodes {
        tracing::warn!("Node {} is dead, triggered re-balancing...", id);
        nodes.retain(|n| n.id != id);
        // Implement re-balancing logic here:
        // 1. If this node is the leader, trigger new election
        // 2. Re-distribute data if necessary
    }
}

fn on_connect(socket: SocketRef) {
    tracing::info!("socket connected: {}", socket.id);
    socket.on("subscribe", |socket: SocketRef, Data(collection): Data<String>| {
        let _ = socket.join(collection);
    });
}

// HTTP Handlers...
async fn create_doc(
    State(state): State<Arc<AppState>>,
    Path(collection): Path<String>,
    Json(data): Json<serde_json::Value>,
) -> Json<Document> {
    let doc = Document::new(collection.clone(), data);
    state.storage.insert(doc.clone()).await.unwrap();
    state.io.to(collection.clone()).emit("doc_created", &doc).ok();

    state.event_bus.emit(Event {
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
    
    state.storage.insert(doc.clone()).await.unwrap();
    state.io.to(collection.clone()).emit("doc_updated", &doc).ok();

    state.event_bus.emit(Event {
        event_type: EventType::DocUpdated,
        payload: serde_json::to_value(&doc).unwrap(),
        timestamp: doc.updated_at,
    });

    Json(doc)
}

async fn list_docs(
    State(state): State<Arc<AppState>>,
    Path(collection): Path<String>,
) -> Json<Vec<Document>> {
    let docs = state.storage.list(&collection).await.unwrap();
    Json(docs)
}

async fn get_doc(
    State(state): State<Arc<AppState>>,
    Path((collection, id)): Path<(String, String)>,
) -> Json<Option<Document>> {
    let doc = state.storage.get(&collection, &id).await.unwrap();
    Json(doc)
}

async fn delete_doc(
    State(state): State<Arc<AppState>>,
    Path((collection, id)): Path<(String, String)>,
) -> Json<bool> {
    state.storage.delete(&collection, &id).await.unwrap();
    state.io.to(collection).emit("doc_deleted", &id).ok();

    // Emit internal event for webhooks
    state.event_bus.emit(Event {
        event_type: EventType::DocDeleted,
        payload: serde_json::json!({ "id": id, "collection": collection }),
        timestamp: chrono::Utc::now().timestamp_millis(),
    });

    Json(true)
}

async fn run_query(
    State(state): State<Arc<AppState>>,
    Json(query): Json<Query>,
) -> Json<Vec<Document>> {
    let docs = state.storage.query(query).await.unwrap();
    Json(docs)
}

async fn commit_transaction(
    State(state): State<Arc<AppState>>,
    Json(req): Json<TransactionRequest>,
) -> Json<bool> {
    // Replicate via Raft if this were a full implementation
    // For now, apply directly to storage
    state.storage.apply_batch(req.operations.clone()).await.unwrap();

    // Emit events for each operation
    for op in req.operations {
        match op {
            BatchOperation::Set(doc) => {
                state.io.to(doc.collection.clone()).emit("doc_created", &doc).ok();
                state.event_bus.emit(Event {
                    event_type: EventType::DocCreated,
                    payload: serde_json::to_value(&doc).unwrap(),
                    timestamp: doc.updated_at,
                });
            }
            BatchOperation::Update { collection, id, .. } => {
                // Fetch the updated doc to emit it
                if let Ok(Some(doc)) = state.storage.get(&collection, &id).await {
                    state.io.to(collection).emit("doc_updated", &doc).ok();
                    state.event_bus.emit(Event {
                        event_type: EventType::DocUpdated,
                        payload: serde_json::to_value(&doc).unwrap(),
                        timestamp: doc.updated_at,
                    });
                }
            }
            BatchOperation::Delete { collection, id, .. } => {
                state.io.to(collection.clone()).emit("doc_deleted", &id).ok();
                state.event_bus.emit(Event {
                    event_type: EventType::DocDeleted,
                    payload: serde_json::json!({ "id": id, "collection": collection }),
                    timestamp: chrono::Utc::now().timestamp_millis(),
                });
            }
        }
    }

    Json(true)
}
