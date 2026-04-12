/// Hook 增强测试 - 添加详细验证点和调试信息
///
/// 测试覆盖:
/// 1. 详细的 Hook 注册流程验证
/// 2. 请求-响应关联验证
/// 3. 并发场景下的竞态条件检测
/// 4. 边界条件和异常情况

use flare_server::hook_manager::HookManager;
use flare_protocol::{HookRegister, HookCapabilities, HookResponse};
use serde_json::json;
use std::sync::{Arc, Mutex};
use std::collections::HashMap;

/// 增强的模拟 WebSocket 管理器，支持更多验证
struct EnhancedMockWebSocketManager {
    sent_messages: Arc<Mutex<HashMap<String, Vec<serde_json::Value>>>>,
    message_count: Arc<Mutex<HashMap<String, usize>>>,
}

impl EnhancedMockWebSocketManager {
    fn new() -> Self {
        Self {
            sent_messages: Arc::new(Mutex::new(HashMap::new())),
            message_count: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn emit_to_socket(&self, socket_id: String, message: serde_json::Value) {
        let mut messages = self.sent_messages.lock().unwrap();
        let mut count = self.message_count.lock().unwrap();

        messages.entry(socket_id.clone()).or_default().push(message);
        *count.entry(socket_id).or_insert(0) += 1;
    }

    fn get_messages(&self, socket_id: &str) -> Vec<serde_json::Value> {
        let messages = self.sent_messages.lock().unwrap();
        messages.get(socket_id).cloned().unwrap_or_default()
    }

    fn get_message_count(&self, socket_id: &str) -> usize {
        let count = self.message_count.lock().unwrap();
        *count.get(socket_id).unwrap_or(&0)
    }

    fn verify_request_structure(&self, socket_id: &str, index: usize) -> Result<(), String> {
        let messages = self.get_messages(socket_id);
        if index >= messages.len() {
            return Err(format!("Message index {} out of bounds (len: {})", index, messages.len()));
        }

        let msg = &messages[index];
        let required_fields = vec!["request_id", "event_name", "session_id", "params"];

        for field in &required_fields {
            if msg.get(field).is_none() {
                return Err(format!("Missing required field: {}", field));
            }
        }

        if !msg["request_id"].is_string() {
            return Err("request_id must be a string".to_string());
        }

        Ok(())
    }

    fn extract_request_id(&self, socket_id: &str, index: usize) -> Result<String, String> {
        let messages = self.get_messages(socket_id);
        if index >= messages.len() {
            return Err(format!("Message index {} out of bounds", index));
        }
        messages[index]["request_id"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or("request_id is not a string".to_string())
    }
}

#[cfg(test)]
mod enhanced_tests {
    use super::*;

    #[tokio::test]
    async fn test_detailed_registration_and_call_flow() {
        println!("\n=== 开始详细注册和调用流程测试 ===\n");

        let hook_manager = Arc::new(HookManager::new());
        let ws_manager = Arc::new(EnhancedMockWebSocketManager::new());
        let socket_id = "test-hook-detailed-1".to_string();

        // 步骤 1: 注册前验证
        println!("步骤 1: 验证注册前状态");
        assert_eq!(hook_manager.get_hook_count("UserCreated"), 0,
            "UserCreated 事件应该没有注册的 Hook");
        println!("✓ 注册前验证通过: UserCreated hook count = 0");

        // 步骤 2: 执行注册
        println!("\n步骤 2: 执行 Hook 注册");
        let register = HookRegister {
            token: "detailed-test-token".to_string(),
            capabilities: HookCapabilities {
                events: vec![
                    "UserCreated".to_string(),
                    "DocUpdated".to_string(),
                ],
                user_context: json!({
                    "service": "test-service",
                    "version": "2.0.0"
                }),
            },
        };
        hook_manager.register_hook(socket_id.clone(), register);
        println!("✓ Hook 注册完成: {}", socket_id);

        // 步骤 3: 注册后验证
        println!("\n步骤 3: 验证注册后状态");
        assert_eq!(hook_manager.get_hook_count("UserCreated"), 1,
            "UserCreated 应该有 1 个 Hook");
        assert_eq!(hook_manager.get_hook_count("DocUpdated"), 1,
            "DocUpdated 应该有 1 个 Hook");

        let hooks = hook_manager.get_hooks_for_event("UserCreated");
        assert_eq!(hooks.len(), 1, "应该返回 1 个 Hook");
        assert_eq!(hooks[0], socket_id, "Hook socket ID 应该匹配");
        println!("✓ 注册后验证通过");

        // 步骤 4: 发起 Hook 调用
        println!("\n步骤 4: 发起 Hook 调用");
        let ws_manager_clone = ws_manager.clone();
        let hook_manager_clone = hook_manager.clone();
        let (tx, rx) = tokio::sync::oneshot::channel();

        tokio::spawn(async move {
            let result = hook_manager_clone.call_hook(
                "UserCreated".to_string(),
                "test-session-1".to_string(),
                json!({
                    "user_id": "user-001",
                    "email": "test@example.com",
                    "name": "Test User"
                }),
                move |sid, data| {
                    ws_manager_clone.emit_to_socket(sid, data);
                },
            ).await;
            let _ = tx.send(result);
        });

        // 步骤 5: 等待请求发送
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        println!("✓ Hook 调用已发起");

        // 步骤 6: 验证请求已发送
        println!("\n步骤 6: 验证请求已发送到 WebSocket");
        let msg_count = ws_manager.get_message_count(&socket_id);
        assert_eq!(msg_count, 1, "应该发送 1 条消息");
        println!("✓ 消息计数验证通过: {}", msg_count);

        // 步骤 7: 验证请求结构
        println!("\n步骤 7: 验证请求结构");
        ws_manager.verify_request_structure(&socket_id, 0)
            .expect("请求结构验证失败");
        println!("✓ 请求结构验证通过");

        // 步骤 8: 提取 request_id
        println!("\n步骤 8: 提取 request_id");
        let request_id = ws_manager.extract_request_id(&socket_id, 0)
            .expect("无法提取 request_id");
        println!("✓ request_id: {}", request_id);

        // 步骤 9: 发送响应
        println!("\n步骤 9: 发送 Hook 响应");
        let response = HookResponse {
            request_id: request_id.clone(),
            status: "success".to_string(),
            data: Some(json!({
                "processed": true,
                "timestamp": chrono::Utc::now().to_rfc3339()
            })),
            error: None,
        };
        hook_manager.handle_response(response);
        println!("✓ Hook 响应已发送");

        // 步骤 10: 等待并验证结果
        println!("\n步骤 10: 等待并验证最终结果");
        let result = rx.await.unwrap();
        assert!(result.is_ok(), "Hook 调用应该成功");
        let result_data = result.unwrap();
        assert_eq!(result_data["processed"], true);
        println!("✓ 最终结果验证通过");
        println!("✓ 结果数据: {:?}", result_data);

        println!("\n=== 测试完成 ===\n");
    }

    #[tokio::test]
    async fn test_concurrent_requests_with_detailed_verification() {
        println!("\n=== 开始并发请求详细测试 ===\n");

        let hook_manager = Arc::new(HookManager::new());
        let ws_manager = Arc::new(EnhancedMockWebSocketManager::new());
        let socket_id = "concurrent-test-hook".to_string();

        // 注册 Hook
        let register = HookRegister {
            token: "concurrent-token".to_string(),
            capabilities: HookCapabilities {
                events: vec!["ConcurrentEvent".to_string()],
                user_context: json!({}),
            },
        };
        hook_manager.register_hook(socket_id.clone(), register);
        println!("✓ Hook 已注册");

        // 并发发起多个调用
        const NUM_REQUESTS: usize = 10;
        let mut tasks = Vec::new();
        let mut request_indices = Vec::new();

        println!("\n发起 {} 个并发请求...", NUM_REQUESTS);
        for i in 0..NUM_REQUESTS {
            let hm = hook_manager.clone();
            let wm = ws_manager.clone();
            request_indices.push(i);

            let task = tokio::spawn(async move {
                let result = hm.call_hook(
                    "ConcurrentEvent".to_string(),
                    format!("session-{}", i),
                    json!({
                        "index": i,
                        "data": format!("request-{}", i)
                    }),
                    move |sid, data| {
                        wm.emit_to_socket(sid, data);
                    },
                ).await;
                (i, result)
            });
            tasks.push(task);
        }

        // 等待所有请求发送
        tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;

        // 验证所有请求都已发送
        println!("\n验证请求发送情况:");
        let msg_count = ws_manager.get_message_count(&socket_id);
        println!("  期望消息数: {}", NUM_REQUESTS);
        println!("  实际消息数: {}", msg_count);
        assert_eq!(msg_count, NUM_REQUESTS, "所有请求都应该被发送");

        // 验证每个请求的结构
        println!("\n验证每个请求的结构:");
        for i in 0..NUM_REQUESTS {
            match ws_manager.verify_request_structure(&socket_id, i) {
                Ok(_) => println!("  ✓ 请求 {} 结构验证通过", i),
                Err(e) => panic!("请求 {} 结构验证失败: {}", i, e),
            }

            // 验证 session_id 正确
            let messages = ws_manager.get_messages(&socket_id);
            let session_id = messages[i]["session_id"].as_str().unwrap();
            let expected_session = format!("session-{}", i);
            assert_eq!(session_id, expected_session,
                "请求 {} 的 session_id 应该匹配", i);
            println!("  ✓ 请求 {} session_id 正确: {}", i, session_id);
        }

        // 为每个请求发送响应
        println!("\n发送响应...");
        for i in 0..NUM_REQUESTS {
            let request_id = ws_manager.extract_request_id(&socket_id, i)
                .expect(&format!("无法提取请求 {} 的 request_id", i));

            let response = HookResponse {
                request_id,
                status: "success".to_string(),
                data: Some(json!({
                    "processed_index": i,
                    "timestamp": chrono::Utc::now().to_rfc3339()
                })),
                error: None,
            };
            hook_manager.handle_response(response);
        }

        // 等待所有任务完成并验证
        println!("\n验证最终结果:");
        let mut successful_count = 0;
        for task in tasks {
            let (index, result) = task.await.unwrap();
            match result {
                Ok(data) => {
                    assert_eq!(data["processed_index"], index,
                        "响应的索引应该匹配");
                    successful_count += 1;
                    println!("  ✓ 请求 {} 成功处理", index);
                },
                Err(e) => {
                    panic!("请求 {} 失败: {}", index, e);
                }
            }
        }

        assert_eq!(successful_count, NUM_REQUESTS,
            "所有请求都应该成功处理");

        println!("\n✓ 所有 {} 个并发请求测试通过", NUM_REQUESTS);
        println!("\n=== 测试完成 ===\n");
    }

    #[tokio::test]
    async fn test_error_response_with_validation() {
        println!("\n=== 开始错误响应验证测试 ===\n");

        let hook_manager = Arc::new(HookManager::new());
        let ws_manager = Arc::new(EnhancedMockWebSocketManager::new());
        let socket_id = "error-test-hook".to_string();

        // 注册 Hook
        let register = HookRegister {
            token: "error-token".to_string(),
            capabilities: HookCapabilities {
                events: vec!["ErrorEvent".to_string()],
                user_context: json!({}),
            },
        };
        hook_manager.register_hook(socket_id.clone(), register);
        println!("✓ Hook 已注册");

        // 发起调用
        let ws_manager_clone = ws_manager.clone();
        let hook_manager_clone = hook_manager.clone();
        let (tx, rx) = tokio::sync::oneshot::channel();

        tokio::spawn(async move {
            let result = hook_manager_clone.call_hook(
                "ErrorEvent".to_string(),
                "error-session".to_string(),
                json!({ "test": "error" }),
                move |sid, data| {
                    ws_manager_clone.emit_to_socket(sid, data);
                },
            ).await;
            let _ = tx.send(result);
        });

        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        // 获取 request_id
        let request_id = ws_manager.extract_request_id(&socket_id, 0)
            .expect("无法提取 request_id");
        println!("✓ request_id: {}", request_id);

        // 发送错误响应
        println!("\n发送错误响应:");
        let error_response = HookResponse {
            request_id,
            status: "error".to_string(),
            data: None,
            error: Some(json!({
                "code": "TEST_ERROR",
                "message": "This is a test error",
                "details": {
                    "field": "test_field",
                    "value": "invalid"
                }
            })),
        };
        hook_manager.handle_response(error_response);
        println!("✓ 错误响应已发送");

        // 验证结果包含错误信息
        println!("\n验证错误响应:");
        let result = rx.await.unwrap();
        assert!(result.is_ok(), "应该返回结果（包含错误）");
        let data = result.unwrap();

        assert!(data.get("error").is_some(), "应该包含 error 字段");
        assert_eq!(data["error"]["code"], "TEST_ERROR");
        assert_eq!(data["error"]["message"], "This is a test error");
        assert_eq!(data["error"]["details"]["field"], "test_field");

        println!("✓ 错误响应验证通过");
        println!("  错误码: {}", data["error"]["code"]);
        println!("  错误信息: {}", data["error"]["message"]);

        println!("\n=== 测试完成 ===\n");
    }

    #[tokio::test]
    async fn test_multiple_hooks_same_event_with_distribution() {
        println!("\n=== 开始多 Hook 同事件分布测试 ===\n");

        let hook_manager = HookManager::new();
        let ws_manager = Arc::new(EnhancedMockWebSocketManager::new());

        // 注册多个 Hook
        let hooks = vec![
            ("hook-1", "token-1"),
            ("hook-2", "token-2"),
            ("hook-3", "token-3"),
        ];

        println!("注册 {} 个 Hook 到同一事件:", hooks.len());
        for (sid, token) in &hooks {
            let register = HookRegister {
                token: token.to_string(),
                capabilities: HookCapabilities {
                    events: vec!["SharedEvent".to_string()],
                    user_context: json!({}),
                },
            };
            hook_manager.register_hook(sid.to_string(), register);
            println!("  ✓ Hook {} 已注册", sid);
        }

        // 验证所有 Hook 都已注册
        assert_eq!(hook_manager.get_hook_count("SharedEvent"), 3);
        println!("\n✓ 所有 Hook 已注册到 SharedEvent");

        // 发起多次调用，观察分布
        const NUM_CALLS: usize = 10;
        println!("\n发起 {} 次调用，观察 Hook 分布:", NUM_CALLS);

        let mut call_distribution: HashMap<String, usize> = HashMap::new();

        for i in 0..NUM_CALLS {
            let ws_manager_clone = ws_manager.clone();
            let hook_manager_clone = hook_manager.clone();

            let _ = hook_manager_clone.call_hook(
                "SharedEvent".to_string(),
                format!("session-{}", i),
                json!({ "call_index": i }),
                move |sid, data| {
                    ws_manager_clone.emit_to_socket(sid, data);
                },
            ).await;

            // 检查哪个 Hook 收到了请求
            for (sid, _) in &hooks {
                let count = ws_manager.get_message_count(sid);
                if count > i {
                    *call_distribution.entry(sid.to_string()).or_insert(0) += 1;
                }
            }
        }

        // 打印分布情况
        println!("\n调用分布统计:");
        for (sid, token) in &hooks {
            let count = call_distribution.get(*sid).unwrap_or(&0);
            println!("  {} ({}): {} 次调用", sid, token, count);
        }

        // 当前实现使用 round-robin 的第一个，所以所有调用都应该去 hook-1
        let hook1_count = call_distribution.get("hook-1").unwrap_or(&0);
        assert_eq!(*hook1_count, NUM_CALLS,
            "当前实现所有调用都应该路由到第一个 Hook");
        println!("\n✓ Round-robin 行为验证通过");

        println!("\n=== 测试完成 ===\n");
    }

    #[tokio::test]
    async fn test_hook_removal_with_verification() {
        println!("\n=== 开始 Hook 移除验证测试 ===\n");

        let hook_manager = HookManager::new();

        // 注册多个 Hook 到多个事件
        println!("注册 Hook 到不同事件:");

        let register1 = HookRegister {
            token: "token-1".to_string(),
            capabilities: HookCapabilities {
                events: vec!["Event1".to_string(), "Event2".to_string()],
                user_context: json!({}),
            },
        };
        hook_manager.register_hook("socket-1".to_string(), register1);
        println!("  ✓ socket-1: Event1, Event2");

        let register2 = HookRegister {
            token: "token-2".to_string(),
            capabilities: HookCapabilities {
                events: vec!["Event1".to_string(), "Event2".to_string(), "Event3".to_string()],
                user_context: json!({}),
            },
        };
        hook_manager.register_hook("socket-2".to_string(), register2);
        println!("  ✓ socket-2: Event1, Event2, Event3");

        // 初始状态验证
        println!("\n初始状态:");
        assert_eq!(hook_manager.get_hook_count("Event1"), 2);
        assert_eq!(hook_manager.get_hook_count("Event2"), 2);
        assert_eq!(hook_manager.get_hook_count("Event3"), 1);
        println!("  Event1: {} hooks", hook_manager.get_hook_count("Event1"));
        println!("  Event2: {} hooks", hook_manager.get_hook_count("Event2"));
        println!("  Event3: {} hooks", hook_manager.get_hook_count("Event3"));

        // 移除 socket-1
        println!("\n移除 socket-1:");
        hook_manager.remove_hook("socket-1");
        assert_eq!(hook_manager.get_hook_count("Event1"), 1);
        assert_eq!(hook_manager.get_hook_count("Event2"), 1);
        assert_eq!(hook_manager.get_hook_count("Event3"), 1); // 未改变

        // 验证 socket-2 仍在所有事件中
        let event1_hooks = hook_manager.get_hooks_for_event("Event1");
        let event2_hooks = hook_manager.get_hooks_for_event("Event2");
        let event3_hooks = hook_manager.get_hooks_for_event("Event3");

        assert_eq!(event1_hooks.len(), 1);
        assert_eq!(event2_hooks.len(), 1);
        assert_eq!(event3_hooks.len(), 1);
        assert_eq!(event1_hooks[0], "socket-2");
        assert_eq!(event2_hooks[0], "socket-2");
        assert_eq!(event3_hooks[0], "socket-2");
        println!("  ✓ socket-1 已从所有事件中移除");
        println!("  Event1: {} hooks (socket-2)", hook_manager.get_hook_count("Event1"));
        println!("  Event2: {} hooks (socket-2)", hook_manager.get_hook_count("Event2"));
        println!("  Event3: {} hooks (socket-2)", hook_manager.get_hook_count("Event3"));

        // 移除 socket-2
        println!("\n移除 socket-2:");
        hook_manager.remove_hook("socket-2");
        assert_eq!(hook_manager.get_hook_count("Event1"), 0);
        assert_eq!(hook_manager.get_hook_count("Event2"), 0);
        assert_eq!(hook_manager.get_hook_count("Event3"), 0);
        println!("  ✓ socket-2 已从所有事件中移除");
        println!("  所有事件 hook 数: 0");

        println!("\n=== 测试完成 ===\n");
    }

    #[tokio::test]
    async fn test_no_hook_registered_error() {
        println!("\n=== 开始未注册事件错误测试 ===\n");

        let hook_manager = HookManager::new();
        let ws_manager = Arc::new(EnhancedMockWebSocketManager::new());

        println!("尝试调用未注册的事件:");
        let ws_manager_clone = ws_manager.clone();
        let result = hook_manager.call_hook(
            "NonExistentEvent".to_string(),
            "test-session".to_string(),
            json!({ "test": true }),
            move |sid, data| {
                ws_manager_clone.emit_to_socket(sid, data);
            },
        ).await;

        assert!(result.is_err(), "应该返回错误");
        let error_msg = result.unwrap_err().to_string();
        println!("✓ 错误返回: {}", error_msg);
        assert!(error_msg.contains("No hook registered"),
            "错误消息应该包含 'No hook registered'");

        // 验证没有消息被发送
        let msg_count = ws_manager.get_message_count("any-socket");
        assert_eq!(msg_count, 0, "不应该发送任何消息");

        println!("\n=== 测试完成 ===\n");
    }
}
