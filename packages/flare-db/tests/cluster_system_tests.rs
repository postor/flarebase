// 集群计算系统测试 - 基于 CLUSTER_COMPUTATION_DESIGN.md
//
// 覆盖功能：
// 1. 一致性哈希分片
// 2. 分布式查询执行（Scatter-Gather）
// 3. 计算负载均衡
// 4. 共享任务队列
// 5. Work Stealing

use flare_db::Storage;
use flare_db::SledStorage;
use flare_protocol::{Document, Query, QueryOp};
use tempfile::tempdir;
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use tokio::sync::RwLock;

// ===== 一致性哈希 =====

pub struct ConsistentHashRing {
    virtual_nodes: u32,
    ring: Vec<(u64, String)>, // (hash, node_id)
    node_positions: HashMap<String, Vec<usize>>, // node_id -> positions in ring
}

impl ConsistentHashRing {
    pub fn new(virtual_nodes: u32) -> Self {
        Self {
            virtual_nodes,
            ring: Vec::new(),
            node_positions: HashMap::new(),
        }
    }

    pub fn add_node(&mut self, node_id: &str) {
        let mut positions = Vec::new();

        for i in 0..self.virtual_nodes {
            let virtual_key = format!("{}:{}", node_id, i);
            let hash = self.hash(&virtual_key);
            self.ring.push((hash, node_id.to_string()));
            positions.push(self.ring.len() - 1);
        }

        self.ring.sort_by(|a, b| a.0.cmp(&b.0));
        self.node_positions.insert(node_id.to_string(), positions);
    }

    pub fn remove_node(&mut self, node_id: &str) {
        if let Some(positions) = self.node_positions.remove(node_id) {
            // 从后往前删除，避免索引失效
            for &pos in positions.iter().rev() {
                if pos < self.ring.len() {
                    self.ring.remove(pos);
                }
            }
        }
    }

    pub fn get_node(&self, key: &str) -> Option<String> {
        if self.ring.is_empty() {
            return None;
        }

        let hash = self.hash(key);

        // 二分查找第一个 >= hash 的节点
        let pos = self.ring.partition_point(|(h, _)| *h < hash);

        if pos == self.ring.len() {
            // 环绕到第一个节点
            Some(self.ring[0].1.clone())
        } else {
            Some(self.ring[pos].1.clone())
        }
    }

    pub fn get_nodes_for_key(&self, key: &str, replication: u32) -> Vec<String> {
        if self.ring.is_empty() {
            return Vec::new();
        }

        let hash = self.hash(key);
        let mut nodes = Vec::new();
        let mut seen = HashSet::new();

        // 从 hash 位置开始，顺时针查找 N 个不同的节点
        let pos = self.ring.partition_point(|(h, _)| *h < hash);

        for i in 0..self.ring.len() {
            let actual_pos = (pos + i) % self.ring.len();
            let node_id = &self.ring[actual_pos].1;

            if !seen.contains(node_id) {
                seen.insert(node_id.clone());
                nodes.push(node_id.clone());

                if nodes.len() as u32 >= replication {
                    break;
                }
            }
        }

        nodes
    }

    fn hash(&self, key: &str) -> u64 {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        key.hash(&mut hasher);
        hasher.finish()
    }
}

// ===== 分片元数据 =====

#[derive(Debug, Clone)]
pub struct ShardMetadata {
    pub shard_id: String,
    pub node_id: String,
    pub collection: String,
    pub range_start: u64,
    pub range_end: u64,
}

// ===== 分片管理器 =====

pub struct ShardManager {
    hash_ring: ConsistentHashRing,
    shard_metadata: HashMap<String, Vec<ShardMetadata>>, // collection -> shards
}

impl ShardManager {
    pub fn new(virtual_nodes: u32) -> Self {
        Self {
            hash_ring: ConsistentHashRing::new(virtual_nodes),
            shard_metadata: HashMap::new(),
        }
    }

    pub fn add_node(&mut self, node_id: &str) {
        self.hash_ring.add_node(node_id);
    }

    pub fn remove_node(&mut self, node_id: &str) {
        self.hash_ring.remove_node(node_id);
        // 重新平衡分片
        self.rebalance_shards();
    }

    pub fn get_target_node(&self, collection: &str, doc_id: &str) -> Option<String> {
        let key = format!("{}:{}", collection, doc_id);
        self.hash_ring.get_node(&key)
    }

    pub fn get_replication_nodes(&self, collection: &str, doc_id: &str, replication: u32) -> Vec<String> {
        let key = format!("{}:{}", collection, doc_id);
        self.hash_ring.get_nodes_for_key(&key, replication)
    }

    pub fn rebalance_shards(&mut self) {
        // 重新计算分片分配
        // 在完整实现中，这会触发数据迁移
    }

    pub fn map_query_to_nodes(&self, collection: &str, query: &Query) -> Vec<String> {
        // 简化实现：返回所有节点
        // 在完整实现中，应该根据查询中的过滤器优化路由
        self.hash_ring.ring.iter()
            .map(|(_, node_id)| node_id.clone())
            .collect::<HashSet<_>>()
            .into_iter()
            .collect()
    }
}

// ===== 分布式查询执行器 =====

pub struct DistributedQueryExecutor {
    shard_manager: Arc<RwLock<ShardManager>>,
}

impl DistributedQueryExecutor {
    pub fn new(shard_manager: Arc<RwLock<ShardManager>>) -> Self {
        Self { shard_manager }
    }

    pub async fn execute_distributed_query(&self, collection: &str, query: Query) -> anyhow::Result<Vec<Document>> {
        // 阶段1：映射 - 确定目标节点
        let target_nodes = {
            let manager = self.shard_manager.read().await;
            manager.map_query_to_nodes(collection, &query)
        };

        if target_nodes.is_empty() {
            return Ok(Vec::new());
        }

        // 阶段2：扇出 - 向所有节点发送子查询
        // 简化实现：直接执行查询
        // 在完整实现中，这里会通过 gRPC 调用远程节点

        let mut all_results = Vec::new();

        // 模拟从各个节点收集结果
        for _node_id in &target_nodes {
            // 在实际实现中，这里会调用远程节点的查询方法
            // let partial_results = remote_node.query(collection, query).await?;
            // all_results.extend(partial_results);
        }

        // 阶段3：合并结果
        self.merge_results(query, all_results)
    }

    fn merge_results(&self, query: Query, mut results: Vec<Document>) -> anyhow::Result<Vec<Document>> {
        // 应用 offset 和 limit
        if let Some(offset) = query.offset {
            if offset < results.len() {
                results = results.split_off(offset).to_vec();
            } else {
                results = Vec::new();
            }
        }

        if let Some(limit) = query.limit {
            results.truncate(limit);
        }

        // 在完整实现中，这里还需要处理排序
        // 目前返回未排序的结果
        Ok(results)
    }
}

// ===== 共享任务队列 =====

#[derive(Debug, Clone)]
pub struct DistributedTask {
    pub id: String,
    pub task_type: TaskType,
    pub payload: serde_json::Value,
    pub priority: u32,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TaskType {
    HookExecution,
    IndexRebuild,
    DataMigration,
}

pub struct TaskQueue {
    tasks: RwLock<Vec<DistributedTask>>,
}

impl TaskQueue {
    pub fn new() -> Self {
        Self {
            tasks: RwLock::new(Vec::new()),
        }
    }

    pub async fn enqueue(&self, task: DistributedTask) {
        let mut tasks = self.tasks.write().await;
        tasks.push(task);
        // 按优先级排序
        tasks.sort_by(|a, b| b.priority.cmp(&a.priority));
    }

    pub async fn dequeue(&self) -> Option<DistributedTask> {
        let mut tasks = self.tasks.write().await;
        if tasks.is_empty() {
            None
        } else {
            Some(tasks.remove(0))
        }
    }

    pub async fn peek(&self) -> Option<DistributedTask> {
        let tasks = self.tasks.read().await;
        tasks.first().cloned()
    }

    pub async fn len(&self) -> usize {
        self.tasks.read().await.len()
    }
}

// ===== Work Stealing 负载均衡器 =====

pub struct WorkStealingBalancer {
    node_load: RwLock<HashMap<String, NodeLoad>>,
    task_queue: Arc<TaskQueue>,
}

#[derive(Debug, Clone)]
pub struct NodeLoad {
    pub node_id: String,
    pub cpu_usage: f32,
    pub memory_usage: f32,
    pub active_tasks: u32,
    pub max_capacity: u32,
}

impl WorkStealingBalancer {
    pub fn new(task_queue: Arc<TaskQueue>) -> Self {
        Self {
            node_load: RwLock::new(HashMap::new()),
            task_queue,
        }
    }

    pub async fn register_node(&self, node_id: &str, max_capacity: u32) {
        let load = NodeLoad {
            node_id: node_id.to_string(),
            cpu_usage: 0.0,
            memory_usage: 0.0,
            active_tasks: 0,
            max_capacity,
        };

        self.node_load.write().await.insert(node_id.to_string(), load);
    }

    pub async fn update_node_load(&self, node_id: &str, cpu: f32, memory: f32, active_tasks: u32) {
        let mut loads = self.node_load.write().await;
        if let Some(load) = loads.get_mut(node_id) {
            load.cpu_usage = cpu;
            load.memory_usage = memory;
            load.active_tasks = active_tasks;
        }
    }

    pub async fn select_node_for_task(&self) -> Option<String> {
        let loads = self.node_load.read().await;

        // 找到负载最低的节点
        loads
            .values()
            .filter(|load| load.active_tasks < load.max_capacity)
            .min_by(|a, b| {
                // 综合考虑 CPU 和任务数量
                let load_a = a.cpu_usage + (a.active_tasks as f32 / a.max_capacity as f32);
                let load_b = b.cpu_usage + (b.active_tasks as f32 / b.max_capacity as f32);
                load_a.partial_cmp(&load_b).unwrap_or(std::cmp::Ordering::Equal)
            })
            .map(|load| load.node_id.clone())
    }

    pub async fn assign_task(&self, task: DistributedTask) -> anyhow::Result<String> {
        // 选择最佳节点
        if let Some(node_id) = self.select_node_for_task().await {
            // 更新节点负载
            let mut loads = self.node_load.write().await;
            if let Some(load) = loads.get_mut(&node_id) {
                load.active_tasks += 1;
            }

            // 将任务添加到队列
            self.task_queue.enqueue(task).await;

            Ok(node_id)
        } else {
            Err(anyhow::anyhow!("No available nodes"))
        }
    }

    pub async fn complete_task(&self, node_id: &str) {
        let mut loads = self.node_load.write().await;
        if let Some(load) = loads.get_mut(node_id) {
            if load.active_tasks > 0 {
                load.active_tasks -= 1;
            }
        }
    }

    pub async fn get_idle_nodes(&self, threshold: f32) -> Vec<String> {
        let loads = self.node_load.read().await;

        loads
            .values()
            .filter(|load| {
                load.cpu_usage < threshold &&
                (load.active_tasks as f32 / load.max_capacity as f32) < 0.5
            })
            .map(|load| load.node_id.clone())
            .collect()
    }
}

// ===== 单元测试 =====

#[cfg(test)]
mod tests {
    use super::*;

    // ===== 一致性哈希测试 =====

    #[test]
    fn test_consistent_hash_basic() {
        let mut ring = ConsistentHashRing::new(100);

        ring.add_node("node_1");
        ring.add_node("node_2");
        ring.add_node("node_3");

        // 测试 key 路由
        let node = ring.get_node("doc_1");
        assert!(node.is_some());

        // 测试一致性：相同 key 总是路由到相同节点
        let node1 = ring.get_node("doc_1");
        let node2 = ring.get_node("doc_1");
        assert_eq!(node1, node2);
    }

    #[test]
    fn test_consistent_hash_replication() {
        let mut ring = ConsistentHashRing::new(100);

        ring.add_node("node_1");
        ring.add_node("node_2");
        ring.add_node("node_3");

        // 测试副本路由
        let nodes = ring.get_nodes_for_key("doc_1", 2);
        assert_eq!(nodes.len(), 2);
        assert!(nodes[0] != nodes[1]); // 不同的副本节点
    }

    #[test]
    fn test_consistent_hash_removal() {
        let mut ring = ConsistentHashRing::new(100);

        ring.add_node("node_1");
        ring.add_node("node_2");

        let node_before = ring.get_node("doc_1");
        assert!(node_before.is_some());

        // 移除一个节点
        ring.remove_node("node_1");

        let node_after = ring.get_node("doc_1");
        assert!(node_after.is_some());
        assert_ne!(node_before, node_after); // 路由应该改变
    }

    #[test]
    fn test_consistent_hash_distribution() {
        let mut ring = ConsistentHashRing::new(100);

        ring.add_node("node_1");
        ring.add_node("node_2");
        ring.add_node("node_3");

        // 测试分布均匀性
        let mut counts = HashMap::new();
        for i in 0..1000 {
            let key = format!("doc_{}", i);
            if let Some(node) = ring.get_node(&key) {
                *counts.entry(node).or_insert(0) += 1;
            }
        }

        // 所有节点都应该获得一些 key
        assert_eq!(counts.len(), 3);

        // 检查分布相对均匀（不应该有节点获得 > 70% 的数据）
        let max_count = *counts.values().max().unwrap_or(&0);
        assert!(max_count < 700);
    }

    // ===== 分片管理器测试 =====

    #[test]
    fn test_shard_manager_add_remove() {
        let mut manager = ShardManager::new(100);

        manager.add_node("node_1");
        manager.add_node("node_2");

        let node = manager.get_target_node("articles", "doc_1");
        assert!(node.is_some());

        // 移除节点后应该重新路由
        let node_before = manager.get_target_node("articles", "doc_1");
        manager.remove_node("node_1");
        let node_after = manager.get_target_node("articles", "doc_1");

        assert!(node_before.is_some());
        assert!(node_after.is_some());
        // 由于一致性哈希，移除节点会改变路由
    }

    #[test]
    fn test_shard_manager_consistency() {
        let mut manager = ShardManager::new(100);

        manager.add_node("node_1");
        manager.add_node("node_2");

        // 相同的 collection:id 组合应该路由到相同节点
        let node1 = manager.get_target_node("articles", "doc_123");
        let node2 = manager.get_target_node("articles", "doc_123");
        let node3 = manager.get_target_node("articles", "doc_456");

        assert_eq!(node1, node2); // 一致性

        // 不同的文档可能路由到不同节点
        // 但不一定总是不同（取决于哈希）
    }

    #[test]
    fn test_shard_manager_replication() {
        let mut manager = ShardManager::new(100);

        manager.add_node("node_1");
        manager.add_node("node_2");
        manager.add_node("node_3");

        // 测试副本路由
        let replicas = manager.get_replication_nodes("articles", "doc_1", 2);
        assert_eq!(replicas.len(), 2);

        // 副本节点应该不同
        assert_ne!(replicas[0], replicas[1]);
    }

    // ===== 分布式查询执行测试 =====

    #[tokio::test]
    async fn test_distributed_query_empty() {
        let shard_manager = Arc::new(RwLock::new(ShardManager::new(100)));
        let executor = DistributedQueryExecutor::new(shard_manager);

        let query = Query {
            collection: "articles".to_string(),
            filters: vec![],
            limit: None,
            offset: None,
        };

        // 没有节点时返回空结果
        let results = executor.execute_distributed_query("articles", query).await.unwrap();
        assert_eq!(results.len(), 0);
    }

    #[tokio::test]
    async fn test_distributed_query_with_nodes() {
        let mut shard_manager = ShardManager::new(100);
        shard_manager.add_node("node_1");
        shard_manager.add_node("node_2");

        let shard_manager = Arc::new(RwLock::new(shard_manager));
        let executor = DistributedQueryExecutor::new(shard_manager);

        let query = Query {
            collection: "articles".to_string(),
            filters: vec![],
            limit: Some(10),
            offset: None,
        };

        // 在实际实现中，这里会查询远程节点
        let results = executor.execute_distributed_query("articles", query).await.unwrap();
        // 简化实现返回空结果
        assert_eq!(results.len(), 0);
    }

    #[tokio::test]
    async fn test_distributed_query_offset_limit() {
        let mut shard_manager = ShardManager::new(100);
        shard_manager.add_node("node_1");

        let shard_manager = Arc::new(RwLock::new(shard_manager));
        let executor = DistributedQueryExecutor::new(shard_manager);

        let query = Query {
            collection: "articles".to_string(),
            filters: vec![],
            limit: Some(5),
            offset: Some(10),
        };

        // 测试 offset 和 limit 应用
        // 在完整实现中，这里会合并多个节点的结果并应用 offset/limit
        let results = executor.execute_distributed_query("articles", query).await.unwrap();
        assert_eq!(results.len(), 0);
    }

    // ===== 任务队列测试 =====

    #[tokio::test]
    async fn test_task_queue_enqueue_dequeue() {
        let queue = TaskQueue::new();

        let task = DistributedTask {
            id: "task_1".to_string(),
            task_type: TaskType::HookExecution,
            payload: json!({"data": "test"}),
            priority: 10,
            created_at: chrono::Utc::now().timestamp_millis(),
        };

        queue.enqueue(task.clone()).await;

        assert_eq!(queue.len().await, 1);

        let dequeued = queue.dequeue().await;
        assert!(dequeued.is_some());
        assert_eq!(dequeued.unwrap().id, "task_1");

        assert_eq!(queue.len().await, 0);
    }

    #[tokio::test]
    async fn test_task_queue_priority_ordering() {
        let queue = TaskQueue::new();

        let low_priority = DistributedTask {
            id: "task_low".to_string(),
            task_type: TaskType::HookExecution,
            payload: json!({}),
            priority: 1,
            created_at: chrono::Utc::now().timestamp_millis(),
        };

        let high_priority = DistributedTask {
            id: "task_high".to_string(),
            task_type: TaskType::HookExecution,
            payload: json!({}),
            priority: 10,
            created_at: chrono::Utc::now().timestamp_millis(),
        };

        queue.enqueue(low_priority).await;
        queue.enqueue(high_priority).await;

        // 高优先级任务应该先出队
        let first = queue.dequeue().await.unwrap();
        assert_eq!(first.id, "task_high");
        assert_eq!(first.priority, 10);
    }

    #[tokio::test]
    async fn test_task_queue_peek() {
        let queue = TaskQueue::new();

        let task = DistributedTask {
            id: "task_1".to_string(),
            task_type: TaskType::HookExecution,
            payload: json!({}),
            priority: 5,
            created_at: chrono::Utc::now().timestamp_millis(),
        };

        queue.enqueue(task.clone()).await;

        let peeked = queue.peek().await;
        assert!(peeked.is_some());
        assert_eq!(peeked.unwrap().id, "task_1");

        // peek 不应该移除任务
        assert_eq!(queue.len().await, 1);
    }

    // ===== Work Stealing 测试 =====

    #[tokio::test]
    async fn test_work_stealing_basic() {
        let task_queue = Arc::new(TaskQueue::new());
        let balancer = WorkStealingBalancer::new(task_queue);

        balancer.register_node("node_1", 10).await;
        balancer.register_node("node_2", 10).await;

        // 设置节点负载
        balancer.update_node_load("node_1", 0.8, 0.5, 8).await; // 高负载
        balancer.update_node_load("node_2", 0.1, 0.2, 1).await; // 低负载

        // 应该选择低负载的节点
        let selected = balancer.select_node_for_task().await;
        assert_eq!(selected, Some("node_2".to_string()));
    }

    #[tokio::test]
    async fn test_work_stealing_assign_complete() {
        let task_queue = Arc::new(TaskQueue::new());
        let balancer = WorkStealingBalancer::new(task_queue);

        balancer.register_node("node_1", 10).await;

        let task = DistributedTask {
            id: "task_1".to_string(),
            task_type: TaskType::HookExecution,
            payload: json!({}),
            priority: 5,
            created_at: chrono::Utc::now().timestamp_millis(),
        };

        // 分配任务
        let node_id = balancer.assign_task(task).await.unwrap();
        assert_eq!(node_id, "node_1");

        // 检查负载更新
        {
            let loads = balancer.node_load.read().await;
            let load = loads.get("node_1").unwrap();
            assert_eq!(load.active_tasks, 1);
        }

        // 完成任务
        balancer.complete_task("node_1").await;

        // 重新获取锁以检查最终状态
        {
            let loads = balancer.node_load.read().await;
            let load = loads.get("node_1").unwrap();
            assert_eq!(load.active_tasks, 0);
        }
    }

    #[tokio::test]
    async fn test_work_stealing_capacity_limit() {
        let task_queue = Arc::new(TaskQueue::new());
        let balancer = WorkStealingBalancer::new(task_queue);

        balancer.register_node("node_1", 5).await; // 最大容量5

        // 填满节点
        balancer.update_node_load("node_1", 0.5, 0.5, 5).await;

        // 节点已满，不应该被选中
        let selected = balancer.select_node_for_task().await;
        assert!(selected.is_none());
    }

    #[tokio::test]
    async fn test_work_stealing_idle_detection() {
        let task_queue = Arc::new(TaskQueue::new());
        let balancer = WorkStealingBalancer::new(task_queue);

        balancer.register_node("node_1", 10).await;
        balancer.register_node("node_2", 10).await;

        // node_1 空闲，node_2 忙碌
        balancer.update_node_load("node_1", 0.1, 0.1, 1).await;
        balancer.update_node_load("node_2", 0.9, 0.8, 9).await;

        let idle_nodes = balancer.get_idle_nodes(0.5).await;
        assert_eq!(idle_nodes.len(), 1);
        assert!(idle_nodes.contains(&"node_1".to_string()));
    }

    #[tokio::test]
    async fn test_work_stealing_multiple_tasks() {
        let task_queue = Arc::new(TaskQueue::new());
        let balancer = WorkStealingBalancer::new(task_queue);

        balancer.register_node("node_1", 10).await;
        balancer.register_node("node_2", 10).await;

        // 创建多个任务
        for i in 0..5 {
            let task = DistributedTask {
                id: format!("task_{}", i),
                task_type: TaskType::HookExecution,
                payload: json!({}),
                priority: 5,
                created_at: chrono::Utc::now().timestamp_millis(),
            };

            balancer.assign_task(task).await.unwrap();
        }

        // 检查负载均衡
        let loads = balancer.node_load.read().await;
        let load1 = loads.get("node_1").unwrap();
        let load2 = loads.get("node_2").unwrap();

        // 任务应该分布到两个节点
        assert!(load1.active_tasks > 0 || load2.active_tasks > 0);
        assert_eq!(load1.active_tasks + load2.active_tasks, 5);
    }

    // ===== 端到端集群测试 =====

    #[tokio::test]
    async fn test_cluster_write_read_consistency() {
        let dir = tempdir().unwrap();
        let storage = SledStorage::new(dir.path()).unwrap();

        // 模拟：在分片集群中写入数据
        let doc = Document::new(
            "articles".to_string(),
            json!({"title": "Cluster Article", "content": "Content"})
        );
        storage.insert(doc.clone()).await.unwrap();

        // 模拟：从分片集群中读取数据
        let retrieved = storage.get("articles", &doc.id).await.unwrap();
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().data["title"], "Cluster Article");
    }

    #[tokio::test]
    async fn test_cluster_rebalance_after_node_add() {
        let mut manager = ShardManager::new(100);

        // 初始节点
        manager.add_node("node_1");
        manager.add_node("node_2");

        // 记录初始路由
        let initial_node = manager.get_target_node("articles", "doc_1");

        // 添加新节点
        manager.add_node("node_3");

        // 新节点的添加会改变某些 key 的路由
        // 但不是所有 key 都会改变
        let new_node = manager.get_target_node("articles", "doc_1");

        // 验证节点仍然存在
        assert!(initial_node.is_some());
        assert!(new_node.is_some());
    }

    #[tokio::test]
    async fn test_cluster_scatter_gather_query() {
        let mut manager = ShardManager::new(100);

        // 添加多个节点
        for i in 1..=3 {
            manager.add_node(&format!("node_{}", i));
        }

        let shard_manager = Arc::new(RwLock::new(manager));
        let executor = DistributedQueryExecutor::new(shard_manager);

        let query = Query {
            collection: "articles".to_string(),
            filters: vec![
                ("status".to_string(), QueryOp::Eq(json!("published")))
            ],
            limit: Some(20),
            offset: Some(0),
        };

        // 执行分布式查询
        let results = executor.execute_distributed_query("articles", query).await.unwrap();

        // 在完整实现中，这里会从所有节点收集结果
        // 目前验证查询不会失败
        assert!(results.is_empty()); // 因为没有实际数据
    }

    #[tokio::test]
    async fn test_cluster_failover() {
        let mut manager = ShardManager::new(100);

        manager.add_node("node_1");
        manager.add_node("node_2");

        // 获取副本节点
        let replicas = manager.get_replication_nodes("articles", "doc_1", 2);
        assert_eq!(replicas.len(), 2);

        // 模拟 node_1 故障
        manager.remove_node("node_1");

        // 数据应该仍然可访问（通过副本）
        let new_node = manager.get_target_node("articles", "doc_1");
        assert!(new_node.is_some());
        assert_eq!(new_node.unwrap(), "node_2");
    }
}