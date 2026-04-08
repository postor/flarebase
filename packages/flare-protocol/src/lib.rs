use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
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

#[derive(Debug, Serialize, Deserialize, Clone)]
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Query {
    pub collection: String,
    pub filters: Vec<(String, QueryOp)>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

pub mod cluster {
    tonic::include_proto!("flare.cluster");
}
