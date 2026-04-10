# CORS Configuration

Flarebase supports flexible CORS configuration through a JSON configuration file.

## Configuration File

By default, Flarebase looks for `cors_config.json` in the current directory. You can override this with the `CORS_CONFIG_PATH` environment variable.

```bash
CORS_CONFIG_PATH=/path/to/cors_config.json cargo run -p flare-server
```

## Configuration Structure

```json
{
  "allowed_origins": [
    "http://localhost:3000",
    "https://example.com"
  ],
  "allowed_methods": [
    "GET",
    "POST",
    "PUT",
    "DELETE",
    "PATCH",
    "OPTIONS"
  ],
  "allowed_headers": [
    "content-type",
    "authorization",
    "x-requested-with",
    "accept"
  ],
  "allow_credentials": true,
  "max_age_secs": 3600
}
```

## Fields

### `allowed_origins` (array of strings)
List of allowed origin URLs. Use `*` for wildcard (allows any origin).
- Empty array → Allows any origin
- `["*"]` → Allows any origin (same as empty)
- Specific origins → Only allows listed origins

### `allowed_methods` (array of strings)
HTTP methods to allow. Default: `["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]`

### `allowed_headers` (array of strings)
HTTP headers to allow in requests. Default: `["content-type", "authorization", "x-requested-with", "accept"]`

### `allow_credentials` (boolean)
Allow credentials (cookies, authorization headers). Default: `true`

### `max_age_secs` (integer)
Preflight request cache duration in seconds. Default: `3600` (1 hour)

## Examples

### Development Mode
```json
{
  "allowed_origins": [
    "http://localhost:3000",
    "http://127.0.0.1:3000"
  ],
  "allowed_methods": ["GET", "POST", "PUT", "DELETE", "PATCH"],
  "allowed_headers": ["*"],
  "allow_credentials": true,
  "max_age_secs": 3600
}
```

### Production Mode
```json
{
  "allowed_origins": [
    "https://myapp.com",
    "https://www.myapp.com"
  ],
  "allowed_methods": ["GET", "POST", "PUT", "DELETE"],
  "allowed_headers": ["content-type", "authorization"],
  "allow_credentials": true,
  "max_age_secs": 7200
}
```

### Public API (No Credentials)
```json
{
  "allowed_origins": ["*"],
  "allowed_methods": ["GET", "POST"],
  "allowed_headers": ["*"],
  "allow_credentials": false,
  "max_age_secs": 3600
}
```

## Default Behavior

If no configuration file is found, Flarebase uses these defaults:
- Origins: Any (empty array)
- Methods: GET, POST, PUT, DELETE, PATCH, OPTIONS
- Headers: content-type, authorization, x-requested-with, accept
- Credentials: true
- Max age: 3600 seconds

## Testing

Run CORS configuration tests:
```bash
cargo test --test cors_config_tests
cargo test --test cors_integration_tests
```

## Security Notes

⚠️ **Warning**: Be careful with `allow_credentials: true` and wildcard origins:
- Using credentials with wildcard origins (`*`) is not recommended in production
- Always specify exact origins when credentials are enabled
- Use shorter `max_age_secs` in development for easier testing
