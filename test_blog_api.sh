#!/bin/bash

echo "=== Testing Blog Platform API Endpoints ==="
echo ""

# Test 1: Named query execution
echo "1. Testing named query execution:"
curl -s -X POST http://localhost:3000/queries/get_published_posts \
  -H "Content-Type: application/json" \
  -d '{"limit":5,"offset":0}' | jq '.' 2>/dev/null || echo "Failed to parse JSON"
echo ""

# Test 2: Direct collection access (should fail with 401)
echo "2. Testing collection endpoint (should need auth):"
curl -s -w "\nHTTP Status: %{http_code}\n" http://localhost:3000/collections/posts
echo ""

# Test 3: Create a test post (should fail without auth)
echo "3. Testing post creation (should need auth):"
curl -s -w "\nHTTP Status: %{http_code}\n" -X POST http://localhost:3000/collections/posts \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","content":"Test content"}'
echo ""

# Test 4: Check if database has any data
echo "4. Checking database files:"
ls -la /d/study/flarebase/*.db 2>/dev/null || echo "No database files found"
echo ""

echo "=== API Tests Complete ==="
