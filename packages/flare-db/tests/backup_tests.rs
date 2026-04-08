use flare_db::{SledStorage, Storage};
use flare_protocol::Document;
use serde_json::json;
use tempfile::tempdir;

#[tokio::test]
async fn test_backup_restore_cycle() -> anyhow::Result<()> {
    // Create a temporary directory for storage
    let dir1 = tempdir()?;
    let db1 = SledStorage::new(dir1.path())?;

    // 1. Insert some data
    let doc1 = Document::new("users".to_string(), json!({"name": "Alice", "age": 30}));
    let doc2 = Document::new("users".to_string(), json!({"name": "Bob", "age": 25}));
    let doc3 = Document::new("config".to_string(), json!({"theme": "dark"}));
    
    db1.insert(doc1.clone()).await?;
    db1.insert(doc2.clone()).await?;
    db1.insert(doc3.clone()).await?;

    // 2. Export to Value (Simulating a file)
    let backup_data = db1.export_all().await?;

    // 3. Create a second DB and Import
    let dir2 = tempdir()?;
    let db2 = SledStorage::new(dir2.path())?;
    db2.import_all(backup_data).await?;

    // 4. Verify data in DB2
    let users = db2.list("users").await?;
    assert_eq!(users.len(), 2);
    
    let config = db2.list("config").await?;
    assert_eq!(config.len(), 1);
    assert_eq!(config[0].data["theme"], "dark");

    Ok(())
}
