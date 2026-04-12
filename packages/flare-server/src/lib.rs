// Flare Server Library
//
// 这个库导出了 flare-server 的核心组件，用于集成测试

pub mod cluster;
pub mod hooks;
pub mod plugin_manager;
pub mod permissions;
pub mod whitelist;
pub mod jwt_middleware;
pub mod cors_config;

// Re-export for integration tests
pub use cluster::ClusterManager;
pub use hooks::{EventBus, WebhookDispatcher, WebhooksProvider};
pub use plugin_manager::PluginManager;
pub use permissions::{Authorizer, PermissionContext, ResourceType};
pub use whitelist::{QueryExecutor, NamedQueriesConfig, UserContext, InjectionContext, QueryResult};
pub use cors_config::{CorsConfig, load_cors_config, load_cors_config_from_env};

// AppState for testing and integration
use std::sync::Arc;
use flare_db::Storage;
use socketioxide::SocketIo;

pub struct AppState {
    pub storage: Arc<dyn Storage>,
    pub io: SocketIo,
    pub cluster: Arc<ClusterManager>,
    pub node_id: u64,
    pub event_bus: Arc<EventBus>,
    pub plugin_manager: Arc<PluginManager>,
    pub query_executor: Arc<QueryExecutor>, // 白名单查询执行器
}
