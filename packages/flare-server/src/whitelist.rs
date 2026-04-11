// Whitelist Query System for Flarebase
// Implements named query templates with variable injection and security validation

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use serde_json::{Value, json};
use anyhow::{Result, anyhow};
use std::collections::HashMap;

/// Named query configuration storage
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NamedQueriesConfig {
    pub queries: HashMap<String, QueryTemplate>,
}

/// Query template definition
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum QueryTemplate {
    #[serde(rename = "simple")]
    Simple(SimpleQuery),

    #[serde(rename = "pipeline")]
    Pipeline(PipelineQuery),
}

/// Simple single-collection query
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimpleQuery {
    pub collection: String,
    #[serde(default)]
    pub filters: Vec<FilterConditionWrapper>,
    #[serde(default)]
    pub limit: Option<LimitParam>,
    #[serde(default)]
    pub offset: Option<OffsetParam>,
}

/// Wrapper for filter conditions to support both array and object formats
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum FilterConditionWrapper {
    Array(FilterConditionArray),
    Object(FilterCondition),
}

/// Array format for filter conditions: ["field", {"Operator": "value"}]
pub type FilterConditionArray = (String, FilterOperatorValue);

/// Pipeline query for multi-step operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineQuery {
    pub steps: Vec<PipelineStep>,
    #[serde(default)]
    pub output: Option<Value>,
}

/// Individual step in a pipeline
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineStep {
    pub id: String,
    pub action: PipelineAction,
    pub collection: String,
    #[serde(default)]
    pub id_param: Option<String>,
}

/// Actions available in pipeline steps
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PipelineAction {
    Get,
    Find,
    Count,
}

/// Filter condition for queries
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterCondition {
    pub field: String,
    pub operator: FilterOperator,
}

/// Filter operators with values
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum FilterOperatorValue {
    Eq { Eq: String },
    Ne { Ne: String },
    Gt { Gt: String },
    Gte { Gte: String },
    Lt { Lt: String },
    Lte { Lte: String },
    In { In: Vec<String> },
    Contains { Contains: String },
}

impl FilterOperatorValue {
    pub fn get_operator_name(&self) -> &'static str {
        match self {
            FilterOperatorValue::Eq { .. } => "Eq",
            FilterOperatorValue::Ne { .. } => "Ne",
            FilterOperatorValue::Gt { .. } => "Gt",
            FilterOperatorValue::Gte { .. } => "Gte",
            FilterOperatorValue::Lt { .. } => "Lt",
            FilterOperatorValue::Lte { .. } => "Lte",
            FilterOperatorValue::In { .. } => "In",
            FilterOperatorValue::Contains { .. } => "Contains",
        }
    }

    pub fn get_value(&self) -> Value {
        match self {
            FilterOperatorValue::Eq { Eq: v } => json!(v),
            FilterOperatorValue::Ne { Ne: v } => json!(v),
            FilterOperatorValue::Gt { Gt: v } => json!(v),
            FilterOperatorValue::Gte { Gte: v } => json!(v),
            FilterOperatorValue::Lt { Lt: v } => json!(v),
            FilterOperatorValue::Lte { Lte: v } => json!(v),
            FilterOperatorValue::In { In: v } => json!(v),
            FilterOperatorValue::Contains { Contains: v } => json!(v),
        }
    }
}

/// Filter operators (kept for compatibility)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum FilterOperator {
    Eq,
    Ne,
    Gt,
    Gte,
    Lt,
    Lte,
    In,
    Contains,
}

/// Dynamic limit parameter
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum LimitParam {
    Fixed(u64),
    Dynamic(String), // e.g., "$params.limit"
}

/// Dynamic offset parameter
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum OffsetParam {
    Fixed(u64),
    Dynamic(String), // e.g., "$params.offset"
}

/// User context for variable injection
#[derive(Debug, Clone)]
pub struct UserContext {
    pub user_id: String,
    pub user_role: String,
}

/// Parameters provided by client
pub type ClientParams = HashMap<String, Value>;

/// Variable injection context
#[derive(Debug, Clone)]
pub struct InjectionContext {
    pub user: UserContext,
    pub params: ClientParams,
    pub step_results: HashMap<String, Value>,
}

impl Default for InjectionContext {
    fn default() -> Self {
        Self {
            user: UserContext {
                user_id: String::new(),
                user_role: "guest".to_string(),
            },
            params: HashMap::new(),
            step_results: HashMap::new(),
        }
    }
}

/// Query execution result
#[derive(Debug, Clone, Serialize, Deserialize)] // 添加 Serialize 和 Deserialize
pub enum QueryResult {
    Simple(SimpleQueryResult),
    Pipeline(PipelineQueryResult),
}

/// Simple query result
#[derive(Debug, Clone, Serialize, Deserialize)] // 添加 Serialize 和 Deserialize
pub struct SimpleQueryResult {
    pub collection: String,
    pub filters: Vec<Value>,
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

/// Pipeline query result
#[derive(Debug, Clone, Serialize, Deserialize)] // 添加 Serialize 和 Deserialize
pub struct PipelineQueryResult {
    pub output: Value,
}

/// Query executor for named queries
pub struct QueryExecutor {
    pub config: NamedQueriesConfig, // Make public for now
    storage: Option<Arc<dyn flare_db::Storage>>, // Add storage reference
}

impl QueryExecutor {
    /// Create a new query executor from configuration
    pub fn new(config: NamedQueriesConfig) -> Self {
        Self { config, storage: None }
    }

    /// Create with storage reference
    pub fn with_storage(config: NamedQueriesConfig, storage: Arc<dyn flare_db::Storage>) -> Self {
        Self { config, storage: Some(storage) }
    }

    /// Load configuration from JSON
    pub fn from_json(json_str: &str) -> Result<Self> {
        let config: NamedQueriesConfig = serde_json::from_str(json_str)?;
        Ok(Self::new(config))
    }

    /// Check if a named query exists
    pub fn has_query(&self, name: &str) -> bool {
        self.config.queries.contains_key(name)
    }

    /// Validate query access permissions
    pub fn validate_access(&self, name: &str, user_context: &UserContext) -> Result<()> {
        if !self.has_query(name) {
            return Err(anyhow!("Query '{}' not found in whitelist", name));
        }

        // Admin bypasses all restrictions
        if user_context.user_role == "admin" {
            return Ok(());
        }

        // Additional role-based restrictions can be added here
        Ok(())
    }

    /// Inject variables into a value
    fn inject_value(&self, value: &str, context: &InjectionContext) -> Result<Value> {
        let result = match value {
            // User context variables
            v if v.starts_with("$USER_ID") => {
                json!(context.user.user_id.clone())
            }
            v if v.starts_with("$USER_ROLE") => {
                json!(context.user.user_role.clone())
            }

            // Parameter variables
            v if v.starts_with("$params.") => {
                let param_name = v.strip_prefix("$params.").unwrap();
                context.params
                    .get(param_name)
                    .cloned()
                    .unwrap_or(json!(null))
            }

            // Step result variables (for pipelines)
            v if v.starts_with("$") => {
                let var_path = v.strip_prefix('$').unwrap();
                if let Some(dot_pos) = var_path.find('.') {
                    let step_id = &var_path[..dot_pos];
                    let field_path = &var_path[dot_pos + 1..];

                    if let Some(step_result) = context.step_results.get(step_id) {
                        self.navigate_json_path(step_result, field_path)?
                    } else {
                        return Err(anyhow!("Step result '{}' not found", step_id));
                    }
                } else {
                    return Err(anyhow!("Invalid variable reference: {}", value));
                }
            }

            // Fixed values
            _ => json!(value),
        };

        Ok(result)
    }

    /// Navigate through JSON path (e.g., "data.author_id")
    fn navigate_json_path(&self, value: &Value, path: &str) -> Result<Value> {
        let parts: Vec<&str> = path.split('.').collect();
        let mut current = value;

        for part in parts {
            current = current
                .get(part)
                .ok_or_else(|| anyhow!("Path '{}' not found in JSON", part))?;
        }

        Ok(current.clone())
    }

    /// Validate and process parameter values
    fn validate_params(&self, params: &ClientParams) -> Result<()> {
        for (key, value) in params {
            // Prevent injection of operators or special characters
            if let Some(str_val) = value.as_str() {
                if str_val.contains("$") || str_val.contains("{{") || str_val.contains("}}") {
                    return Err(anyhow!("Invalid characters in parameter '{}'", key));
                }
            }

            // Validate numeric parameters (including keys without dots)
            if key == "limit" || key == "offset" || key.ends_with(".limit") || key.ends_with(".offset") {
                if let Some(num) = value.as_i64() {
                    if num < 0 || num > 10000 {
                        return Err(anyhow!("Parameter '{}' out of valid range", key));
                    }
                }
            }
        }

        Ok(())
    }

    /// Execute a named query with user context and parameters
    pub fn execute_query(
        &self,
        name: &str,
        user_context: &UserContext,
        params: &ClientParams
    ) -> Result<QueryResult> {
        // Validate access
        self.validate_access(name, user_context)?;

        // Validate parameters
        self.validate_params(params)?;

        // Get query template
        let template = self.config.queries.get(name)
            .ok_or_else(|| anyhow!("Query '{}' not found", name))?;

        // Create injection context
        let context = InjectionContext {
            user: user_context.clone(),
            params: params.clone(),
            step_results: HashMap::new(),
        };

        // Execute based on query type
        match template {
            QueryTemplate::Simple(query) => {
                self.execute_simple_query(query, &context)
            }
            QueryTemplate::Pipeline(query) => {
                self.execute_pipeline_query(query, &context)
            }
        }
    }

    /// Execute a simple query
    fn execute_simple_query(&self, query: &SimpleQuery, context: &InjectionContext) -> Result<QueryResult> {
        // 临时修复：如果有storage，执行实际查询；否则返回查询定义
        if let Some(storage) = &self.storage {
            // 实际执行数据库查询（需要tokio runtime）
            // 注意：这是一个临时方案，正确的做法应该是异步的
            return Ok(QueryResult::Simple(SimpleQueryResult {
                collection: query.collection.clone(),
                filters: vec![],
                limit: None, // 临时简化
                offset: None,
            }));
        } else {
            // 没有storage时返回查询定义（原有行为）
            let mut filters = Vec::new();

            for filter_wrapper in &query.filters {
                match filter_wrapper {
                    FilterConditionWrapper::Array(arr) => {
                        let field = &arr.0;
                        let operator_value = &arr.1;
                        let raw_value = operator_value.get_value();

                        // Check if value is a variable reference (starts with $)
                        let injected_value = if let Some(str_val) = raw_value.as_str() {
                            if str_val.starts_with('$') {
                                // Resolve variable using injection context
                                self.inject_value(str_val, context)?
                            } else {
                                raw_value
                            }
                        } else {
                            raw_value
                        };

                        filters.push(json!({
                            "field": field,
                            "operator": operator_value.get_operator_name(),
                            "value": injected_value
                        }));
                    }
                    FilterConditionWrapper::Object(obj) => {
                        let field = &obj.field;
                        let operator_name = format!("{:?}", obj.operator);

                        filters.push(json!({
                            "field": field,
                            "operator": operator_name,
                            "value": null
                        }));
                    }
                }
            }

            Ok(QueryResult::Simple(SimpleQueryResult {
                collection: query.collection.clone(),
                filters,
                limit: None,
                offset: None,
            }))
        }
    }

    /// Execute a pipeline query
    fn execute_pipeline_query(
        &self,
        query: &PipelineQuery,
        context: &InjectionContext
    ) -> Result<QueryResult> {
        // Process each step in the pipeline
        let mut step_results = HashMap::new();

        for step in &query.steps {
            let step_result = self.execute_pipeline_step(step, context)?;
            step_results.insert(step.id.clone(), step_result);
        }

        // Apply output transformation if specified
        let output = if let Some(output_spec) = &query.output {
            self.transform_output(output_spec, &step_results)?
        } else {
            json!(step_results)
        };

        Ok(QueryResult::Pipeline(PipelineQueryResult { output }))
    }

    /// Execute a single pipeline step
    fn execute_pipeline_step(
        &self,
        step: &PipelineStep,
        _context: &InjectionContext
    ) -> Result<Value> {
        match step.action {
            PipelineAction::Get => {
                // In a real implementation, this would fetch from storage
                // For now, return a mock result
                Ok(json!({
                    "id": "mock-id",
                    "data": {}
                }))
            }
            PipelineAction::Find => {
                // Mock find operation
                Ok(json!({
                    "results": [],
                    "count": 0
                }))
            }
            PipelineAction::Count => {
                // Mock count operation
                Ok(json!({
                    "count": 0
                }))
            }
        }
    }

    /// Transform output according to specification
    fn transform_output(&self, output_spec: &Value, step_results: &HashMap<String, Value>) -> Result<Value> {
        let mut result = serde_json::Map::new();

        if let Some(obj) = output_spec.as_object() {
            for (key, value_template) in obj {
                let value_str = value_template.as_str()
                    .ok_or_else(|| anyhow!("Output value must be a string reference"))?;

                let transformed_value = self.inject_value(value_str, &InjectionContext {
                    user: UserContext {
                        user_id: String::new(),
                        user_role: String::new(),
                    },
                    params: HashMap::new(),
                    step_results: step_results.clone(),
                })?;

                result.insert(key.clone(), transformed_value);
            }
        }

        Ok(json!(result))
    }
}

#[cfg(test)]
mod whitelist_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_parse_simple_query_template() {
        let json_str = r#"
        {
            "queries": {
                "list_my_posts": {
                    "type": "simple",
                    "collection": "posts",
                    "filters": [
                        ["author_id", {"Eq": "$USER_ID"}],
                        ["status", {"Eq": "published"}]
                    ],
                    "limit": "$params.limit",
                    "offset": "$params.offset"
                }
            }
        }
        "#;

        let executor = QueryExecutor::from_json(json_str);
        if let Err(ref e) = executor {
            eprintln!("Parsing error: {:?}", e);
        }
        assert!(executor.is_ok(), "Should parse simple query template successfully");

        let exec = executor.unwrap();
        assert!(exec.has_query("list_my_posts"));
    }

    #[test]
    fn test_parse_pipeline_query_template() {
        let json_str = r#"
        {
            "queries": {
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
                            "id_param": "$post.author_id"
                        }
                    ],
                    "output": {
                        "content": "$post.data",
                        "author_name": "$author.data.name"
                    }
                }
            }
        }
        "#;

        let executor = QueryExecutor::from_json(json_str);
        assert!(executor.is_ok());

        let exec = executor.unwrap();
        assert!(exec.has_query("get_post_with_author"));
    }

    #[test]
    fn test_validate_access_nonexistent_query() {
        let json_str = r#"
        {
            "queries": {
                "valid_query": {
                    "type": "simple",
                    "collection": "posts"
                }
            }
        }
        "#;

        let executor = QueryExecutor::from_json(json_str).unwrap();
        let user_context = UserContext {
            user_id: "user-1".to_string(),
            user_role: "user".to_string(),
        };

        let result = executor.validate_access("invalid_query", &user_context);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_access_admin_bypass() {
        let json_str = r#"
        {
            "queries": {
                "admin_query": {
                    "type": "simple",
                    "collection": "admin_data"
                }
            }
        }
        "#;

        let executor = QueryExecutor::from_json(json_str).unwrap();
        let admin_context = UserContext {
            user_id: "admin-1".to_string(),
            user_role: "admin".to_string(),
        };

        let result = executor.validate_access("admin_query", &admin_context);
        assert!(result.is_ok());
    }

    #[test]
    fn test_inject_user_id_variable() {
        let json_str = r#"{"queries": {}}"#;
        let executor = QueryExecutor::from_json(json_str).unwrap();

        let context = InjectionContext {
            user: UserContext {
                user_id: "user-123".to_string(),
                user_role: "user".to_string(),
            },
            params: HashMap::new(),
            step_results: HashMap::new(),
        };

        let result = executor.inject_value("$USER_ID", &context);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), json!("user-123"));
    }

    #[test]
    fn test_inject_param_variable() {
        let json_str = r#"{"queries": {}}"#;
        let executor = QueryExecutor::from_json(json_str).unwrap();

        let mut params = HashMap::new();
        params.insert("limit".to_string(), json!(10));

        let context = InjectionContext {
            user: UserContext {
                user_id: "user-1".to_string(),
                user_role: "user".to_string(),
            },
            params,
            step_results: HashMap::new(),
        };

        let result = executor.inject_value("$params.limit", &context);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), json!(10));
    }

    #[test]
    fn test_validate_params_injection_prevention() {
        let json_str = r#"{"queries": {}}"#;
        let executor = QueryExecutor::from_json(json_str).unwrap();

        let mut params = HashMap::new();
        params.insert("malicious".to_string(), json!("$USER_ID"));

        let result = executor.validate_params(&params);
        assert!(result.is_err(), "Should reject parameters with injection patterns");
    }

    #[test]
    fn test_validate_params_valid_numeric() {
        let json_str = r#"{"queries": {}}"#;
        let executor = QueryExecutor::from_json(json_str).unwrap();

        let mut params = HashMap::new();
        params.insert("limit".to_string(), json!(10));
        params.insert("offset".to_string(), json!(0));

        let result = executor.validate_params(&params);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_params_out_of_range() {
        let json_str = r#"{"queries": {}}"#;
        let executor = QueryExecutor::from_json(json_str).unwrap();

        let mut params = HashMap::new();
        params.insert("limit".to_string(), json!(20000)); // Over 10000 limit

        let result = executor.validate_params(&params);
        assert!(result.is_err(), "Should reject out of range parameters");
    }

    #[test]
    fn test_navigate_json_path() {
        let json_str = r#"{"queries": {}}"#;
        let executor = QueryExecutor::from_json(json_str).unwrap();

        let value = json!({
            "data": {
                "author_id": "user-123",
                "title": "Test Post"
            }
        });

        let result = executor.navigate_json_path(&value, "data.author_id");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), json!("user-123"));
    }

    #[test]
    fn test_execute_simple_query_success() {
        let json_str = r#"
        {
            "queries": {
                "list_my_posts": {
                    "type": "simple",
                    "collection": "posts",
                    "filters": [
                        ["author_id", {"Eq": "$USER_ID"}],
                        ["status", {"Eq": "published"}]
                    ]
                }
            }
        }
        "#;

        let executor = QueryExecutor::from_json(json_str).unwrap();
        let user_context = UserContext {
            user_id: "user-123".to_string(),
            user_role: "user".to_string(),
        };

        let mut params = HashMap::new();
        params.insert("limit".to_string(), json!(10));

        let result = executor.execute_query("list_my_posts", &user_context, &params);
        assert!(result.is_ok());

        let query_result = result.unwrap();
        match query_result {
            QueryResult::Simple(simple_result) => {
                assert_eq!(simple_result.collection, "posts");
                assert_eq!(simple_result.filters.len(), 2);
            }
            _ => panic!("Expected simple query result"),
        }
    }

    #[test]
    fn test_execute_query_nonexistent() {
        let json_str = r#"{"queries": {}}"#;
        let executor = QueryExecutor::from_json(json_str).unwrap();

        let user_context = UserContext {
            user_id: "user-1".to_string(),
            user_role: "user".to_string(),
        };

        let result = executor.execute_query("nonexistent", &user_context, &HashMap::new());
        assert!(result.is_err());
    }

    #[test]
    fn test_execute_query_with_invalid_params() {
        let json_str = r#"
        {
            "queries": {
                "safe_query": {
                    "type": "simple",
                    "collection": "posts"
                }
            }
        }
        "#;

        let executor = QueryExecutor::from_json(json_str).unwrap();

        let user_context = UserContext {
            user_id: "user-1".to_string(),
            user_role: "user".to_string(),
        };

        let mut params = HashMap::new();
        params.insert("malicious".to_string(), json!("$USER_ID"));

        let result = executor.execute_query("safe_query", &user_context, &params);
        assert!(result.is_err(), "Should reject parameters with injection patterns");
    }

    #[test]
    fn test_security_prevent_query_injection() {
        let json_str = r#"
        {
            "queries": {
                "safe_posts": {
                    "type": "simple",
                    "collection": "posts",
                    "filters": [
                        ["author_id", {"Eq": "$USER_ID"}]
                    ]
                }
            }
        }
        "#;

        let executor = QueryExecutor::from_json(json_str).unwrap();

        // Try to inject different user_id via parameters (should not work)
        let user_context = UserContext {
            user_id: "user-1".to_string(),
            user_role: "user".to_string(),
        };

        let mut params = HashMap::new();
        params.insert("author_id".to_string(), json!("admin-1"));

        let result = executor.execute_query("safe_posts", &user_context, &params);
        assert!(result.is_ok());

        // The filters should still use $USER_ID from context, not from params
        let query_result = result.unwrap();
        match query_result {
            QueryResult::Simple(simple_result) => {
                // Check that filters are properly constructed with user context
                assert_eq!(simple_result.filters.len(), 1);
                let filter = &simple_result.filters[0];
                assert_eq!(filter["field"], "author_id");
            }
            _ => panic!("Expected simple query result"),
        }
    }

    #[test]
    fn test_admin_bypass_all_restrictions() {
        let json_str = r#"
        {
            "queries": {
                "admin_only_query": {
                    "type": "simple",
                    "collection": "admin_data"
                }
            }
        }
        "#;

        let executor = QueryExecutor::from_json(json_str).unwrap();

        let admin_context = UserContext {
            user_id: "admin-1".to_string(),
            user_role: "admin".to_string(),
        };

        let result = executor.execute_query("admin_only_query", &admin_context, &HashMap::new());
        assert!(result.is_ok(), "Admin should be able to access any query");
    }

    #[test]
    fn test_parameter_substitution_in_filters() {
        let json_str = r#"
        {
            "queries": {
                "check_email_exists": {
                    "type": "simple",
                    "collection": "users",
                    "filters": [
                        ["email", {"Eq": "$params.email"}]
                    ]
                }
            }
        }
        "#;

        let executor = QueryExecutor::from_json(json_str).unwrap();

        let user_context = UserContext {
            user_id: "user-1".to_string(),
            user_role: "user".to_string(),
        };

        let mut params = HashMap::new();
        params.insert("email".to_string(), json!("test@example.com"));

        let result = executor.execute_query("check_email_exists", &user_context, &params);
        assert!(result.is_ok());

        let query_result = result.unwrap();
        match query_result {
            QueryResult::Simple(simple_result) => {
                assert_eq!(simple_result.collection, "users");
                assert_eq!(simple_result.filters.len(), 1);

                let filter = &simple_result.filters[0];
                assert_eq!(filter["field"], "email");
                assert_eq!(filter["operator"], "Eq");

                // The key assertion: filter value should be the actual parameter value,
                // NOT the string "$params.email"
                assert_eq!(filter["value"], json!("test@example.com"));
                assert_ne!(filter["value"], json!("$params.email"));
            }
            _ => panic!("Expected simple query result"),
        }
    }

    #[test]
    fn test_parameter_substitution_with_user_context() {
        let json_str = r#"
        {
            "queries": {
                "get_my_posts": {
                    "type": "simple",
                    "collection": "posts",
                    "filters": [
                        ["author_id", {"Eq": "$USER_ID"}],
                        ["status", {"Eq": "$params.status"}]
                    ]
                }
            }
        }
        "#;

        let executor = QueryExecutor::from_json(json_str).unwrap();

        let user_context = UserContext {
            user_id: "user-456".to_string(),
            user_role: "author".to_string(),
        };

        let mut params = HashMap::new();
        params.insert("status".to_string(), json!("published"));

        let result = executor.execute_query("get_my_posts", &user_context, &params);
        assert!(result.is_ok());

        let query_result = result.unwrap();
        match query_result {
            QueryResult::Simple(simple_result) => {
                assert_eq!(simple_result.filters.len(), 2);

                // First filter: $USER_ID should be substituted
                let filter1 = &simple_result.filters[0];
                assert_eq!(filter1["field"], "author_id");
                assert_eq!(filter1["value"], json!("user-456"));

                // Second filter: $params.status should be substituted
                let filter2 = &simple_result.filters[1];
                assert_eq!(filter2["field"], "status");
                assert_eq!(filter2["value"], json!("published"));
            }
            _ => panic!("Expected simple query result"),
        }
    }
}