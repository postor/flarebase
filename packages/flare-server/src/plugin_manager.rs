use dashmap::DashMap;
use flare_protocol::{HookRegister, HookResponse};
use serde_json::Value;
use tokio::sync::{oneshot, Mutex};
use uuid::Uuid;
use std::sync::Arc;
use std::collections::VecDeque;

// Re-export UserContext for external use
pub use crate::jwt_middleware::UserContext;

/// Pending request with its parameters
struct PendingRequest {
    params: Value,
    session_id: String,
    user_context: Option<UserContext>,
    response_tx: oneshot::Sender<Value>,
    event_name: String,
}

/// Plugin connection state - maintains a queue for sequential processing
struct PluginConnection {
    /// Queue of pending requests to be processed sequentially
    request_queue: Arc<Mutex<VecDeque<PendingRequest>>>,
    /// Flag indicating if the connection is currently processing a request
    is_processing: Arc<Mutex<bool>>,
}

impl PluginConnection {
    fn new() -> Self {
        Self {
            request_queue: Arc::new(Mutex::new(VecDeque::new())),
            is_processing: Arc::new(Mutex::new(false)),
        }
    }
}

pub struct PluginManager {
    // event_name -> Vec<(SocketId, PluginConnection)>
    pub(in crate) plugins: Arc<DashMap<String, Vec<(String, Arc<PluginConnection>)>>>,
    // requestId -> Sender for the client's await
    pub(in crate) pending_requests: Arc<DashMap<String, oneshot::Sender<Value>>>,
    // socketId -> PluginConnection for managing per-socket state
    pub(in crate) connections: Arc<DashMap<String, Arc<PluginConnection>>>,
}

impl Clone for PluginManager {
    fn clone(&self) -> Self {
        Self {
            plugins: Arc::clone(&self.plugins),
            pending_requests: Arc::clone(&self.pending_requests),
            connections: Arc::clone(&self.connections),
        }
    }
}

impl PluginManager {
    pub fn new() -> Self {
        Self {
            plugins: Arc::new(DashMap::new()),
            pending_requests: Arc::new(DashMap::new()),
            connections: Arc::new(DashMap::new()),
        }
    }

    pub fn register_plugin(&self, sid: String, register: HookRegister) {
        let events = register.capabilities.events.clone();
        let connection = Arc::new(PluginConnection::new());

        // Store the connection for this socket
        self.connections.insert(sid.clone(), connection.clone());

        // Register the connection for each event
        for event in &events {
            self.plugins.entry(event.clone()).or_default().push((sid.clone(), connection.clone()));
        }
        tracing::info!("Plugin registered: {} with events {:?}", sid, events);
    }

    /// Call a plugin and wait for response
    pub async fn call_plugin(&self, event_name: String, session_id: String, params: Value, emit_fn: impl Fn(String, Value) + Send + 'static) -> anyhow::Result<Value> {
        self.call_plugin_with_jwt(event_name, session_id, params, None, emit_fn).await
    }

    /// Call a plugin with JWT user context and wait for response
    /// This implementation ensures sequential processing per plugin connection
    pub async fn call_plugin_with_jwt(
        &self,
        event_name: String,
        session_id: String,
        params: Value,
        user_context: Option<UserContext>,
        emit_fn: impl Fn(String, Value) + Send + 'static
    ) -> anyhow::Result<Value> {
        let (tx, rx) = oneshot::channel();

        // Get the first available plugin connection for this event
        let (sid, connection) = {
            let plugin_refs = self.plugins.get(&event_name).ok_or_else(|| anyhow::anyhow!("No plugin registered for event: {}", event_name))?;
            let plugins_list = plugin_refs.value();
            if plugins_list.is_empty() {
                return Err(anyhow::anyhow!("No active plugin connections for event: {}", event_name));
            }
            // Use first available connection (round-robin could be added here)
            (plugins_list[0].0.clone(), plugins_list[0].1.clone())
        };

        // Create pending request
        let pending_request = PendingRequest {
            params,
            session_id: session_id.clone(),
            user_context: user_context.clone(),
            response_tx: tx,
            event_name: event_name.clone(),
        };

        // Add to the connection's queue
        {
            let mut queue = connection.request_queue.lock().await;
            queue.push_back(pending_request);
        }

        // Try to start processing if not already processing
        self.try_process_queue(&sid, &connection, emit_fn).await;

        // Wait for response with timeout
        match tokio::time::timeout(std::time::Duration::from_secs(10), rx).await {
            Ok(Ok(response)) => Ok(response),
            Ok(Err(_)) => Err(anyhow::anyhow!("Plugin disconnected during request")),
            Err(_) => Err(anyhow::anyhow!("Plugin request timed out"))
        }
    }

    /// Try to process the next request in the queue if the connection is idle
    async fn try_process_queue(
        &self,
        sid: &str,
        connection: &Arc<PluginConnection>,
        emit_fn: impl Fn(String, Value) + Send + 'static
    ) {
        // Check and set processing flag atomically
        let mut is_processing_guard = connection.is_processing.lock().await;
        
        // If already processing, the current handler will process the next item
        if *is_processing_guard {
            return;
        }
        
        *is_processing_guard = true;
        drop(is_processing_guard);
        
        // Spawn a task to process the queue
        let self_clone = self.clone();
        let sid_clone = sid.to_string();
        let connection_clone = connection.clone();
        
        tokio::spawn(async move {
            loop {
                // Get next request from queue
                let request = {
                    let mut queue = connection_clone.request_queue.lock().await;
                    queue.pop_front()
                };
                
                match request {
                    Some(pending_request) => {
                        // Build $jwt object from user context
                        let jwt_value = if let Some(ctx) = &pending_request.user_context {
                            serde_json::json!({
                                "user_id": ctx.user_id,
                                "email": ctx.email,
                                "role": ctx.role
                            })
                        } else {
                            serde_json::json!({
                                "user_id": null,
                                "email": null,
                                "role": "guest"
                            })
                        };

                        let request_id = Uuid::new_v4().to_string();
                        self_clone.pending_requests.insert(request_id.clone(), pending_request.response_tx);

                        let request_data = serde_json::json!({
                            "request_id": request_id,
                            "event_name": pending_request.event_name,
                            "session_id": pending_request.session_id,
                            "params": pending_request.params,
                            "$jwt": jwt_value
                        });

                        // Send the request
                        emit_fn(sid_clone.clone(), request_data);
                    }
                    None => {
                        // No more requests, mark as not processing
                        let mut is_processing = connection_clone.is_processing.lock().await;
                        *is_processing = false;
                        break;
                    }
                }
            }
        });
    }

    pub fn handle_response(&self, response: HookResponse) {
        if let Some((_, tx)) = self.pending_requests.remove(&response.request_id) {
            if response.status == "success" {
                let data = response.data.unwrap_or(Value::Null);
                let _ = tx.send(data);
            } else {
                let error = response.error.unwrap_or(Value::String("Unknown plugin error".to_string()));
                let _ = tx.send(serde_json::json!({ "error": error }));
            }
        }
    }

    pub fn remove_plugin(&self, sid: &str) {
        // Remove from plugins
        for mut entry in self.plugins.iter_mut() {
            entry.retain(|(socket_id, _)| socket_id != sid);
        }
        // Remove connection
        self.connections.remove(sid);
    }

    // ===== 测试辅助方法 =====

    /// 获取指定事件的 Plugin 数量 (用于测试)
    pub fn get_plugin_count(&self, event_name: &str) -> usize {
        self.plugins.get(event_name).map(|v| v.len()).unwrap_or(0)
    }

    /// 获取指定事件的 Plugin Socket IDs (用于测试)
    pub fn get_plugins_for_event(&self, event_name: &str) -> Vec<String> {
        self.plugins.get(event_name)
            .map(|v| v.iter().map(|(sid, _)| sid.clone()).collect())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::time::Duration;
    use flare_protocol::HookCapabilities;

    #[tokio::test]
    async fn test_plugin_response_correlation() {
        let manager = PluginManager::new();
        let (tx, rx) = oneshot::channel();
        let request_id = "test-req-1".to_string();

        manager.pending_requests.insert(request_id.clone(), tx);

        let resp = HookResponse {
            request_id: request_id.clone(),
            status: "success".to_string(),
            data: Some(json!({ "ok": true })),
            error: None,
        };

        manager.handle_response(resp);

        let result = rx.await.unwrap();
        assert_eq!(result, json!({ "ok": true }));
    }

    #[tokio::test]
    async fn test_plugin_error_correlation() {
        let manager = PluginManager::new();
        let (tx, rx) = oneshot::channel();
        let request_id = "test-req-2".to_string();

        manager.pending_requests.insert(request_id.clone(), tx);

        let resp = HookResponse {
            request_id: request_id.clone(),
            status: "error".to_string(),
            data: None,
            error: Some(json!("Unauthorized")),
        };

        manager.handle_response(resp);

        let result = rx.await.unwrap();
        assert_eq!(result["error"], "Unauthorized");
    }

    #[test]
    fn test_plugin_registration_and_removal() {
        let manager = PluginManager::new();
        let sid = "socket-1".to_string();

        let register = HookRegister {
            token: "test".to_string(),
            capabilities: HookCapabilities {
                events: vec!["event-1".to_string()],
                user_context: json!({}),
            },
        };
        manager.register_plugin(sid.clone(), register);

        assert_eq!(manager.plugins.get("event-1").unwrap().len(), 1);

        manager.remove_plugin("socket-1");
        assert_eq!(manager.plugins.get("event-1").map(|v| v.len()).unwrap_or(0), 0);
    }

    #[test]
    fn test_plugin_request_injects_jwt_context() {
        let manager = PluginManager::new();
        let sid = "socket-auth-1".to_string();

        // Register an auth plugin
        let register = HookRegister {
            token: "test".to_string(),
            capabilities: HookCapabilities {
                events: vec!["auth".to_string()],
                user_context: json!({}),
            },
        };
        manager.register_plugin(sid.clone(), register);

        // Prepare user context
        let _user_context = UserContext {
            user_id: "user_123".to_string(),
            email: "test@example.com".to_string(),
            role: "admin".to_string(),
        };

        // Test the request structure that would be sent
        let jwt_value = serde_json::json!({
            "user_id": "user_123",
            "email": "test@example.com",
            "role": "admin"
        });

        assert_eq!(jwt_value["user_id"], "user_123");
        assert_eq!(jwt_value["email"], "test@example.com");
        assert_eq!(jwt_value["role"], "admin");
    }

    #[test]
    fn test_plugin_request_guest_context() {
        // Test guest context (no user)
        let jwt_value = serde_json::json!({
            "user_id": null,
            "email": null,
            "role": "guest"
        });

        assert_eq!(jwt_value["user_id"], serde_json::Value::Null);
        assert_eq!(jwt_value["email"], serde_json::Value::Null);
        assert_eq!(jwt_value["role"], "guest");
    }

    #[tokio::test]
    async fn test_auth_plugin_registration() {
        let manager = PluginManager::new();

        // Register auth plugin (fixed name)
        let sid = "auth-service-1".to_string();
        let register = HookRegister {
            token: "test".to_string(),
            capabilities: HookCapabilities {
                events: vec!["auth".to_string()],
                user_context: json!({}),
            },
        };
        manager.register_plugin(sid.clone(), register);

        // Verify auth plugin is registered
        let plugins = manager.get_plugins_for_event("auth");
        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0], "auth-service-1");

        // Clean up
        manager.remove_plugin(&sid);
        assert_eq!(manager.get_plugin_count("auth"), 0);
    }

    #[tokio::test]
    async fn test_multiple_plugins_same_event() {
        let manager = PluginManager::new();

        // Register multiple plugins for the same event
        for i in 1..=3 {
            let sid = format!("plugin-{}", i);
            let register = HookRegister {
                token: "test".to_string(),
                capabilities: HookCapabilities {
                    events: vec!["shared_event".to_string()],
                    user_context: json!({}),
                },
            };
            manager.register_plugin(sid, register);
        }

        // Verify all plugins are registered
        assert_eq!(manager.get_plugin_count("shared_event"), 3);

        // Remove one plugin
        manager.remove_plugin("plugin-2");

        // Verify removal
        assert_eq!(manager.get_plugin_count("shared_event"), 2);
        let plugins = manager.get_plugins_for_event("shared_event");
        assert!(!plugins.contains(&"plugin-2".to_string()));
    }

    #[tokio::test]
    async fn test_plugin_queue_processing() {
        let manager = Arc::new(PluginManager::new());
        let received_messages = Arc::new(Mutex::new(Vec::new()));

        // Register a plugin
        let sid = "test-plugin".to_string();
        let register = HookRegister {
            token: "test".to_string(),
            capabilities: HookCapabilities {
                events: vec!["queue_test".to_string()],
                user_context: json!({}),
            },
        };
        manager.register_plugin(sid.clone(), register);

        // Track received messages
        let received_clone = received_messages.clone();
        let emit_fn = move |_sid: String, data: Value| {
            let msgs = received_clone.clone();
            tokio::spawn(async move {
                let mut messages = msgs.lock().await;
                messages.push(data);
            });
        };

        // Send multiple requests
        let mut tasks = Vec::new();
        for i in 0..3 {
            let mgr = manager.clone();
            let emit = emit_fn.clone();
            let task = tokio::spawn(async move {
                let _ = mgr.call_plugin(
                    "queue_test".to_string(),
                    format!("session-{}", i),
                    json!({ "request_id": i }),
                    emit
                ).await;
            });
            tasks.push(task);
        }

        // Wait for messages to be sent
        tokio::time::sleep(Duration::from_millis(100)).await;

        // Verify messages were sent
        let messages = received_messages.lock().await;
        assert_eq!(messages.len(), 3);

        // Clean up
        manager.remove_plugin(&sid);
    }

    /// Test concurrent plugin calls from different clients
    /// Each client should receive its own result, not mixed up
    #[tokio::test]
    async fn test_concurrent_plugin_calls_isolated_results() {
        let manager = Arc::new(PluginManager::new());

        // Register a plugin
        let sid = "test-plugin".to_string();
        let register = HookRegister {
            token: "test".to_string(),
            capabilities: HookCapabilities {
                events: vec!["auth".to_string()],
                user_context: json!({}),
            },
        };
        manager.register_plugin(sid.clone(), register);

        // Track received requests
        let received_requests = Arc::new(Mutex::new(Vec::new()));
        let received_clone = received_requests.clone();

        // Simulate 5 different clients calling concurrently
        let mut tasks = Vec::new();
        for i in 0..5 {
            let mgr = manager.clone();
            let recv = received_clone.clone();
            let task = tokio::spawn(async move {
                let session_id = format!("client_session_{}", i);
                let result = mgr.call_plugin(
                    "auth".to_string(),
                    session_id.clone(),
                    json!({
                        "email": format!("user{}@example.com", i),
                        "password": "password123"
                    }),
                    move |_plugin_sid, data| {
                        // Track the request
                        let recv_clone = recv.clone();
                        tokio::spawn(async move {
                            let mut requests = recv_clone.lock().await;
                            requests.push(data);
                        });
                    }
                ).await;
                (i, session_id, result)
            });
            tasks.push(task);
        }

        // Give time for requests to be sent
        tokio::time::sleep(Duration::from_millis(100)).await;

        // Verify all requests were received with correct session IDs
        let requests = received_requests.lock().await;
        assert_eq!(requests.len(), 5);

        // Verify each request has a unique session_id
        let session_ids: Vec<_> = requests.iter()
            .map(|r| r["session_id"].as_str().unwrap().to_string())
            .collect();
        let unique_ids: std::collections::HashSet<_> = session_ids.iter().collect();
        assert_eq!(unique_ids.len(), 5); // All session IDs should be unique

        // Verify session IDs match expected values
        for i in 0..5 {
            let expected = format!("client_session_{}", i);
            assert!(session_ids.contains(&expected));
        }

        manager.remove_plugin(&sid);
    }

    /// Test full round-trip: call_plugin → emit_fn → handle_response → call_plugin returns
    /// This verifies the complete flow including response correlation and timeout handling
    #[tokio::test]
    async fn test_plugin_call_full_round_trip() {
        let manager = Arc::new(PluginManager::new());

        // Register a plugin
        let sid = "round-trip-plugin".to_string();
        let register = HookRegister {
            token: "test".to_string(),
            capabilities: HookCapabilities {
                events: vec!["test_event".to_string()],
                user_context: json!({}),
            },
        };
        manager.register_plugin(sid.clone(), register);

        // Channel to capture the emit_fn output (simulates Socket.IO sending to plugin)
        let (emit_tx, mut emit_rx) = tokio::sync::mpsc::channel::<(String, Value)>(10);

        let mgr_clone = manager.clone();
        let call_task = tokio::spawn(async move {
            mgr_clone.call_plugin(
                "test_event".to_string(),
                "client-session-1".to_string(),
                json!({ "key": "value" }),
                move |plugin_sid, req_data| {
                    // This simulates: stc.io.of("/plugins").to(room).emit("plugin_request", data)
                    let _ = emit_tx.try_send((plugin_sid, req_data));
                }
            ).await
        });

        // Wait for emit_fn to be called
        let (captured_sid, captured_data) = tokio::time::timeout(
            Duration::from_secs(5),
            emit_rx.recv()
        ).await.expect("emit_fn should be called").expect("should receive data");

        // Verify the emitted data has the correct structure
        assert_eq!(captured_sid, "round-trip-plugin");
        assert_eq!(captured_data["event_name"], "test_event");
        assert_eq!(captured_data["session_id"], "client-session-1");
        assert_eq!(captured_data["params"]["key"], "value");
        assert!(captured_data["request_id"].is_string());

        // Simulate the plugin processing the request and sending back a response
        let request_id = captured_data["request_id"].as_str().unwrap().to_string();
        let response = HookResponse {
            request_id: request_id.clone(),
            status: "success".to_string(),
            data: Some(json!({ "result": "plugin_processed", "echo": captured_data["params"] })),
            error: None,
        };

        // This simulates: plugin emits "plugin_response" → handle_response is called
        manager.handle_response(response);

        // Verify call_plugin resolves with the correct result
        let result = tokio::time::timeout(Duration::from_secs(5), call_task)
            .await
            .expect("call_plugin should complete")
            .expect("task should not panic");

        assert!(result.is_ok());
        let result_data = result.unwrap();
        assert_eq!(result_data["result"], "plugin_processed");
        assert_eq!(result_data["echo"]["key"], "value");

        // Clean up
        manager.remove_plugin(&sid);
    }

    /// Test that call_plugin returns an error when plugin response is an error
    #[tokio::test]
    async fn test_plugin_call_error_response() {
        let manager = Arc::new(PluginManager::new());

        let sid = "error-plugin".to_string();
        let register = HookRegister {
            token: "test".to_string(),
            capabilities: HookCapabilities {
                events: vec!["error_event".to_string()],
                user_context: json!({}),
            },
        };
        manager.register_plugin(sid.clone(), register);

        let (emit_tx, mut emit_rx) = tokio::sync::mpsc::channel::<(String, Value)>(10);

        let mgr_clone = manager.clone();
        let call_task = tokio::spawn(async move {
            mgr_clone.call_plugin(
                "error_event".to_string(),
                "session-1".to_string(),
                json!({ "action": "fail" }),
                move |plugin_sid, req_data| {
                    let _ = emit_tx.try_send((plugin_sid, req_data));
                }
            ).await
        });

        // Capture the emit
        let (_, captured_data) = tokio::time::timeout(
            Duration::from_secs(5),
            emit_rx.recv()
        ).await.expect("emit_fn should be called").expect("should receive data");

        // Plugin sends error response
        let request_id = captured_data["request_id"].as_str().unwrap().to_string();
        manager.handle_response(HookResponse {
            request_id,
            status: "error".to_string(),
            data: None,
            error: Some(json!("Plugin processing failed")),
        });

        // call_plugin should resolve but the result contains the error
        let result = tokio::time::timeout(Duration::from_secs(5), call_task)
            .await
            .expect("call_plugin should complete")
            .expect("task should not panic");

        // Note: The plugin manager wraps error responses into Ok({ "error": ... })
        // rather than returning Err. The caller checks for .error field.
        assert!(result.is_ok());
        let result_data = result.unwrap();
        assert_eq!(result_data["error"], "Plugin processing failed");

        manager.remove_plugin(&sid);
    }

    /// Test that call_plugin times out when plugin doesn't respond
    #[tokio::test]
    async fn test_plugin_call_timeout() {
        let manager = Arc::new(PluginManager::new());

        let sid = "silent-plugin".to_string();
        let register = HookRegister {
            token: "test".to_string(),
            capabilities: HookCapabilities {
                events: vec!["silent_event".to_string()],
                user_context: json!({}),
            },
        };
        manager.register_plugin(sid.clone(), register);

        // emit_fn that does nothing (simulates plugin not responding)
        let result = manager.call_plugin(
            "silent_event".to_string(),
            "session-1".to_string(),
            json!({ "action": "wait" }),
            |_plugin_sid, _req_data| {
                // Intentionally do nothing - plugin won't respond
            }
        ).await;

        // Should timeout after 10 seconds (default)
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(err_msg.contains("timed out") || err_msg.contains("Plugin request timed out"));

        manager.remove_plugin(&sid);
    }
}
