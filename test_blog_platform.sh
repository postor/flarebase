#!/bin/bash

echo "=== Testing Flarebase Blog Platform ==="
echo ""

# Test 1: Check if Flarebase server is running
echo "1. Testing Flarebase server (http://localhost:3000)..."
curl -s http://localhost:3000/collections/posts 2>&1 | head -5
echo ""

# Test 2: Check if Blog platform is running
echo "2. Testing Blog platform (http://localhost:3002)..."
curl -s http://localhost:3002 2>&1 | head -5
echo ""

# Test 3: Check named queries endpoint
echo "3. Testing named queries endpoint..."
curl -s -X POST http://localhost:3000/queries/get_published_posts \
  -H "Content-Type: application/json" \
  -d '{"limit": 5, "offset": 0}' 2>&1 | head -5
echo ""

# Test 4: Check if we can create a test user
echo "4. Testing user registration endpoint..."
curl -s -X POST http://localhost:3000/call_hook/auth \
  -H "Content-Type: application/json" \
  -d '{"action": "register", "name": "Test User", "email": "test@example.com", "password": "password123"}' 2>&1 | head -5
echo ""

echo "=== Tests Complete ==="
