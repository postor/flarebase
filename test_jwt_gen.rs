use jsonwebtoken::{encode, Header, EncodingKey};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    sub: String,
    email: String,
    role: String,
    iat: u64,
    exp: u64,
}

fn main() {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let claims = Claims {
        sub: "admin-test".to_string(),
        email: "admin@test.com".to_string(),
        role: "admin".to_string(),
        iat: now,
        exp: now + 3600,
    };

    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(b"flare_secret_key_change_in_production"),
    ).unwrap();

    println!("{}", token);
}
