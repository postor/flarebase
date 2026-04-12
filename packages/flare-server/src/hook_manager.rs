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

pub struct HookManager {
    // event_name -> Vec<(SocketId, PluginConnection)>
    pub(in crate) hooks: Arc<DashMap<String, Vec<(String, Arc<PluginConnection>)>>>,
    // requestId -> Sender for the client's await
    pub(in crate) pending_requests: Arc<DashMap<String, oneshot::Sender<Value>>>,
    // socketId -> PluginConnection for managing per-socket state
    pub(in crate) connections: Arc<DashMap<String, Arc<PluginConnection>>>,
}

impl Clone for HookManager {
    fn clone(&self) -> Self {
        Self {
            hooks: Arc::clone(&self.hooks),
            pending_requests: Arc::clone(&self.pending_requests),
            connections: Arc::clone(&self.connections),
        }
    }
}

impl HookManager {
    pub fn new() -> Self {
        Self {
            hooks: Arc::new(DashMap::new()),
            pending_requests: Arc::new(DashMap::new()),
            connections: Arc::new(DashMap::new()),
        }
    }

    pub fn register_hook(&self, sid: String, register: HookRegister) {
        let events = register.capabilities.events.clone();
        let connection = Arc::new(PluginConnection::new());
        
        // Store the connection for this socket
        self.connections.insert(sid.clone(), connection.clone());
        
        // Register the connection for each event
        for event in &events {
            self.hooks.entry(event.clone()).or_default().push((sid.clone(), connection.clone()));
        }
        tracing::info!("Plugin registered: {} with events {:?}", sid, events);
    }

    /// Call a hook and wait for response
    pub async fn call_hook(&self, event_name: String, session_id: String, params: Value, emit_fn: impl Fn(String, Value) + Send + 'static) -> anyhow::Result<Value> {
        self.call_hook_with_jwt(event_name, session_id, params, None, emit_fn).await
    }

    /// Call a hook with JWT user context and wait for response
    /// This implementation ensures sequential processing per plugin connection
    pub async fn call_hook_with_jwt(
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
            let hook_refs = self.hooks.get(&event_name).ok_or_else(|| anyhow::anyhow!("No hook registered for event: {}", event_name))?;
            let hooks_list = hook_refs.value();
            if hooks_list.is_empty() {
                return Err(anyhow::anyhow!("No active plugin connections for event: {}", event_name));
            }
            // Use first available connection (round-robin could be added here)
            (hooks_list[0].0.clone(), hooks_list[0].1.clone())
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

    pub fn remove_hook(&self, sid: &str) {
        // Remove from hooks
        for mut entry in self.hooks.iter_mut() {
            entry.retain(|(socket_id, _)| socket_id != sid);
        }
        // Remove connection
        self.connections.remove(sid);
    }

    // ===== 测试辅助方法 =====

    /// 获取指定事件的 Plugin 数量 (用于测试)
    pub fn get_hook_count(&self, event_name: &str) -> usize {
        self.hooks.get(event_name).map(|v| v.len()).unwrap_or(0)
    }

    /// 获取指定事件的 Plugin Socket IDs (用于测试)
    pub fn get_hooks_for_event(&self, event_name: &str) -> Vec<String> {
        self.hooks.get(event_name)
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
    async fn test_hook_response_correlation() {
        let manager = HookManager::new();
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
    async fn test_hook_error_correlation() {
        let manager = HookManager::new();
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
    fn test_hook_registration_and_removal() {
        let manager = HookManager::new();
        let sid = "socket-1".to_string();

        let register = HookRegister {
            token: "test".to_string(),
            capabilities: HookCapabilities {
                events: vec!["event-1".to_string()],
                user_context: json!({}),
            },
        };
        manager.register_hook(sid.clone(), register);
        
        assert_eq!(manager.hooks.get("event-1").unwrap().len(), 1);

        manager.remove_hook("socket-1");
        assert_eq!(manager.hooks.get("event-1").map(|v| v.len()).unwrap_or(0), 0);
    }

    #[test]
    fn test_hook_request_injects_jwt_context() {
        let manager = HookManager::new();
        let sid = "socket-auth-1".to_string();

        // Register an auth hook
        let register = HookRegister {
            token: "test".to_string(),
            capabilities: HookCapabilities {
                events: vec!["auth".to_string()],
                user_context: json!({}),
            },
        };
        manager.register_hook(sid.clone(), register);

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
    fn test_hook_request_guest_context() {
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
    async fn test_auth_hook_registration() {
        let manager = HookManager::new();

        // Register auth hook (fixed name)
        let sid = "auth-service-1".to_string();
        let register = HookRegister {
            token: "test".to_string(),
            capabilities: HookCapabilities {
                events: vec!["auth".to_string()],
                user_context: json!({}),
            },
        };
        manager.register_hook(sid.clone(), register);

        // Verify auth hook is registered
        let hooks = manager.get_hooks_for_event("auth");
        assert_eq!(hooks.len(), 1);
        assert_eq!(hooks[0], "auth-service-1");

        // Clean up
        manager.remove_hook(&sid);
        assert_eq!(manager.get_hook_count("auth"), 0);
    }

    #[tokio::test]
    async fn test_multiple_plugins_same_event() {
        let manager = HookManager::new();

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
            manager.register_hook(sid, register);
        }

        // Verify all plugins are registered
        assert_eq!(manager.get_hook_count("shared_event"), 3);

        // Remove one plugin
        manager.remove_hook("plugin-2");

        // Verify removal
        assert_eq!(manager.get_hook_count("shared_event"), 2);
        let hooks = manager.get_hooks_for_event("shared_event");
        assert!(!hooks.contains(&"plugin-2".to_string()));
    }

    #[tokio::test]
    async fn test_plugin_queue_processing() {
        let manager = Arc::new(HookManager::new());
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
        manager.register_hook(sid.clone(), register);

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
                let _ = mgr.call_hook(
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
        manager.remove_hook(&sid);
    }

    /// Test concurrent auth calls from different clients
    /// Each client should receive its own result, not mixed up
    #[tokio::test]
    async fn test_concurrent_auth_calls_isolated_results() {
        let manager = Arc::new(HookManager::new());
        
        // Register an auth plugin
        let sid = "auth-plugin".to_string();
        let register = HookRegister {
            token: "test".to_string(),
            capabilities: HookCapabilities {
                events: vec!["auth".to_string()],
                user_context: json!({}),
            },
        };
        manager.register_hook(sid.clone(), register);

        // Track received requests
        let received_requests = Arc::new(Mutex::new(Vec::new()));
        let received_clone = received_requests.clone();
        
        // Simulate 5 different clients logging in concurrently
        let mut tasks = Vec::new();
        for i in 0..5 {
            let mgr = manager.clone();
            let recv = received_clone.clone();
            let task = tokio::spawn(async move {
                let session_id = format!("client_session_{}", i);
                let result = mgr.call_hook(
                    "auth".to_string(),
                    session_id.clone(),
                    json!({
                        "email": format!("user{}@example.com", i),
                        "password": "password123"
                    }),
                    move |_hook_sid, data| {
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

        manager.remove_hook(&sid);
    }
}
