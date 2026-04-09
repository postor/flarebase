# Flarebase Indexing System Design

This document outlines the design and implementation strategy for the Flarebase secondary indexing system.

## 1. Problem Statement
Flarebase currently performs full collection scans ($O(N)$) for all queries. As the collection size grows, query latency increases linearly, making the system unsuitable for scale.

## 2. Evaluation
- **Verdict**: **Essential**.
- **Performance**: Secondary indexes reduce query complexity from $O(N)$ (scan) to $O(\log N)$ (tree lookup).
- **Flexibility**: Enables efficient range queries (`>`, `<`, `<=`, `>=`) and sorting without loading all documents into memory.

## 3. Storage Architecture
We leverage `sled`'s multi-tree capability to store indexes separately from the primary document store.

### 3.1 Tree Structure
For each collection and field that requires indexing, a new tree is created:
- **Primary Tree**: `{collection_name}` (Key: `doc_id`, Value: `Document`)
- **Index Tree**: `__index__:{collection}:{field}`
    - **Key**: `byte_encoded(field_value)` + `0x00` (null separator) + `doc_id`
    - **Value**: Empty (or a small version marker)

> [!NOTE]
> Including the `doc_id` in the key ensures that multiple documents with the same field value (non-unique index) are stored as distinct keys, and they are naturally sorted by `field_value` then `doc_id`.

## 4. Query Execution Flow

### 4.1 Index Selection
When a `flare_protocol::Query` is received:
1.  The engine checks if any of the filter fields have an associated index tree.
2.  If multiple filters are indexed, the engine chooses the one with the highest estimated selectivity (or the first available in this version).

### 4.2 Pattern Matching
- **Equality (`Eq`)**: Perform a prefix scan for `field_value`.
- **Range (`Gt`, `Lt`, etc.)**: Perform a range scan on the index tree using `sled`'s `range()` iterator.
- **In-list (`In`)**: Execute multiple lookups for each value in the list.

### 4.3 Document Retrieval
1.  Collect `doc_id`s from the index scan.
2.  Apply remaining filters (those not indexed) to the fetched document IDs.
3.  Fetch the full `Document` from the primary collection tree if it passes all filters.

## 5. Maintenance and Consistency

### 5.1 Update Path
When a document is inserted or updated:
1.  Identify all fields currently indexed for the collection.
2.  **Delete Old Entry**: If it's an update, remove the entry from the index tree using the previous field value.
3.  **Insert New Entry**: Add the new value to the index tree.

### 5.2 Transactional Integrity
> [!WARNING]
> While `sled` supports transactions within a single tree, cross-tree consistency is more complex. Initially, we will use a "best-effort" sequenced update. Future versions may implement a Write-Ahead Log (WAL) or use `sled`'s cross-tree batching if supported.

## 6. Implementation Roadmap
1.  **Refactor Storage Trait**: Add `create_index(collection, field)` to the `Storage` trait.
2.  **Index Management**: Implement metadata tracking for which indexes exist.
3.  **Query Optimizer**: Update `SledStorage::query` to use index trees when available.
