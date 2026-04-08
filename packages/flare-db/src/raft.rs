use openraft::Config;
use openraft::Raft;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::Storage;

pub type NodeId = u64;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum Request {
    Write(flare_protocol::Document),
    Delete { collection: String, id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum Response {
    Ok,
    Error(String),
}

openraft::declare_raft_types!(
    pub TypeConfig:
        D = Request,
        R = Response,
        NodeId = NodeId,
        Node = openraft::BasicNode,
        Entry = openraft::Entry<TypeConfig>,
        SnapshotData = Vec<u8>
);

pub type FlareRaft = Raft<TypeConfig>;

pub struct RaftStore {
    storage: Arc<dyn Storage>,
    // In a real implementation, we'd also store the Raft log and meta in Sled.
    // For this prototype, we'll keep it simple.
}

// ... Implementation of RaftLogStorage and RaftStateMachine for RaftStore ...
// This requires a lot of boilerplate for OpenRaft.
