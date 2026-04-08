use clap::{Parser, Subcommand};
use reqwest::Client;
use serde_json::Value;

#[derive(Parser)]
#[command(name = "flare-cli")]
#[command(about = "Flarebase Admin CLI", long_about = None)]
struct Cli {
    #[arg(short, long, default_value = "http://localhost:3000")]
    server: String,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// List documents in a collection
    List { collection: String },
    /// Create a document
    Create {
        collection: String,
        #[arg(short, long)]
        data: String,
    },
    /// Delete a document
    Delete { collection: String, id: String },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let client = Client::new();

    match cli.command {
        Commands::List { collection } => {
            let url = format!("{}/dbs/{}/docs", cli.server, collection);
            let res = client.get(url).send().await?.json::<Value>().await?;
            println!("{}", serde_json::to_string_pretty(&res)?);
        }
        Commands::Create { collection, data } => {
            let url = format!("{}/dbs/{}/docs", cli.server, collection);
            let json_data: Value = serde_json::from_str(&data)?;
            let res = client.post(url).json(&json_data).send().await?.json::<Value>().await?;
            println!("Created: {}", serde_json::to_string_pretty(&res)?);
        }
        Commands::Delete { collection, id } => {
            let url = format!("{}/dbs/{}/docs/{}", cli.server, collection, id);
            let _ = client.delete(url).send().await?;
            println!("Deleted: {}", id);
        }
    }

    Ok(())
}
