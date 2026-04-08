use flare_protocol::cluster::cluster_service_server::{ClusterService, ClusterServiceServer};
use flare_protocol::cluster::{HeartbeatRequest, HeartbeatResponse, JoinRequest, JoinResponse, ReplicateRequest, ReplicateResponse};
use std::sync::{Arc, RwLock};
use tonic::{Request as TonicRequest, Response as TonicResponse, Status};

pub struct ClusterManager {
    pub nodes: Arc<RwLock<Vec<NodeInfo>>>,
    pub current_leader: Arc<RwLock<Option<u64>>>,
}

#[derive(Debug, Clone)]
pub struct NodeInfo {
    pub id: u64,
    pub address: String,
    pub last_heartbeat: i64,
}

impl ClusterManager {
    pub fn new() -> Self {
        Self {
            nodes: Arc::new(RwLock::new(Vec::new())),
            current_leader: Arc::new(RwLock::new(None)),
        }
    }
}

#[tonic::async_trait]
impl ClusterService for ClusterManager {
    async fn heartbeat(
        &self,
        request: TonicRequest<HeartbeatRequest>,
    ) -> Result<TonicResponse<HeartbeatResponse>, Status> {
        let req = request.into_inner();
        let mut nodes = self.nodes.write().map_err(|_| Status::internal("Lock error"))?;
        
        if let Some(node) = nodes.iter_mut().find(|n| n.id == req.node_id) {
            node.last_heartbeat = chrono::Utc::now().timestamp_millis();
        } else {
            nodes.push(NodeInfo {
                id: req.node_id,
                address: req.address,
                last_heartbeat: chrono::Utc::now().timestamp_millis(),
            });
        }

        let leader_id = self.current_leader.read().map(|l| l.unwrap_or(0)).unwrap_or(0);
        
        Ok(TonicResponse::new(HeartbeatResponse {
            success: true,
            leader_id,
        }))
    }

    async fn join(
        &self,
        request: TonicRequest<JoinRequest>,
    ) -> Result<TonicResponse<JoinResponse>, Status> {
        let req = request.into_inner();
        let mut nodes = self.nodes.write().map_err(|_| Status::internal("Lock error"))?;
        
        nodes.push(NodeInfo {
            id: req.node_id,
            address: req.address,
            last_heartbeat: chrono::Utc::now().timestamp_millis(),
        });

        Ok(TonicResponse::new(JoinResponse { success: true }))
    }

    async fn replicate(
        &self,
        _request: TonicRequest<ReplicateRequest>,
    ) -> Result<TonicResponse<ReplicateResponse>, Status> {
        // Basic log replication placeholder
        Ok(TonicResponse::new(ReplicateResponse { success: true }))
    }
}
