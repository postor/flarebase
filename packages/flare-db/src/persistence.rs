//! Persistence support for in-memory storage.
//!
//! This module provides periodic snapshot and background persistence capabilities
//! for MemoryStorage, ensuring data durability while maintaining memory performance.

use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::fs;
use anyhow::Context;

use super::memory::MemoryStorage;

/// Persistence manager for MemoryStorage
pub struct PersistenceManager {
    storage: MemoryStorage,
    snapshot_path: PathBuf,
    interval: Duration,
    snapshot_handle: Option<tokio::task::JoinHandle<()>>,
}

impl PersistenceManager {
    /// Create a new persistence manager
    pub fn new<P: AsRef<Path>>(
        storage: MemoryStorage,
        snapshot_path: P,
        interval: Duration,
    ) -> Self {
        Self {
            storage,
            snapshot_path: snapshot_path.as_ref().to_path_buf(),
            interval,
            snapshot_handle: None,
        }
    }

    /// Start automatic background snapshots
    pub async fn start(&mut self) -> anyhow::Result<()> {
        // Ensure snapshot directory exists
        if let Some(parent) = self.snapshot_path.parent() {
            fs::create_dir_all(parent).await
                .context("Failed to create snapshot directory")?;
        }

        // Load existing snapshot if available
        if self.snapshot_path.exists() {
            self.load_snapshot().await?;
        }

        // Start background snapshot task
        let storage = self.storage.clone();
        let snapshot_path = self.snapshot_path.clone();
        let interval = self.interval;

        let handle = tokio::spawn(async move {
            let mut timer = tokio::time::interval(interval);
            loop {
                timer.tick().await;

                if let Err(e) = Self::save_snapshot_internal(&storage, &snapshot_path).await {
                    eprintln!("Snapshot failed: {}", e);
                }
            }
        });

        self.snapshot_handle = Some(handle);
        Ok(())
    }

    /// Stop automatic snapshots
    pub async fn stop(&mut self) {
        if let Some(handle) = self.snapshot_handle.take() {
            handle.abort();
        }
    }

    /// Force an immediate snapshot
    pub async fn force_snapshot(&self) -> anyhow::Result<()> {
        Self::save_snapshot_internal(&self.storage, &self.snapshot_path).await
    }

    /// Load snapshot from disk
    async fn load_snapshot(&self) -> anyhow::Result<()> {
        let content = fs::read_to_string(&self.snapshot_path).await
            .map_err(|e| anyhow::anyhow!("Failed to read snapshot file: {}", e))?;

        let data: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| anyhow::anyhow!("Failed to parse snapshot JSON: {}", e))?;

        self.storage.restore(data).await
            .map_err(|e| anyhow::anyhow!("Failed to restore snapshot: {}", e))?;

        Ok(())
    }

    /// Internal snapshot save logic
    async fn save_snapshot_internal(
        storage: &MemoryStorage,
        snapshot_path: &Path,
    ) -> anyhow::Result<()> {
        // Snapshot to JSON
        let snapshot = storage.snapshot().await
            .map_err(|e| anyhow::anyhow!("Failed to create snapshot: {}", e))?;

        // Write to temporary file first (atomic write)
        let temp_path = snapshot_path.with_extension("tmp");
        let content = serde_json::to_string_pretty(&snapshot)
            .map_err(|e| anyhow::anyhow!("Failed to serialize snapshot: {}", e))?;

        fs::write(&temp_path, content).await
            .map_err(|e| anyhow::anyhow!("Failed to write temporary snapshot file: {}", e))?;

        // Atomic rename
        fs::rename(&temp_path, snapshot_path).await
            .map_err(|e| anyhow::anyhow!("Failed to rename snapshot file: {}", e))?;

        Ok(())
    }

    /// Get reference to the underlying storage
    pub fn storage(&self) -> &MemoryStorage {
        &self.storage
    }

    /// Get mutable reference to the underlying storage
    pub fn storage_mut(&mut self) -> &mut MemoryStorage {
        &mut self.storage
    }
}

impl Drop for PersistenceManager {
    fn drop(&mut self) {
        // Stop background task on drop
        if let Some(handle) = self.snapshot_handle.take() {
            handle.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::MemoryStorage;
    use crate::Storage;
    use flare_protocol::Document;
    use serde_json::json;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_persistence_roundtrip() {
        let dir = tempdir().unwrap();
        let snapshot_path = dir.path().join("snapshot.json");

        // Create storage and add data
        let storage1 = MemoryStorage::new();
        let doc = Document::new("test".to_string(), json!({"value": 42}));
        storage1.insert(doc).await.unwrap();

        // Create persistence manager and force snapshot
        let mut manager1 = PersistenceManager::new(
            storage1.clone(),
            snapshot_path.clone(),
            Duration::from_secs(10),
        );

        manager1.force_snapshot().await.unwrap();

        // Create new storage and restore
        let storage2 = MemoryStorage::new();
        let mut manager2 = PersistenceManager::new(
            storage2.clone(),
            snapshot_path,
            Duration::from_secs(10),
        );

        manager2.load_snapshot().await.unwrap();

        // Verify data
        let docs = manager2.storage().list("test").await.unwrap();
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].data["value"], 42);
    }
}
