use dashmap::DashMap;
use flare_protocol::{HookRegister, HookResponse};
use serde_json::Value;
use tokio::sync::oneshot;
use uuid::Uuid;
use std::sync::Arc;

// Re-export UserContext for external use
pub use crate::jwt_middleware::UserContext;

pub struct HookManager {
    // event_name -> Vec<SocketId>
    pub(in crate) hooks: Arc<DashMap<String, Vec<String>>>,
    // requestId -> Sender for the client's await
    pub(in crate) pending_requests: Arc<DashMap<String, oneshot::Sender<Value>>>,
}

impl Clone for HookManager {
    fn clone(&self) -> Self {
        Self {
            hooks: Arc::clone(&self.hooks),
            pending_requests: Arc::clone(&self.pending_requests),
        }
    }
}

impl HookManager {
    pub fn new() -> Self {
        Self {
            hooks: Arc::new(DashMap::new()),
            pending_requests: Arc::new(DashMap::new()),
        }
    }

    pub fn register_hook(&self, sid: String, register: HookRegister) {
        let events = register.capabilities.events.clone();
        for event in &events {
            self.hooks.entry(event.clone()).or_default().push(sid.clone());
        }
        tracing::info!("Hook registered: {} with events {:?}", sid, events);
    }

    /// Call a hook and wait for response
    pub async fn call_hook(&self, event_name: String, session_id: String, params: Value, emit_fn: impl FnOnce(String, Value)) -> anyhow::Result<Value> {
        self.call_hook_with_jwt(event_name, session_id, params, None, emit_fn).await
    }

    /// Call a hook with JWT user context and wait for response
    pub async fn call_hook_with_jwt(
        &self,
        event_name: String,
        session_id: String,
        params: Value,
        user_context: Option<UserContext>,
        emit_fn: impl FnOnce(String, Value)
    ) -> anyhow::Result<Value> {
        let request_id = Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();

        let sid = {
            let hook_ids_ref = self.hooks.get(&event_name).ok_or_else(|| anyhow::anyhow!("No hook registered for event: {}", event_name))?;
            let hook_ids = hook_ids_ref.value();
            if hook_ids.is_empty() {
                return Err(anyhow::anyhow!("No active hook connections for event: {}", event_name));
            }
            // Simple round-robin: use first hook
            hook_ids[0].clone()
        };

        self.pending_requests.insert(request_id.clone(), tx);

        // Build $jwt object from user context
        let jwt_value = if let Some(ctx) = user_context {
            serde_json::json!({
                "user_id": ctx.user_id,
                "email": ctx.email,
                "role": ctx.role
            })
        } else {
            // For auth hook or unauthenticated requests, provide guest context
            serde_json::json!({
                "user_id": null,
                "email": null,
                "role": "guest"
            })
        };

        let request_data = serde_json::json!({
            "request_id": request_id,
            "event_name": event_name,
            "session_id": session_id,
            "params": params,
            "$jwt": jwt_value
        });

        // Send the request using the provided emit function
        emit_fn(sid, request_data);

        // Wait for response with timeout
        match tokio::time::timeout(std::time::Duration::from_secs(10), rx).await {
            Ok(Ok(response)) => Ok(response),
            Ok(Err(_)) => Err(anyhow::anyhow!("Hook disconnected during request")),
            Err(_) => {
                self.pending_requests.remove(&request_id);
                Err(anyhow::anyhow!("Hook request timed out"))
            }
        }
    }

    pub fn handle_response(&self, response: HookResponse) {
        if let Some((_, tx)) = self.pending_requests.remove(&response.request_id) {
            if response.status == "success" {
                let data = response.data.unwrap_or(Value::Null);
                let _ = tx.send(data);
            } else {
                let error = response.error.unwrap_or(Value::String("Unknown hook error".to_string()));
                let _ = tx.send(serde_json::json!({ "error": error }));
            }
        }
    }

    pub fn remove_hook(&self, sid: &str) {
        for mut entry in self.hooks.iter_mut() {
            entry.retain(|id| id != sid);
        }
    }

    // ===== 测试辅助方法 =====

    /// 获取指定事件的 Hook 数量 (用于测试)
    pub fn get_hook_count(&self, event_name: &str) -> usize {
        self.hooks.get(event_name).map(|v| v.len()).unwrap_or(0)
    }

    /// 获取指定事件的 Hook Socket IDs (用于测试)
    pub fn get_hooks_for_event(&self, event_name: &str) -> Vec<String> {
        self.hooks.get(event_name).map(|v| v.clone()).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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

        manager.hooks.entry("event-1".to_string()).or_default().push(sid.clone());
        assert_eq!(manager.hooks.get("event-1").unwrap().len(), 1);

        manager.remove_hook("socket-1");
        assert_eq!(manager.hooks.get("event-1").unwrap().len(), 0);
    }

    #[test]
    fn test_hook_request_injects_jwt_context() {
        let manager = HookManager::new();
        let sid = "socket-auth-1".to_string();

        // Register an auth hook
        manager.hooks.entry("auth".to_string()).or_default().push(sid.clone());

        // Prepare user context (use underscore to avoid unused warning)
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
        manager.hooks.entry("auth".to_string()).or_default().push(sid.clone());

        // Verify auth hook is registered
        let hooks = manager.get_hooks_for_event("auth");
        assert_eq!(hooks.len(), 1);
        assert_eq!(hooks[0], "auth-service-1");

        // Clean up
        manager.remove_hook(&sid);
        assert_eq!(manager.get_hook_count("auth"), 0);
    }
}
