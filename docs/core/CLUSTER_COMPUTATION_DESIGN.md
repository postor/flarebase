# Flarebase Cluster Computation Sharing Design

This document describes the architecture for distributed query execution and computational load balancing across a Flarebase cluster.

## 1. Problem Statement
In a standalone configuration, each Flarebase node operates on its own local data. To scale beyond a single machine's capacity and throughput, Flarebase must transition to a distributed model where computation and data are shared across multiple nodes.

## 2. Evaluation
- **Verdict**: **Meaningful for Scalability**.
- **Impact**: Enables horizontal scaling of both storage (sharding) and compute (CPU-intensive hooks).
- **Core Strategy**: Moving from "Independent Nodes" to a "Partitioned Cluster" using Consistent Hashing.

## 3. Data Partitioning (Sharding)
To share computation, data must first be distributed.
- **Algorithm**: Consistent Hashing.
- **Partition Key**: `{collection}:{id}`.
- **Virtual Nodes**: Each physical node maps to multiple points on the hash ring to ensure uniform distribution and easy re-balancing.

## 4. Distributed Query Execution (Scatter-Gather)

When a node (the **Coordinator**) receives a query request:

### 4.1 Mapping
The Coordinator determines which partitions (and thus which nodes) contain the data for the relevant collection.

### 4.2 Fan-out
- The Coordinator sends sub-query requests to all participant nodes via **gRPC**.
- These nodes execute the query against their **local shingles** (using the Indexing System if applicable).

### 4.3 Merging (Tail-recursion)
1.  Nodes return partial result sets (matching documents).
2.  The Coordinator merges results.
3.  **Global Sorting/Limit**: If the query includes `limit`, `offset`, or `sort`, the Coordinator must perform a final merge-sort and truncate the results before returning them to the client.

## 5. Computational Load Balancing (Hooks)

Compute-heavy tasks like Hooks can be offloaded to idle nodes.

### 5.1 Shared Task Queue
Instead of executing a Hook immediately on the node that received the event:
1.  The event is published to a internal **Distributed Task Queue**.
2.  Any node in the cluster can "pull" or "steal" the task.

### 5.2 Work Stealing Logic
- Nodes monitor their own CPU/Memory pressure.
- Idle nodes proactively request tasks from the queue.
- Nodes under heavy load only execute mission-critical local logic.

## 6. Implementation Roadmap
1.  **Cluster Mesh**: Implement full gRPC connectivity between all nodes in the `ClusterManager`.
2.  **DHT Implementation**: Add a consistent hashing library to route requests.
3.  **Remote Storage Proxy**: Update the `Storage` trait to handle remote fetches if the data isn't local.
4.  **Task Orchestrator**: Implement a basic distributed task queue for Hook execution.
