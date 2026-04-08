use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct Document {
    pub id: String,
    pub collection: String,
    pub data: Value,
    pub version: u64,
    pub updated_at: i64,
}

impl Document {
    pub fn new(collection: String, data: Value) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            collection,
            data,
            version: 1,
            updated_at: chrono::Utc::now().timestamp_millis(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum QueryOp {
    Eq(Value),
    Gt(Value),
    Lt(Value),
    Gte(Value),
    Lte(Value),
    In(Vec<Value>),
    And(Vec<QueryOp>),
    Or(Vec<QueryOp>),
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct Query {
    pub collection: String,
    pub filters: Vec<(String, QueryOp)>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub enum Precondition {
    Exists(bool),
    Version(u64),
    LastUpdate(i64),
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum BatchOperation {
    Set(Document),
    Update {
        collection: String,
        id: String,
        data: Value,
        precondition: Option<Precondition>,
    },
    Delete {
        collection: String,
        id: String,
        precondition: Option<Precondition>,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct TransactionRequest {
    pub operations: Vec<BatchOperation>,
}

pub mod cluster {
    tonic::include_proto!("flare.cluster");
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub enum EventType {
    UserCreated,
    UserUpdated,
    UserDeleted,
    DocCreated,
    DocUpdated,
    DocDeleted,
    ConfigUpdated,
    VerificationCodeRequested,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct Event {
    pub event_type: EventType,
    pub payload: Value,
    pub timestamp: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct Webhook {
    pub id: String,
    pub url: String,
    pub events: Vec<EventType>,
    pub secret: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct HookCapabilities {
    pub events: Vec<String>,
    pub user_context: Value,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct HookRegister {
    pub token: String,
    pub capabilities: HookCapabilities,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct HookRequest {
    pub request_id: String,
    pub event_name: String,
    pub session_id: String,
    pub params: Value,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct HookResponse {
    pub request_id: String,
    pub status: String,
    pub data: Option<Value>,
    pub error: Option<Value>,
}
