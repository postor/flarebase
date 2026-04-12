/// 完整的 Hook 注册流程集成测试
///
/// 测试覆盖:
/// 1. Hook 客户端连接和注册
/// 2. 事件触发和 Hook 调用
/// 3. 响应处理和错误场景
/// 4. Hook 断开连接清理
/// 5. 多个 Hook 订阅同一事件
/// 6. 并发 Hook 注册/调用

use flare_server::hook_manager::HookManager;
use flare_protocol::{HookRegister, HookCapabilities, HookResponse};
use serde_json::json;
use std::sync::{Arc, Mutex};
use std::collections::HashMap;

/// 模拟的 WebSocket 连接管理器
struct MockWebSocketManager {
    /// socket_id -> 发送的消息队列
    sent_messages: Arc<Mutex<HashMap<String, Vec<serde_json::Value>>>>,
}

impl MockWebSocketManager {
    fn new() -> Self {
        Self {
            sent_messages: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// 模拟向指定 socket 发送消息
    fn emit_to_socket(&self, socket_id: String, message: serde_json::Value) {
        let mut messages = self.sent_messages.lock().unwrap();
        messages.entry(socket_id).or_default().push(message);
    }

    /// 获取发送给指定 socket 的所有消息
    fn get_messages(&self, socket_id: &str) -> Vec<serde_json::Value> {
        let messages = self.sent_messages.lock().unwrap();
        messages.get(socket_id).cloned().unwrap_or_default()
    }

    /// 清空指定 socket 的消息
    fn clear_messages(&self, socket_id: &str) {
        let mut messages = self.sent_messages.lock().unwrap();
        if let Some(msgs) = messages.get_mut(socket_id) {
            msgs.clear();
        }
    }
}

#[cfg(test)]
mod integration_tests {
    use super::*;

    #[tokio::test]
    async fn test_complete_hook_registration_and_call() {
        // 创建 HookManager 和 WebSocket 模拟器
        let hook_manager = Arc::new(HookManager::new());
        let ws_manager = Arc::new(MockWebSocketManager::new());

        // 1. 模拟 Hook 客户端连接
        let socket_id = "hook-client-1".to_string();

        // 2. Hook 客户端发送注册请求
        let register = HookRegister {
            token: "test-token-123".to_string(),
            capabilities: HookCapabilities {
                events: vec![
                    "UserCreated".to_string(),
                    "DocUpdated".to_string(),
                ],
                user_context: json!({
                    "service": "email-service",
                    "version": "1.0.0"
                }),
            },
        };

        // 3. 处理注册
        hook_manager.register_hook(socket_id.clone(), register);

        // 验证: Hook 已注册到事件中
        assert_eq!(hook_manager.get_hook_count("UserCreated"), 1);
        assert_eq!(hook_manager.get_hook_count("DocUpdated"), 1);
        let registered_hooks = hook_manager.get_hooks_for_event("UserCreated");
        assert_eq!(registered_hooks.len(), 1);
        assert_eq!(registered_hooks[0], socket_id);

        // 4. 模拟触发 UserCreated 事件 - 使用后台任务和通道同步
        let ws_manager_clone = ws_manager.clone();
        let hook_manager_clone = hook_manager.clone();
        let (tx, rx) = tokio::sync::oneshot::channel::<Result<serde_json::Value, anyhow::Error>>();

        let event_task = tokio::spawn(async move {
            let result = hook_manager_clone.call_hook(
                "UserCreated".to_string(),
                "session-123".to_string(),
                json!({
                    "user_id": "user-456",
                    "email": "test@example.com",
                    "name": "Test User"
                }),
                move |sid, data| {
                    // 模拟通过 WebSocket 发送请求给 Hook 客户端
                    ws_manager_clone.emit_to_socket(sid, data);
                },
            ).await;
            // 发送结果到主线程
            let _ = tx.send(result);
        });

        // 给异步任务一些时间来发送请求
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        // 验证: 请求已发送到 Hook 客户端
        let sent_requests = ws_manager.get_messages(&socket_id);
        assert_eq!(sent_requests.len(), 1);

        let request = &sent_requests[0];
        assert_eq!(request["event_name"], "UserCreated");
        assert_eq!(request["session_id"], "session-123");
        assert!(request["request_id"].is_string());
        assert_eq!(request["params"]["user_id"], "user-456");

        // 提取 request_id
        let request_id = request["request_id"].as_str().unwrap().to_string();

        // 5. Hook 客户端处理请求并返回响应
        let response = HookResponse {
            request_id: request_id.clone(),
            status: "success".to_string(),
            data: Some(json!({
                "email_sent": true,
                "message_id": "msg-789"
            })),
            error: None,
        };

        // 6. 处理响应
        hook_manager.handle_response(response);

        // 等待异步任务完成并获取结果
        let event_result = rx.await.unwrap();

        // 验证: 结果已返回
        if let Err(ref e) = event_result {
            eprintln!("Hook call failed with error: {}", e);
        }
        assert!(event_result.is_ok(), "Hook call should succeed");
        let result_data = event_result.unwrap();
        assert_eq!(result_data["email_sent"], true);
        assert_eq!(result_data["message_id"], "msg-789");
    }

    #[tokio::test]
    async fn test_hook_registration_multiple_events() {
        let hook_manager = HookManager::new();

        // 注册支持多个事件的 Hook
        let register = HookRegister {
            token: "multi-event-token".to_string(),
            capabilities: HookCapabilities {
                events: vec![
                    "UserCreated".to_string(),
                    "UserUpdated".to_string(),
                    "UserDeleted".to_string(),
                    "DocCreated".to_string(),
                ],
                user_context: json!({ "service": "audit-service" }),
            },
        };

        let socket_id = "audit-hook-1".to_string();
        hook_manager.register_hook(socket_id.clone(), register);

        // 验证: 所有事件都已注册
        assert_eq!(hook_manager.get_hook_count("UserCreated"), 1);
        assert_eq!(hook_manager.get_hook_count("UserUpdated"), 1);
        assert_eq!(hook_manager.get_hook_count("UserDeleted"), 1);
        assert_eq!(hook_manager.get_hook_count("DocCreated"), 1);

        // 验证: 每个事件都指向同一个 socket_id
        assert_eq!(hook_manager.get_hooks_for_event("UserCreated")[0], socket_id);
        assert_eq!(hook_manager.get_hooks_for_event("UserUpdated")[0], socket_id);
        assert_eq!(hook_manager.get_hooks_for_event("UserDeleted")[0], socket_id);
        assert_eq!(hook_manager.get_hooks_for_event("DocCreated")[0], socket_id);
    }

    #[tokio::test]
    async fn test_hook_error_handling() {
        let hook_manager = Arc::new(HookManager::new());
        let ws_manager = Arc::new(MockWebSocketManager::new());

        // 注册 Hook
        let register = HookRegister {
            token: "error-test-token".to_string(),
            capabilities: HookCapabilities {
                events: vec!["UserCreated".to_string()],
                user_context: json!({}),
            },
        };
        let socket_id = "hook-error-test".to_string();
        hook_manager.register_hook(socket_id.clone(), register);

        // 触发事件 - 使用后台任务和通道同步
        let ws_manager_clone = ws_manager.clone();
        let hook_manager_clone = hook_manager.clone();
        let (tx, rx) = tokio::sync::oneshot::channel::<Result<serde_json::Value, anyhow::Error>>();

        let _event_task = tokio::spawn(async move {
            let result = hook_manager_clone.call_hook(
                "UserCreated".to_string(),
                "session-error".to_string(),
                json!({ "user_id": "invalid" }),
                move |sid, data| {
                    ws_manager_clone.emit_to_socket(sid, data);
                },
            ).await;
            let _ = tx.send(result);
        });

        // 给异步任务一些时间来发送请求
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        // 获取请求的 request_id
        let sent_requests = ws_manager.get_messages(&socket_id);
        assert!(!sent_requests.is_empty(), "No requests were sent");
        let request_id = sent_requests[0]["request_id"].as_str().unwrap().to_string();

        // Hook 返回错误响应
        let error_response = HookResponse {
            request_id,
            status: "error".to_string(),
            data: None,
            error: Some(json!({
                "code": "INVALID_USER",
                "message": "Invalid user data provided"
            })),
        };

        hook_manager.handle_response(error_response);

        // 等待异步任务完成并获取结果
        let event_result = rx.await.unwrap();

        // 验证: 调用成功但返回错误数据
        assert!(event_result.is_ok());
        let result = event_result.unwrap();
        assert!(result["error"].is_object());
        assert_eq!(result["error"]["code"], "INVALID_USER");
        assert_eq!(result["error"]["message"], "Invalid user data provided");
    }

    #[tokio::test]
    async fn test_hook_timeout() {
        let hook_manager = HookManager::new();
        let ws_manager = Arc::new(MockWebSocketManager::new());

        // 注册 Hook
        let register = HookRegister {
            token: "timeout-token".to_string(),
            capabilities: HookCapabilities {
                events: vec!["DocCreated".to_string()],
                user_context: json!({}),
            },
        };
        let socket_id = "slow-hook".to_string();
        hook_manager.register_hook(socket_id.clone(), register);

        // 模拟超时的 Hook 调用 (不发送响应)
        let ws_manager_clone = ws_manager.clone();
        let result: Result<Result<serde_json::Value, anyhow::Error>, tokio::time::error::Elapsed> = tokio::time::timeout(
            tokio::time::Duration::from_millis(100), // 使用较短的超时时间
            hook_manager.call_hook(
                "DocCreated".to_string(),
                "session-timeout".to_string(),
                json!({ "doc_id": "123" }),
                move |sid, data| {
                    ws_manager_clone.emit_to_socket(sid, data);
                    // 故意不发送响应，模拟超时
                },
            )
        ).await;

        // 验证: 发生超时
        assert!(result.is_err());

        // 清理: 移除 Hook
        hook_manager.remove_hook(&socket_id);
    }

    #[tokio::test]
    async fn test_multiple_hooks_same_event() {
        let hook_manager = HookManager::new();
        let ws_manager = Arc::new(MockWebSocketManager::new());

        // 注册多个 Hook 订阅同一事件
        let hooks = vec![
            ("hook-1", "token-1"),
            ("hook-2", "token-2"),
            ("hook-3", "token-3"),
        ];

        for (sid, token) in &hooks {
            let register = HookRegister {
                token: token.to_string(),
                capabilities: HookCapabilities {
                    events: vec!["UserCreated".to_string()],
                    user_context: json!({}),
                },
            };
            hook_manager.register_hook(sid.to_string(), register);
        }

        // 验证: 所有 Hook 都已注册
        assert_eq!(hook_manager.get_hook_count("UserCreated"), 3);

        // 触发事件 - 注意: 当前实现使用 round-robin，只会调用第一个 Hook
        let ws_manager_clone = ws_manager.clone();
        let hook_manager_clone = hook_manager.clone();

        let _ = hook_manager_clone.call_hook(
            "UserCreated".to_string(),
            "session-multi".to_string(),
            json!({ "user_id": "user-123" }),
            move |sid, data| {
                ws_manager_clone.emit_to_socket(sid, data);
            },
        ).await;

        // 验证: 只有第一个 Hook 收到请求 (当前实现的行为)
        let messages_hook1 = ws_manager.get_messages("hook-1");
        let messages_hook2 = ws_manager.get_messages("hook-2");
        let messages_hook3 = ws_manager.get_messages("hook-3");

        assert_eq!(messages_hook1.len(), 1); // hook-1 收到
        assert_eq!(messages_hook2.len(), 0); // hook-2 未收到
        assert_eq!(messages_hook3.len(), 0); // hook-3 未收到
    }

    #[tokio::test]
    async fn test_hook_disconnection_cleanup() {
        let hook_manager = HookManager::new();

        // 注册多个 Hook
        let register1 = HookRegister {
            token: "token-1".to_string(),
            capabilities: HookCapabilities {
                events: vec!["Event1".to_string()],
                user_context: json!({}),
            },
        };
        let register2 = HookRegister {
            token: "token-2".to_string(),
            capabilities: HookCapabilities {
                events: vec!["Event1".to_string(), "Event2".to_string()],
                user_context: json!({}),
            },
        };

        hook_manager.register_hook("socket-1".to_string(), register1);
        hook_manager.register_hook("socket-2".to_string(), register2);

        // 验证初始状态
        assert_eq!(hook_manager.get_hook_count("Event1"), 2);
        assert_eq!(hook_manager.get_hook_count("Event2"), 1);

        // 移除 socket-1
        hook_manager.remove_hook("socket-1");

        // 验证: socket-1 已从所有事件中移除
        assert_eq!(hook_manager.get_hook_count("Event1"), 1);
        assert_eq!(hook_manager.get_hooks_for_event("Event1")[0], "socket-2");
        assert_eq!(hook_manager.get_hook_count("Event2"), 1);

        // 移除 socket-2
        hook_manager.remove_hook("socket-2");

        // 验证: socket-2 也已移除
        assert_eq!(hook_manager.get_hook_count("Event1"), 0);
        assert_eq!(hook_manager.get_hook_count("Event2"), 0);
    }

    #[tokio::test]
    async fn test_hook_call_with_no_registered_hooks() {
        let hook_manager = HookManager::new();
        let ws_manager = Arc::new(MockWebSocketManager::new());

        // 尝试调用未注册的事件
        let ws_manager_clone = ws_manager.clone();
        let result: Result<serde_json::Value, anyhow::Error> = hook_manager.call_hook(
            "NonExistentEvent".to_string(),
            "session-000".to_string(),
            json!({ "test": true }),
            move |sid, data| {
                ws_manager_clone.emit_to_socket(sid, data);
            },
        ).await;

        // 验证: 返回错误
        assert!(result.is_err());
        let error_msg = result.unwrap_err().to_string();
        assert!(error_msg.contains("No hook registered"));
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
                let result: Result<serde_json::Value, anyhow::Error> = hm.call_hook(
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

        // 等待所有异步任务发送请求
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

        // 验证: 所有调用都已发送
        let sent_messages = ws_manager.get_messages(&socket_id);
        assert_eq!(sent_messages.len(), 5);

        // 为每个请求发送响应
        for (i, message) in sent_messages.iter().enumerate() {
            let request_id = message["request_id"].as_str().unwrap().to_string();
            let response = HookResponse {
                request_id,
                status: "success".to_string(),
                data: Some(json!({ "processed_index": i })),
                error: None,
            };
            hook_manager.handle_response(response);
        }

        // 等待所有任务完成并验证
        for task in tasks {
            let (index, result) = task.await.unwrap();
            assert!(result.is_ok());
            let data = result.unwrap();
            assert_eq!(data["processed_index"], index);
        }
    }
}
