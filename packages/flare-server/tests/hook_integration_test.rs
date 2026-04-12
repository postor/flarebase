/// Hook Manager Integration Tests (using PluginManager)

use flare_server::plugin_manager::PluginManager;
use flare_protocol::{HookRegister, HookCapabilities, HookResponse};
use serde_json::json;
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use tokio::time::Duration;

struct MockWebSocketManager {
    sent_messages: Arc<Mutex<HashMap<String, Vec<serde_json::Value>>>>,
}

impl MockWebSocketManager {
    fn new() -> Self {
        Self {
            sent_messages: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn emit_to_socket(&self, socket_id: String, message: serde_json::Value) {
        let mut messages = self.sent_messages.lock().unwrap();
        messages.entry(socket_id).or_default().push(message);
    }

    fn get_messages(&self, socket_id: &str) -> Vec<serde_json::Value> {
        let messages = self.sent_messages.lock().unwrap();
        messages.get(socket_id).cloned().unwrap_or_default()
    }
}

#[tokio::test]
async fn test_plugin_registration_and_call() {
    let hook_manager = Arc::new(PluginManager::new());
    let mock_ws = Arc::new(MockWebSocketManager::new());

    let register = HookRegister {
        token: "test-token".to_string(),
        capabilities: HookCapabilities {
            events: vec!["UserCreated".to_string(), "DocUpdated".to_string()],
            user_context: json!({ "service": "test-service" }),
        },
    };
    let socket_id = "socket-1".to_string();
    hook_manager.register_plugin(socket_id.clone(), register);

    assert_eq!(hook_manager.get_plugin_count("UserCreated"), 1);
    assert_eq!(hook_manager.get_plugin_count("DocUpdated"), 1);
    let registered_hooks = hook_manager.get_plugins_for_event("UserCreated");
    assert_eq!(registered_hooks[0], socket_id);

    let hook_manager_clone = hook_manager.clone();
    let mock_ws_clone = mock_ws.clone();
    let call_task = tokio::spawn(async move {
        hook_manager_clone.call_plugin(
            "UserCreated".to_string(),
            "session-1".to_string(),
            json!({ "userId": "123", "name": "Alice" }),
            move |plugin_sid, req_data| {
                mock_ws_clone.emit_to_socket(plugin_sid, req_data);
            }
        ).await
    });

    tokio::time::sleep(Duration::from_millis(100)).await;

    let messages = mock_ws.get_messages("socket-1");
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["event_name"], "UserCreated");
    assert_eq!(messages[0]["params"]["userId"], "123");
    assert_eq!(messages[0]["params"]["name"], "Alice");

    let request_id = messages[0]["request_id"].as_str().unwrap().to_string();
    let response = HookResponse {
        request_id,
        status: "success".to_string(),
        data: Some(json!({ "status": "processed" })),
        error: None,
    };
    hook_manager.handle_response(response);

    let result = tokio::time::timeout(Duration::from_secs(5), call_task).await.unwrap().unwrap();
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_multi_event_registration() {
    let hook_manager = PluginManager::new();
    let socket_id = "socket-1".to_string();

    let register = HookRegister {
        token: "test-token".to_string(),
        capabilities: HookCapabilities {
            events: vec![
                "UserCreated".to_string(),
                "UserUpdated".to_string(),
                "UserDeleted".to_string(),
                "DocCreated".to_string(),
            ],
            user_context: json!({}),
        },
    };
    hook_manager.register_plugin(socket_id.clone(), register);

    assert_eq!(hook_manager.get_plugin_count("UserCreated"), 1);
    assert_eq!(hook_manager.get_plugin_count("UserUpdated"), 1);
    assert_eq!(hook_manager.get_plugin_count("UserDeleted"), 1);
    assert_eq!(hook_manager.get_plugin_count("DocCreated"), 1);

    assert_eq!(hook_manager.get_plugins_for_event("UserCreated")[0], socket_id);
    assert_eq!(hook_manager.get_plugins_for_event("UserUpdated")[0], socket_id);
    assert_eq!(hook_manager.get_plugins_for_event("UserDeleted")[0], socket_id);
    assert_eq!(hook_manager.get_plugins_for_event("DocCreated")[0], socket_id);
}

#[tokio::test]
async fn test_plugin_error_handling() {
    let hook_manager = Arc::new(PluginManager::new());
    let mock_ws = Arc::new(MockWebSocketManager::new());

    let register = HookRegister {
        token: "test-token".to_string(),
        capabilities: HookCapabilities {
            events: vec!["UserCreated".to_string()],
            user_context: json!({}),
        },
    };
    let socket_id = "socket-1".to_string();
    hook_manager.register_plugin(socket_id.clone(), register);

    let hook_manager_clone = hook_manager.clone();
    let mock_ws_clone = mock_ws.clone();
    let call_task = tokio::spawn(async move {
        hook_manager_clone.call_plugin(
            "UserCreated".to_string(),
            "session-1".to_string(),
            json!({}),
            move |plugin_sid, req_data| {
                mock_ws_clone.emit_to_socket(plugin_sid, req_data);
            }
        ).await
    });

    tokio::time::sleep(Duration::from_millis(100)).await;

    let messages = mock_ws.get_messages("socket-1");
    assert_eq!(messages.len(), 1);

    let request_id = messages[0]["request_id"].as_str().unwrap().to_string();
    let error_response = HookResponse {
        request_id,
        status: "error".to_string(),
        data: None,
        error: Some(json!("Processing failed")),
    };
    hook_manager.handle_response(error_response);

    let result = tokio::time::timeout(Duration::from_secs(5), call_task).await.unwrap().unwrap();
    assert!(result.is_ok());
    assert_eq!(result.unwrap()["error"], "Processing failed");
}

#[tokio::test]
async fn test_plugin_timeout() {
    let hook_manager = PluginManager::new();

    let register = HookRegister {
        token: "test-token".to_string(),
        capabilities: HookCapabilities {
            events: vec!["SlowEvent".to_string()],
            user_context: json!({}),
        },
    };
    let socket_id = "socket-1".to_string();
    hook_manager.register_plugin(socket_id.clone(), register);

    let result = tokio::time::timeout(
        Duration::from_secs(12),
        hook_manager.call_plugin(
            "SlowEvent".to_string(),
            "session-1".to_string(),
            json!({}),
            |_sid, _data| { /* no response */ }
        )
    ).await.unwrap();

    assert!(result.is_err());
}

#[tokio::test]
async fn test_plugin_removal() {
    let hook_manager = PluginManager::new();

    let register1 = HookRegister {
        token: "test-token".to_string(),
        capabilities: HookCapabilities {
            events: vec!["Event1".to_string(), "Event2".to_string()],
            user_context: json!({}),
        },
    };
    let register2 = HookRegister {
        token: "test-token".to_string(),
        capabilities: HookCapabilities {
            events: vec!["Event1".to_string(), "Event2".to_string(), "Event3".to_string()],
            user_context: json!({}),
        },
    };
    hook_manager.register_plugin("socket-1".to_string(), register1);
    hook_manager.register_plugin("socket-2".to_string(), register2);

    assert_eq!(hook_manager.get_plugin_count("Event1"), 2);
    assert_eq!(hook_manager.get_plugin_count("Event2"), 2);
    assert_eq!(hook_manager.get_plugin_count("Event3"), 1);

    hook_manager.remove_plugin("socket-1");

    assert_eq!(hook_manager.get_plugin_count("Event1"), 1);
    assert_eq!(hook_manager.get_plugin_count("Event2"), 1);
    assert_eq!(hook_manager.get_plugin_count("Event3"), 1);

    hook_manager.remove_plugin("socket-2");

    assert_eq!(hook_manager.get_plugin_count("Event1"), 0);
    assert_eq!(hook_manager.get_plugin_count("Event2"), 0);
    assert_eq!(hook_manager.get_plugin_count("Event3"), 0);
}

#[tokio::test]
async fn test_no_registered_plugins() {
    let hook_manager = PluginManager::new();

    let result: Result<serde_json::Value, anyhow::Error> = hook_manager.call_plugin(
        "UserCreated".to_string(),
        "session-1".to_string(),
        json!({}),
        |_sid, _data| {}
    ).await;

    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("No plugin registered"));
}

#[tokio::test]
async fn test_concurrent_plugin_calls() {
    let hook_manager = Arc::new(PluginManager::new());
    let mock_ws = Arc::new(MockWebSocketManager::new());

    let register = HookRegister {
        token: "test-token".to_string(),
        capabilities: HookCapabilities {
            events: vec!["UserCreated".to_string()],
            user_context: json!({}),
        },
    };
    let socket_id = "socket-1".to_string();
    hook_manager.register_plugin(socket_id.clone(), register);

    let mut tasks = Vec::new();
    let mut request_ids = Vec::new();

    for i in 0..3 {
        let hm = hook_manager.clone();
        let ws = mock_ws.clone();
        let task = tokio::spawn(async move {
            hm.call_plugin(
                "UserCreated".to_string(),
                format!("session-{}", i),
                json!({ "index": i }),
                move |plugin_sid, req_data| {
                    ws.emit_to_socket(plugin_sid, req_data);
                }
            ).await
        });
        tasks.push(task);
    }

    tokio::time::sleep(Duration::from_millis(200)).await;

    let messages = mock_ws.get_messages("socket-1");
    assert_eq!(messages.len(), 3);

    for msg in &messages {
        let request_id = msg["request_id"].as_str().unwrap().to_string();
        request_ids.push(request_id);
    }

    for request_id in request_ids {
        let response = HookResponse {
            request_id,
            status: "success".to_string(),
            data: Some(json!({ "status": "processed" })),
            error: None,
        };
        hook_manager.handle_response(response);
    }

    for task in tasks {
        let result = tokio::time::timeout(Duration::from_secs(5), task).await.unwrap().unwrap();
        assert!(result.is_ok());
    }
}
