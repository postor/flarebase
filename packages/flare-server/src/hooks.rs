use flare_protocol::{Event, EventType, Webhook};
use std::sync::Arc;
use tokio::sync::broadcast;
use reqwest::Client;

pub struct EventBus {
    pub sender: broadcast::Sender<Event>,
}

impl EventBus {
    pub fn new() -> (Self, broadcast::Receiver<Event>) {
        let (tx, rx) = broadcast::channel(1024);
        (Self { sender: tx }, rx)
    }

    pub fn emit(&self, event: Event) {
        let _ = self.sender.send(event);
    }
}

pub struct WebhookDispatcher {
    client: Client,
    // Typically we'd fetch webhooks from the DB, but for this MVP 
    // we'll keep a simple list or fetch on-demand.
}

impl WebhookDispatcher {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
        }
    }

    pub async fn run(self, mut rx: broadcast::Receiver<Event>, webhooks_provider: Arc<dyn WebhooksProvider>) {
        tracing::info!("Webhook Dispatcher started");
        while let Ok(event) = rx.recv().await {
            let webhooks = match webhooks_provider.get_webhooks_for_event(&event.event_type).await {
                Ok(w) => w,
                Err(e) => {
                    tracing::error!("Failed to fetch webhooks: {}", e);
                    continue;
                }
            };

            for webhook in webhooks {
                let client = self.client.clone();
                let event_clone = event.clone();
                
                tokio::spawn(async move {
                    tracing::info!("Dispatching event {:?} to {}", event_clone.event_type, webhook.url);
                    let mut req = client.post(&webhook.url).json(&event_clone);
                    
                    if let Some(secret) = &webhook.secret {
                        req = req.header("X-Flare-Secret", secret);
                    }

                    match req.send().await {
                        Ok(res) => {
                            if !res.status().is_success() {
                                tracing::warn!("Webhook {} returned status {}", webhook.url, res.status());
                            }
                        }
                        Err(e) => {
                            tracing::error!("Failed to dispatch webhook to {}: {}", webhook.url, e);
                        }
                    }
                });
            }
        }
    }
}

use async_trait::async_trait;

#[async_trait]
pub trait WebhooksProvider: Send + Sync {
    async fn get_webhooks_for_event(&self, event_type: &EventType) -> anyhow::Result<Vec<Webhook>>;
}
