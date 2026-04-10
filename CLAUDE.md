# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 📖 Documentation Hub
A comprehensive set of technical documents is available in the [**docs/**](./docs/README.md) directory:
- [Architecture Overview](./docs/core/ARCHITECTURE.md)
- [Index System](./docs/core/INDEXING_DESIGN.md)
- [Cluster Computation](./docs/core/CLUSTER_COMPUTATION_DESIGN.md)
- [Security & Permissions](./docs/core/SECURITY.md)
- [Hook Protocol](./docs/features/HOOKS_PROTOCOL.md)
- [Session Synchronization](./docs/features/SESSION_SYNC.md)
- [User & Article Flows](./docs/flows/USER_AND_ARTICLE_FLOWS.md)

## Overview

Flarebase is a distributed document database (Backend-as-a-Service) written in Rust with a JavaScript client SDK. The architecture follows a **"Passive Infrastructure"** pattern where the server provides generic storage capabilities without managing business logic or predefined schemas.

### Key Architecture Principles

- **Generic Storage**: Collections are created on-the-fly. No schema definitions required. (See [Architecture](./docs/core/ARCHITECTURE.md))
- **Event-Driven**: Real-time sync via WebSockets (Socket.IO) and HTTP webhooks.
- **Distributed**: Multi-node cluster with gRPC-based coordination.
- **Client-Driven**: Workflows are implemented client-side using collection operations.

## Workspace Structure

```
flarebase/
├── packages/
│   ├── flare-db/          # Storage layer (Sled embedded DB)
│   ├── flare-server/      # HTTP/WebSocket/gRPC server
│   ├── flare-protocol/    # Shared types and protobuf definitions
│   └── flare-cli/         # CLI tooling
├── clients/js/            # JavaScript SDK
├── docs/                  # Technical documentation hub [NEW]
├── docker/                # Docker deployment configs
└── scripts/               # Utility scripts
```

## Common Development Commands

### Building & Running

```bash
cargo build -p flare-server                      # Build server
cargo run -p flare-server                        # Run server (default ports)
FLARE_DB_PATH=./custom.db cargo run -p flare-server # Custom storage path
```

### Testing

```bash
cargo test -p flare-server                       # Run Rust server tests
cd clients/js && node tests/run_tests.js        # Run full integration suite
```

## Architecture Deep Dive

### Storage Layer (`flare-db`)

- Uses **Sled** as an embedded KV database.
- Each collection maps to a Sled tree. (Details in [Architecture Layer](./docs/core/ARCHITECTURE.md))
- Supports atomic batch operations via `runTransaction`.

### Server Layer (`flare-server`)

- **HTTP API**: RESTful endpoints for documents.
- **WebSocket API**: Socket.IO for subscriptions and Hooks.
- **gRPC API**: Node-to-node heartbeats and coordination.

### Hooks & Webhooks

Flarebase supports two types of external logic integration:

1.  **Webhooks (Stateless)**: HTTP POST callbacks. (Configurations in `__webhooks__`)
2.  **Stateful Hooks (WebSocket)**: Persistent connections in `/hooks`. (See [Hook Protocol](./docs/features/HOOKS_PROTOCOL.md))

### Session-scoped Synchronization

A unique feature for private, real-time data sync per client session.
- Uses `_session_{sid}_` collection prefixing. (See [Session Sync Guide](./docs/features/SESSION_SYNC.md))
- Automatic room-based routing.

### Security & Permissions

Flarebase uses a resource-based authorization model and sync policies.
- **Authorizer**: Programmatic permission checks (See [Security Overview](./docs/core/SECURITY.md)).
- **SyncPolicy**: Field-level data redaction during broadcast.

## Environment Variables

- `NODE_ID`: Node identifier (default: 1)
- `HTTP_ADDR`: HTTP bind (default: "0.0.0.0:3000")
- `GRPC_ADDR`: gRPC bind (default: "0.0.0.0:50051")
- `FLARE_DB_PATH`: DB file path (default: "./flare_{NODE_ID}.db")
- `WHITELIST_CONFIG_PATH`: Named queries config path (default: "named_queries.json")

## Working Guidelines

### 🧪 Test-Driven Development (TDD) Principles

**CRITICAL**: Every feature development MUST follow TDD workflow. Write tests FIRST, then implement code to make tests pass.

#### 1. Test-First Workflow

```
┌─────────────────────────────────────────────────────┐
│ 1. WRITE TESTS (Red Phase)                          │
│    - Define expected behavior                       │
│    - Write test cases covering all scenarios        │
│    - Run tests → They should FAIL                   │
└─────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│ 2. IMPLEMENT CODE (Green Phase)                     │
│    - Write MINIMAL code to pass tests               │
│    - Run tests → They should PASS                   │
│    - Do NOT add extra features                      │
└─────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│ 3. REFACTOR (Optional)                              │
│    - Improve code quality                           │
│    - Run tests → Still PASS                         │
│    - Do NOT change functionality                    │
└─────────────────────────────────────────────────────┘
```

#### 2. Test Structure Requirements

All test files must include:

**Unit Tests** (per module):
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_functionality() {
        // Arrange
        let input = "test";

        // Act
        let result = process(input);

        // Assert
        assert_eq!(result, "expected");
    }

    #[test]
    fn test_edge_cases() {
        // Test boundary conditions
    }

    #[test]
    fn test_error_handling() {
        // Test error cases
    }
}
```

**Integration Tests** (in `tests/` directory):
```rust
use flare_server::{ModuleName, OtherModule};

#[tokio::test]
async fn test_integration_scenario() {
    // Setup
    let state = create_test_state().await;

    // Execute
    let result = state.module_call().await;

    // Verify
    assert!(result.is_ok());
}
```

#### 3. Test Coverage Requirements

**Mandatory Coverage**:
- ✅ Happy path (normal operation)
- ✅ Edge cases (empty, null, boundary values)
- ✅ Error cases (invalid input, failures)
- ✅ Concurrent operations (if applicable)
- ✅ Integration scenarios (end-to-end flows)

**Example Test Categories**:
```bash
# JWT Middleware Tests (15 tests)
✅ test_generate_and_validate_token
✅ test_extract_user_context
✅ test_invalid_token_rejected
✅ test_malformed_token_rejected
✅ test_empty_token_rejected
✅ test_token_with_special_characters
✅ test_multiple_roles
✅ test_user_context_cloning
✅ test_authorization_header_case_insensitive
✅ test_bearer_with_extra_spaces
✅ test_jwt_manager_default
✅ test_long_user_id
✅ test_token_expiration
✅ test_extract_jwt_from_header
✅ test_empty_user_fields

# Auth Hook Integration Tests (10 tests)
✅ test_auth_hook_request_structure
✅ test_auth_hook_jwt_injection_guest
✅ test_auth_hook_jwt_injection_authenticated
✅ test_auth_hook_login_flow
✅ test_auth_hook_register_flow
✅ test_auth_hook_error_responses
✅ test_auth_hook_malformed_requests
✅ test_auth_hook_response_structure
✅ test_auth_hook_multiple_concurrent_requests
✅ test_jwt_persistence_across_requests
```

#### 4. Running Tests

```bash
# Run all tests
cargo test -p flare-server

# Run specific module tests
cargo test jwt_middleware --lib
cargo test hook_manager --lib

# Run integration tests
cargo test --test auth_hook_integration_tests

# Run with output
cargo test --lib -- --nocapture

# Run specific test
cargo test test_generate_and_validate_token
```

#### 5. Common Testing Patterns

**Async Tests**:
```rust
#[tokio::test]
async fn test_async_operation() {
    let result = async_function().await;
    assert!(result.is_ok());
}
```

**Error Testing**:
```rust
#[test]
fn test_error_handling() {
    let result = dangerous_operation();
    assert!(result.is_err());

    if let Err(e) = result {
        assert_eq!(e.to_string(), "expected error");
    }
}
```

**Mock Testing**:
```rust
#[test]
fn test_with_mock() {
    let mock_service = MockService::new();
    let result = process_with_service(&mock_service);
    assert_eq!(result, "expected");
}
```

#### 6. Red Flags - When You're NOT Doing TDD

❌ **Wrong**: Writing implementation first, then adding tests
❌ **Wrong**: Writing tests that always pass (no assertions)
❌ **Wrong**: Skipping edge case tests ("I'll test later")
❌ **Wrong**: Commenting out failing tests
❌ **Wrong**: Making tests too broad or vague

✅ **Right**: Tests fail initially, then you fix code
✅ **Right**: Each test has clear Arrange-Act-Assert structure
✅ **Right**: Test names describe what they test
✅ **Right**: Tests run quickly (< 1 second each)
✅ **Right**: All tests pass before committing

#### 7. Task Completeness Requirements

**CRITICAL**: Never consider a task "done" until ALL related work is complete.

**Completeness Checklist**:
- [ ] Core functionality implemented
- [ ] Unit tests written AND passing
- [ ] Integration tests written AND passing
- [ ] Documentation updated (code + usage)
- [ ] Examples created (if applicable)
- [ ] Related files updated
- [ ] No TODOs left in code
- [ ] No compilation errors/warnings
- [ ] Edge cases handled
- [ ] Error handling tested

**Example - JWT Authentication Task**:

❌ **Incomplete** (stopping too early):
```
✅ Implemented JWT middleware
✅ Added unit tests (15 passing)
❌ "I'm done!" ← WRONG!
```

✅ **Complete** (all related work):
```
✅ Implemented JWT middleware
✅ Added unit tests (15 passing)
✅ Added integration tests (22 passing)
✅ Protected REST endpoints
✅ Updated HookManager for $jwt injection
✅ Modified JavaScript SDK
✅ Created SWR hooks
✅ Added React examples (auth page, articles page)
✅ Added client-side tests (42 tests)
✅ Wrote design documentation
✅ Wrote usage guides
✅ Updated CLAUDE.md
✅ All 111 tests passing
✅ Zero TODOs remaining
```

**Red Flags - Incomplete Work**:
- ❌ "Tests are passing, I'm done" (What about integration tests?)
- ❌ "Code is working, I'm done" (What about documentation?)
- ❌ "Feature is implemented, I'm done" (What about examples?)
- ❌ "Main function works, I'm done" (What about edge cases?)
- ❌ Leaving TODO comments in code
- ❌ Leaving // FIXME or // HACK comments
- ❌ "I'll document it later"

**Green Flags - Complete Work**:
- ✅ Unit tests AND integration tests passing
- ✅ Documentation created AND updated
- ✅ Examples working AND tested
- ✅ All related files updated
- ✅ No TODOs/FIXMEs remaining
- ✅ Edge cases handled
- ✅ Error cases tested

**When in Doubt**:
Ask yourself: "If this were production code, would I be confident deploying it?"
- If NO → More work needed
- If YES → Task is complete

#### 8. Test Documentation

Each test file should include:
```rust
// Module/Feature Tests
//
// This test suite verifies:
// - Basic functionality
// - Error handling
// - Edge cases
// - Integration scenarios
//
// Test categories:
// - Unit tests: Individual functions
// - Integration tests: Multi-component flows
// - Property tests: Invariant verification (if applicable)
```

### ⚠️ Task Management Rules

**CRITICAL**: Always maintain focus on the primary objective and avoid getting lost in implementation details.

1. **Define the Task First**: Before diving into code changes, clearly identify what you're trying to accomplish
   - Example: "Check if example project uses whitelist configuration" ✅
   - Not: "Fix TypeScript errors and debug browser connections" ❌

2. **Use Task Tracking**: For complex verification tasks, create a task list upfront:
   ```bash
   # Example good workflow:
   - Verify example project uses whitelist queries
   - Check for named_queries.json configuration
   - Verify Rust tests cover whitelist functionality
   - Run example project to confirm end-to-end functionality
   ```

3. **Completion Criteria**: Define when the task is complete before starting
   - Bad: Getting distracted by TypeScript compilation errors
   - Good: Confirming whitelist usage through grep/file checks, then summarizing findings

4. **Avoid Scope Creep**: Don't fall into these traps:
   - Fixing unrelated bugs ("I noticed this error while checking...")
   - Building test infrastructure ("Let me create a comprehensive test suite...")
   - Debugging server issues ("The logs show connection errors...")

5. **Verification vs. Implementation**: 
   - Verification tasks: Use `grep`, `find`, `Read` tools to check code
   - Implementation tasks: Use `Edit`, `Write` tools to modify code
   - Don't mix them without explicit user request

### 🎯 Example: Good Task Execution

**Task**: "检查示例项目是否使用了白名单配置"

**Good Approach**:
```bash
# Step 1: Check source code usage
grep -r "namedQuery" examples/blog-platform/src

# Step 2: Find configuration files
find examples/blog-platform -name "*named*query*"

# Step 3: Verify server integration
grep -r "WHITELIST_CONFIG_PATH" packages/flare-server/src

# Step 4: Check test coverage
ls packages/flare-server/tests/*whitelist*

# Step 5: Summarize findings
```

**Bad Approach** (What happened):
```bash
# ❌ Got distracted by TypeScript errors
npm run build  # Why? User didn't ask to fix build

# ❌ Started debugging server
cargo run -p flare-server  # Why? User only asked to check

# ❌ Created unnecessary test files
# Created test_browser_sdk.html, test_headless.js, etc.

# ❌ Opened browser and screenshots
# Got lost in UI testing
```

### 📋 Post-Task Checklist

After completing a verification task:
- [ ] Did I answer the specific question asked?
- [ ] Have I summarized my findings clearly?
- [ ] Did I avoid going down rabbit holes?
- [ ] Is the information documented for future reference?

Remember: The user asks questions for a reason. Answer that question first, then offer to help with follow-up tasks.

### 🗂️ Temporary File Management

**CRITICAL**: Keep debug/experimental files isolated and never commit them.

**Directory Structure**:
```bash
# ✅ GOOD: Isolated temporary directory
project/.temp/
  demo_*.js           # Temporary demo scripts
  demo_*.png          # Temporary screenshots
  test_*.html         # Temporary test pages
  screenshot.ps1      # Temporary utility scripts

# ❌ BAD: Mixed with source code
project/
  demo_whitelist.js   # Clutters the main directory
  test_browser.html
  my_test_script.sh
```

**Git Configuration**:
```gitignore
# temp debug files (Claude Code temporary testing files)
.temp/
demo_*
test_*.html
screenshot.png
```

**Cleanup Routine**:
- After testing completes: Delete or archive `.temp/` contents
- Before committing: Check for untracked debug files
- After project completion: Remove entire `.temp/` directory

### 🚫 Communication Best Practices

**CRITICAL**: Avoid asking obvious questions. Follow best practices and design documents.

❌ **Wrong**: "需要我继续完成 REST 端点保护吗？" (We have a design document!)
❌ **Wrong**: "您想要我添加什么功能？" (Look at the plan!)
❌ **Wrong**: "应该用什么方法？" (Use best practices!)
❌ **Wrong**: "任务完成了吗？" (Check the task list!)

✅ **Right**: Review design documents and implement according to plan
✅ **Right**: Follow TDD principles - write tests first
✅ **Right**: Complete all related tasks before stopping
✅ **Right**: Use industry best practices - Security, performance, maintainability
✅ **Right**: When genuinely unclear - Ask specific technical questions, not "should I?"

**Task Completion Rule**: 
- ✅ Complete ALL related subtasks before reporting completion
- ✅ If testing is required - write unit tests AND integration tests
- ✅ If documentation is required - write code docs AND usage guides
- ✅ If examples are needed - create working examples with tests
- ❌ NEVER stop halfway through a related feature set
- ❌ NEVER leave TODOs in committed code
- ❌ NEVER say "done" when related tasks are pending

**Decision Framework**:
1. Check if there's a design document → Follow it completely
2. Check if there's a test plan → Implement all tests
3. Check for related files → Update all of them
4. Use industry best practices → Security, performance, maintainability
5. When genuinely unclear → Ask specific technical questions, not "should I?"

**Examples**:
- ❌ "Should I add JWT authentication to REST endpoints?" (Design doc says yes - do ALL endpoints)
- ❌ "I'm done with JWT middleware" (What about integration tests? Documentation? Examples?)
- ✅ "JWT middleware requires the secret from env var, should I use `JWT_SECRET`?" (Specific technical decision)
- ❌ "Do you want me to write tests?" (TDD section says yes - write ALL related tests)
- ✅ "Should integration tests go in `tests/` or inline with modules?" (Specific organizational question)

**Completeness Checklist**:
Before considering a task "done", verify:
- [ ] Core functionality implemented
- [ ] Unit tests written and passing
- [ ] Integration tests written and passing
- [ ] Documentation updated
- [ ] Examples created (if applicable)
- [ ] Related files updated
- [ ] No TODOs left behind
- [ ] No compilation errors or warnings

### 🚫 Communication Best Practices

**CRITICAL**: Avoid asking obvious questions. Follow best practices and design documents.

❌ **Wrong**: "需要我继续完成 REST 端点保护吗？" (We have a design document!)
❌ **Wrong**: "您想要我添加什么功能？" (Look at the plan!)
❌ **Wrong**: "应该用什么方法？" (Use best practices!)

✅ **Right**: Review design documents and implement according to plan
✅ **Right**: Follow TDD principles - write tests first
✅ **Right**: Complete tasks systematically without asking for permission on obvious next steps

**Decision Framework**:
1. Check if there's a design document → Follow it
2. Check if there's a test plan → Implement it
3. Use industry best practices → Security, performance, maintainability
4. When genuinely unclear → Ask specific technical questions, not "should I?"

**Examples**:
- ❌ "Should I add JWT authentication to REST endpoints?" (Design doc says yes)
- ✅ "The JWT middleware needs the secret from env var, should I use `JWT_SECRET`?" (Specific technical decision)
- ❌ "Do you want me to write tests?" (TDD section says yes)
- ✅ "Should integration tests go in `tests/` or inline with modules?" (Specific organizational question)

### 🖼️ Visual Testing vs Text Content

**CRITICAL**: When testing web applications, prefer text content over screenshots.

**Use Text Content (innerText)**:
```javascript
// ✅ GOOD: Extract actual page content
const pageData = await page.evaluate(() => {
  return {
    title: document.title,
    articleCount: document.querySelectorAll('article').length,
    errors: Array.from(document.querySelectorAll('[class*="red"]'))
      .map(el => el.textContent),
    // Specific, searchable, testable data
    articles: Array.from(document.querySelectorAll('article'))
      .slice(0, 3).map(article => ({
        title: article.querySelector('h2')?.textContent,
        author: article.querySelector('.author')?.textContent
      }))
  };
});
```

**NOT Screenshots**:
```javascript
// ❌ AVOID: Screenshots for functional testing
await page.screenshot({ path: 'demo_01_homepage.png' });
// Problems:
// - Not searchable
// - Not testable (can't assert specific values)
// - Waste disk space
// - Can't detect subtle changes
// - Not machine-readable
```

**When to Use Each**:
- **innerText/textContent**: Functional testing, data verification, API testing, debugging
- **Screenshots**: Visual regression testing, user documentation, bug reports with visual context
- **HTML snapshots**: Structural analysis, SEO testing, accessibility testing

**Example Puppeteer Pattern**:
```javascript
// ✅ GOOD: Comprehensive testing without screenshots
const result = await page.evaluate(() => {
  return {
    // Page metadata
    title: document.title,
    url: window.location.href,

    // Functional data
    articleCount: document.querySelectorAll('article').length,
    hasErrors: document.querySelectorAll('[class*="error"]').length > 0,

    // Specific content for verification
    articles: Array.from(document.querySelectorAll('article')).map(article => ({
      title: article.querySelector('h2')?.textContent,
      excerpt: article.querySelector('p')?.textContent?.substring(0, 100)
    })),

    // Error messages
    errors: Array.from(document.querySelectorAll('[class*="red"]'))
      .map(el => el.textContent.trim())
  };
});

// Testable assertions
console.log('✅ Page title:', result.title);
console.log('✅ Article count:', result.articleCount);
console.log('✅ Has errors:', result.hasErrors);
```
