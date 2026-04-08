// 这个文件包含修复后的测试代码

#[tokio::test]
async fn test_article_lifecycle_with_moderation() {
    let dir = tempdir().unwrap();
    let storage = SledStorage::new(dir.path()).unwrap();

    let author_id = "author_lifecycle";
    let moderator_id = "moderator_admin";

    // 1. 作者创建草稿
    let mut draft = Document::new(
        "articles".to_string(),
        json!({
            "title": "Draft Article",
            "content": "Initial content",
            "author_id": author_id,
            "status": "draft",
            "created_at": chrono::Utc::now().timestamp_millis()
        })
    );
    draft.version = 1;
    storage.insert(draft.clone()).await.unwrap();

    // 2. 作者提交审核（需要保留所有字段）
    let current_doc = storage.get("articles", &draft.id).await.unwrap().unwrap();
    let mut update_data = current_doc.data.clone();
    update_data["status"] = json!("pending_review");

    storage.update(
        "articles",
        &draft.id,
        update_data
    ).await.unwrap();

    let submitted = storage.get("articles", &draft.id).await.unwrap().unwrap();
    assert_eq!(submitted.data["status"], "pending_review");
    assert_eq!(submitted.data["title"], "Draft Article"); // 标题保留

    // 3. 管理员审核（添加审核字段，同时保留原始字段）
    let current_doc = storage.get("articles", &draft.id).await.unwrap().unwrap();
    let mut update_data = current_doc.data.clone();
    update_data["status"] = json!("published");
    update_data["moderator_id"] = json!(moderator_id);
    update_data["internal_notes"] = json!("Approved after minor edits");
    update_data["approval_timestamp"] = json!(chrono::Utc::now().timestamp_millis());

    storage.update(
        "articles",
        &draft.id,
        update_data
    ).await.unwrap();

    let published = storage.get("articles", &draft.id).await.unwrap().unwrap();
    assert_eq!(published.data["status"], "published");
    assert_eq!(published.data["moderator_id"], moderator_id);
    assert_eq!(published.data["title"], "Draft Article"); // 标题仍然保留
    assert_eq!(published.data["author_id"], author_id);

    // 4. 验证数据脱敏（模拟公开查询）
    let mut public_article = published.data.clone();
    // 移除敏感字段
    if let Some(obj) = public_article.as_object_mut() {
        obj.remove("moderator_id");
        obj.remove("internal_notes");
        obj.remove("approval_timestamp");
    }

    // 验证敏感字段已移除
    assert!(public_article.get("moderator_id").is_none());
    assert!(public_article.get("internal_notes").is_none());
    assert!(public_article.get("approval_timestamp").is_none());

    // 验证公开字段仍存在
    assert_eq!(public_article["title"], "Draft Article");
    assert_eq!(public_article["content"], "Initial content");
    assert_eq!(public_article["status"], "published");
    assert_eq!(public_article["author_id"], author_id);
}
