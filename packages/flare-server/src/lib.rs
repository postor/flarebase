// Flare Server Library
//
// 这个库导出了 flare-server 的核心组件，用于集成测试

pub mod cluster;
pub mod hooks;
pub mod hook_manager;
pub mod permissions;

// Re-export for integration tests
pub use cluster::ClusterManager;
pub use hooks::{EventBus, WebhookDispatcher, WebhooksProvider};
pub use hook_manager::HookManager;
pub use permissions::{Authorizer, PermissionContext, ResourceType};

// Re-export types for testing
pub use axum::{extract::{Path, State}, Json};
pub use socketioxide::extract::Data;

// AppState for testing
use std::sync::Arc;
use flare_db::Storage;
use socketioxide::SocketIo;

pub struct AppState {
    pub storage: Arc<dyn Storage>,
    pub io: SocketIo,
    pub cluster: Arc<ClusterManager>,
    pub node_id: u64,
    pub event_bus: Arc<EventBus>,
    pub hook_manager: Arc<HookManager>,
}
