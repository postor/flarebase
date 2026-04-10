# Flarebase JWT Usage Examples

This directory contains practical examples for using Flarebase with JWT authentication in different environments.

## 📁 Examples Structure

```
examples/
├── browser-jwt/          # Browser-based example
│   ├── index.html        # Demo web application
│   ├── flare-client.js   # Browser-compatible SDK
│   └── README.md         # Browser setup instructions
├── node-jwt/            # Node.js example
│   ├── example.js        # Command-line demo
│   └── README.md         # Node.js setup instructions
└── README.md            # This file
```

## 🚀 Quick Start

### 1. Start the Flarebase Server

```bash
cd packages/flare-server
cargo run
```

The server will start on `http://localhost:3000`

### 2. Register an Auth Hook

The auth hook must be registered to handle login/register requests. See the [Auth Hook Protocol](../../docs/features/HOOKS_PROTOCOL.md) for details.

### 3. Choose Your Environment

## 🌐 Browser Example

### Running the Browser Demo

1. **Serve the HTML file**:
   ```bash
   # Using Python
   cd examples/browser-jwt
   python -m http.server 8080

   # Or using Node.js
   npx http-server -p 8080
   ```

2. **Open in browser**:
   ```
   http://localhost:8080
   ```

3. **Test the features**:
   - Register a new account
   - Login with credentials
   - View authenticated user info
   - Logout and test unauthenticated access

### Browser Example Features

- ✅ User registration with form validation
- ✅ Login with JWT authentication
- ✅ Automatic JWT storage (localStorage)
- ✅ User info display
- ✅ Logout functionality
- ✅ Responsive design

### Code Example

```javascript
import { FlareClient } from './flare-client.js';

const client = new FlareClient('http://localhost:3000');

// Register
const result = await client.register({
    name: 'John Doe',
    email: 'john@example.com',
    password: 'secure_password'
});

console.log('User:', result.user);
console.log('Token:', result.token);

// Create documents (JWT automatically included)
const post = await client.collection('posts').add({
    title: 'Hello World',
    content: 'My first post!'
});
```

## 💻 Node.js Example

### Running the Node.js Demo

1. **Install dependencies**:
   ```bash
   npm install @flarebase/sdk
   ```

2. **Run the example**:
   ```bash
   cd examples/node-jwt
   node example.js
   ```

### Node.js Example Features

- ✅ User registration
- ✅ Login with JWT authentication
- ✅ CRUD operations with JWT
- ✅ Named query execution
- ✅ Error handling
- ✅ Comprehensive output logging

### Code Example

```javascript
const { FlareClient } = require('@flarebase/sdk');

const client = new FlareClient('http://localhost:3000');

// Login
const result = await client.login({
    email: 'user@example.com',
    password: 'password'
});

// Check authentication status
console.log('Is authenticated:', client.isAuthenticated());
console.log('Current user:', client.getCurrentUser());

// Create document (JWT automatically included)
const post = await client.collection('posts').add({
    title: 'My Post',
    content: 'Post content'
});

// Execute named query
const myPosts = await client.namedQuery('list_my_posts', {});
```

## 🔑 Key Features Demonstrated

### JWT Authentication

1. **Token Generation**: Server generates JWT on successful auth
2. **Token Storage**: Client stores JWT automatically
3. **Token Injection**: JWT automatically added to all requests
4. **Token Validation**: Server validates JWT on protected endpoints

### Protected Endpoints

- ✅ `/collections/*` - Require JWT
- ✅ `/queries/:name` - Require JWT
- ✅ `/transaction` - Require JWT
- ✅ `/call_hook/:event` - Require JWT

### Public Endpoints

- ✅ `/health` - Health check (no auth)
- ✅ `/call_hook/auth` - Login/Register (no auth required)

## 📖 Common Patterns

### 1. Authentication Flow

```javascript
// 1. Login
const result = await client.login({
    email: 'user@example.com',
    password: 'password'
});

// 2. Check if authenticated
if (client.isAuthenticated()) {
    console.log('Logged in as', client.getCurrentUser().name);
}

// 3. Make authenticated requests
const posts = await client.collection('posts').get();

// 4. Logout
client.logout();
```

### 2. Error Handling

```javascript
try {
    const user = await client.login({ email, password });
    console.log('Success:', user);
} catch (error) {
    if (error.message.includes('INVALID_CREDENTIALS')) {
        console.error('Invalid email or password');
    } else {
        console.error('Login failed:', error.message);
    }
}
```

### 3. Named Queries with SWR

```javascript
import useSWR from 'swr';

const fetcher = (url) => {
    return fetch(url, {
        headers: {
            'Authorization': `Bearer ${client.jwt}`,
            'Content-Type': 'application/json'
        },
        method: 'POST',
        body: JSON.stringify({})
    }).then(r => r.json());
};

function MyPosts() {
    const { data, error } = useSWR('/queries/list_my_posts', fetcher);

    if (error) return <div>Error loading posts</div>;
    if (!data) return <div>Loading...</div>;

    return <div>{data.map(post => <Post key={post.id} {...post} />)}</div>;
}
```

## 🔒 Security Considerations

### Token Storage

- **Browser**: localStorage (can be upgraded to httpOnly cookies)
- **Node.js**: Memory or environment variables

### Token Expiration

- Default: 1 hour
- Configurable via `TOKEN_EXPIRATION_HOURS` in `jwt_middleware.rs`

### Best Practices

1. ✅ Always use HTTPS in production
2. ✅ Implement token refresh mechanism
3. ✅ Validate tokens on every request
4. ✅ Handle token expiration gracefully
5. ✅ Never log tokens or sensitive data

## 🐛 Troubleshooting

### Common Issues

1. **"Connection refused"**
   - Make sure Flarebase server is running
   - Check the server URL is correct

2. **"Unauthorized" errors**
   - Check that JWT is being sent
   - Verify token hasn't expired
   - Ensure auth hook is registered

3. **"Hook not registered"**
   - Register the auth hook service
   - Check server logs for hook registration status

4. **CORS errors**
   - Ensure CORS is configured on server
   - Check origin is allowed in server config

## 📚 Additional Resources

- [JWT Auth Design](../../docs/security/JWT_AUTH_DESIGN.md)
- [Hook Protocol](../../docs/features/HOOKS_PROTOCOL.md)
- [Security Overview](../../docs/core/SECURITY.md)
- [TDD Guidelines](../../CLAUDE.md)

## 🤝 Contributing

To add more examples:

1. Create a new directory in `examples/`
2. Add a `README.md` with setup instructions
3. Include working code examples
4. Update this `README.md` with a link

## 📝 License

These examples are part of the Flarebase project.
