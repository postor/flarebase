use dashmap::DashMap;
use flare_protocol::{HookRegister, HookResponse};
use serde_json::Value;
use tokio::sync::oneshot;
use uuid::Uuid;

pub struct HookManager {
    // event_name -> Vec<SocketId>
    hooks: DashMap<String, Vec<String>>,
    // requestId -> Sender for the client's await
    pending_requests: DashMap<String, oneshot::Sender<Value>>,
}

impl HookManager {
    pub fn new() -> Self {
        Self {
            hooks: DashMap::new(),
            pending_requests: DashMap::new(),
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

        let request_data = serde_json::json!({
            "request_id": request_id,
            "event_name": event_name,
            "session_id": session_id,
            "params": params
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
}
