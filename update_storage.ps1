$content = Get-Content -Path 'd:/study/flarebase/packages/flare-server/tests/blog_data_mock_validation_tests.rs' -Raw
$content = $content -replace 'let dir = tempdir\(\)\.unwrap\(\);\s*\r?\n\s*let storage = SledStorage::new\(dir\.path\(\)\)\.unwrap\(\);', 'let storage = MemoryStorage::new();'
$content = $content -replace 'use flare_db::{SledStorage, Storage};', 'use flare_db::{MemoryStorage, Storage};'
Set-Content -Path 'd:/study/flarebase/packages/flare-server/tests/blog_data_mock_validation_tests.rs' -Value $content
Write-Host "Storage type updated successfully"