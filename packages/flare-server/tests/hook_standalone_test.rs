/// 独立的 Hook 管理器测试
/// 不依赖 flare-db，只测试 Hook 核心功能

use flare_server::hook_manager::HookManager;
use flare_protocol::{HookRegister, HookCapabilities, HookResponse};
use serde_json::json;
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use tokio::time::{timeout, Duration};

/// 模拟的 WebSocket 连接管理器
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
async fn test_hook_registration() {
    let hook_manager = HookManager::new();

    // 注册一个 Hook
    let register = HookRegister {
        token: "test-token".to_string(),
        capabilities: HookCapabilities {
            events: vec!["UserCreated".to_string()],
            user_context: json!({ "service": "test-service" }),
        },
    };

    hook_manager.register_hook("socket-1".to_string(), register);

    // 验证注册成功
    assert_eq!(hook_manager.get_hook_count("UserCreated"), 1);
    let hooks = hook_manager.get_hooks_for_event("UserCreated");
    assert_eq!(hooks[0], "socket-1");
}

#[tokio::test]
async fn test_hook_removal() {
    let hook_manager = HookManager::new();

    let register = HookRegister {
        token: "test-token".to_string(),
        capabilities: HookCapabilities {
            events: vec!["Event1".to_string(), "Event2".to_string()],
            user_context: json!({}),
        },
    };

    hook_manager.register_hook("socket-1".to_string(), register);

    // 验证初始状态
    assert_eq!(hook_manager.get_hook_count("Event1"), 1);
    assert_eq!(hook_manager.get_hook_count("Event2"), 1);

    // 移除 Hook
    hook_manager.remove_hook("socket-1");

    // 验证移除成功
    assert_eq!(hook_manager.get_hook_count("Event1"), 0);
    assert_eq!(hook_manager.get_hook_count("Event2"), 0);
}

#[tokio::test]
async fn test_hook_call_and_response() {
    let hook_manager = Arc::new(HookManager::new());
    let ws_manager = Arc::new(MockWebSocketManager::new());

    // 注册 Hook
    let register = HookRegister {
        token: "test-token".to_string(),
        capabilities: HookCapabilities {
            events: vec!["TestEvent".to_string()],
            user_context: json!({}),
        },
    };
    let socket_id = "test-hook".to_string();
    hook_manager.register_hook(socket_id.clone(), register);

    // 调用 Hook
    let ws_manager_clone = ws_manager.clone();
    let hook_manager_clone = hook_manager.clone();

    let call_task = tokio::spawn(async move {
        hook_manager_clone.call_hook(
            "TestEvent".to_string(),
            "session-123".to_string(),
            json!({ "data": "test" }),\n            move |sid, data| {
                ws_manager_clone.emit_to_socket(sid, data);
            },
        ).await
    });

    // 等待消息发送
    tokio::time::sleep(Duration::from_millis(50)).await;

    // 获取发送的消息
    let sent_messages = ws_manager.get_messages(&socket_id);
    assert_eq!(sent_messages.len(), 1);

    let request = &sent_messages[0];
    assert_eq!(request["event_name"], "TestEvent");
    let request_id = request["request_id"].as_str().unwrap().to_string();

    // 发送响应
    let response = HookResponse {
        request_id,
        status: "success".to_string(),
        data: Some(json!({ "result": "ok" })),
        error: None,
    };
    hook_manager.handle_response(response);

    // 验证结果
    let result = call_task.await.unwrap().unwrap();
    assert_eq!(result["result"], "ok");
}

#[tokio::test]
async fn test_hook_call_no_registered_hooks() {
    let hook_manager = HookManager::new();
    let ws_manager = Arc::new(MockWebSocketManager::new());

    // 尝试调用未注册的事件
    let ws_manager_clone = ws_manager.clone();
    let result = hook_manager.call_hook(
        "NonExistentEvent".to_string(),
        "session-000".to_string(),
        json!({ "test": true }),\n        move |sid, data| {
            ws_manager_clone.emit_to_socket(sid, data);
        },
    ).await;

    // 验证返回错误
    assert!(result.is_err());
    let error_msg = result.unwrap_err().to_string();
    assert!(error_msg.contains("No hook registered"));
}

#[tokio::test]
async fn test_hook_timeout() {
    let hook_manager = HookManager::new();
    let ws_manager = Arc::new(MockWebSocketManager::new());

    // 注册 Hook
    let register = HookRegister {
        token: "timeout-token".to_string(),
        capabilities: HookCapabilities {
            events: vec!["TimeoutEvent".to_string()],
            user_context: json!({}),
        },
    };
    let socket_id = "slow-hook".to_string();
    hook_manager.register_hook(socket_id.clone(), register);

    // 调用 Hook 但不发送响应 (模拟超时)
    let ws_manager_clone = ws_manager.clone();
    let result = timeout(
        Duration::from_millis(100),
        hook_manager.call_hook(
            "TimeoutEvent".to_string(),
            "session-timeout".to_string(),
            json!({ "test": true }),\n            move |sid, data| {
                ws_manager_clone.emit_to_socket(sid, data);
                // 故意不发送响应
            },
        )
    ).await;

    // 验证发生超时
    assert!(result.is_err());

    // 清理
    hook_manager.remove_hook(&socket_id);
}

#[tokio::test]
async fn test_hook_error_response() {
    let hook_manager = Arc::new(HookManager::new());
    let ws_manager = Arc::new(MockWebSocketManager::new());

    // 注册 Hook
    let register = HookRegister {
        token: "error-token".to_string(),
        capabilities: HookCapabilities {
            events: vec!["ErrorEvent".to_string()],
            user_context: json!({}),
        },
    };
    let socket_id = "error-hook".to_string();
    hook_manager.register_hook(socket_id.clone(), register);

    // 调用 Hook
    let ws_manager_clone = ws_manager.clone();
    let hook_manager_clone = hook_manager.clone();

    let call_task = tokio::spawn(async move {
        hook_manager_clone.call_hook(
            "ErrorEvent".to_string(),
            "session-error".to_string(),
            json!({ "invalid": true }),\n            move |sid, data| {
                ws_manager_clone.emit_to_socket(sid, data);
            },
        ).await
    });

    // 等待消息发送
    tokio::time::sleep(Duration::from_millis(50)).await;

    // 获取请求的 request_id
    let sent_messages = ws_manager.get_messages(&socket_id);
    let request_id = sent_messages[0]["request_id"].as_str().unwrap().to_string();

    // 发送错误响应
    let response = HookResponse {
        request_id,
        status: "error".to_string(),
        data: None,
        error: Some(json!({ "code": "INVALID", "message": "Invalid data" })),
    };
    hook_manager.handle_response(response);

    // 验证返回了错误数据
    let result = call_task.await.unwrap().unwrap();
    assert!(result["error"].is_object());
    assert_eq!(result["error"]["code"], "INVALID");
}

#[tokio::test]
async fn test_multiple_hooks_same_event() {
    let hook_manager = HookManager::new();

    // 注册多个 Hook 订阅同一事件
    for i in 1..=3 {
        let register = HookRegister {
            token: format!("token-{}", i),
            capabilities: HookCapabilities {
                events: vec!["SharedEvent".to_string()],
                user_context: json!({}),
            },
        };
        hook_manager.register_hook(format!("socket-{}", i), register);
    }

    // 验证所有 Hook 都已注册
    assert_eq!(hook_manager.get_hook_count("SharedEvent"), 3);

    // 移除一个 Hook
    hook_manager.remove_hook("socket-2");

    // 验证移除后的状态
    assert_eq!(hook_manager.get_hook_count("SharedEvent"), 2);
    let hooks = hook_manager.get_hooks_for_event("SharedEvent");
    assert!(!hooks.contains(&"socket-2".to_string()));
}

#[tokio::test]
async fn test_hook_multiple_events() {
    let hook_manager = HookManager::new();

    // 注册一个支持多个事件的 Hook
    let register = HookRegister {
        token: "multi-token".to_string(),
        capabilities: HookCapabilities {
            events: vec![
                "Event1".to_string(),
                "Event2".to_string(),
                "Event3".to_string(),
            ],
            user_context: json!({}),
        },
    };
    hook_manager.register_hook("multi-hook".to_string(), register);

    // 验证所有事件都已注册
    assert_eq!(hook_manager.get_hook_count("Event1"), 1);
    assert_eq!(hook_manager.get_hook_count("Event2"), 1);
    assert_eq!(hook_manager.get_hook_count("Event3"), 1);
}

#[tokio::test]
async fn test_concurrent_hook_calls() {
    let hook_manager = Arc::new(HookManager::new());
    let ws_manager = Arc::new(MockWebSocketManager::new());

    // 注册 Hook
    let register = HookRegister {
        token: "concurrent-token".to_string(),
        capabilities: HookCapabilities {
            events: vec!["ConcurrentEvent".to_string()],
            user_context: json!({}),
        },
    };
    let socket_id = "concurrent-hook".to_string();
    hook_manager.register_hook(socket_id.clone(), register);

    // 并发发起多个调用
    let mut tasks = Vec::new();
    for i in 0..5 {
        let hm = hook_manager.clone();
        let wm = ws_manager.clone();
        let task = tokio::spawn(async move {
            let result = hm.call_hook(
                "ConcurrentEvent".to_string(),
                format!("session-{}", i),
                json!({ "index": i }),
                move |sid, data| {
                    wm.emit_to_socket(sid, data);
                },
            ).await;
            (i, result)
        });
        tasks.push(task);
    }

    // 等待消息发送
    tokio::time::sleep(Duration::from_millis(50)).await;

    // 验证所有请求都已发送
    let sent_messages = ws_manager.get_messages(&socket_id);
    assert_eq!(sent_messages.len(), 5);

    // 为每个请求发送响应
    for (i, message) in sent_messages.iter().enumerate() {
        let request_id = message["request_id"].as_str().unwrap().to_string();
        let response = HookResponse {
            request_id,
            status: "success".to_string(),
            data: Some(json!({ "processed": i })),
            error: None,
        };
        hook_manager.handle_response(response);
    }

    // 验证所有任务都成功完成
    for task in tasks {
        let (index, result) = task.await.unwrap();
        assert!(result.is_ok());
        let data = result.unwrap();
        assert_eq!(data["processed"], index);
    }
}

