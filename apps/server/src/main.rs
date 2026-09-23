use anyhow::{Context, bail};
use locus_server::api::{Bootstrap, Server, StartupFailure, openapi};
use std::io::{IsTerminal, Write};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.first().is_some_and(|arg| arg == "export-openapi") && args.len() == 2 {
        std::fs::write(&args[1], format!("{}\n", openapi()?.to_pretty_json()?))
            .context("write OpenAPI output")?;
        return Ok(());
    }
    if args.first().is_some_and(|arg| arg == "export-settings") && args.len() == 2 {
        std::fs::write(
            &args[1],
            format!(
                "{}\n",
                serde_json::to_string_pretty(&locus_server::api::settings_definitions()?)?
            ),
        )?;
        return Ok(());
    }
    if !args.is_empty() {
        bail!("usage: locus-server [export-openapi PATH | export-settings PATH]");
    }
    if std::io::stdin().is_terminal() {
        bail!(
            "startup requires a private JSON bootstrap pipe; use just server-smoke for a demonstration"
        );
    }
    let config = Bootstrap::read(std::io::stdin().lock())?.into_config()?;
    let server = match Server::bind(config).await {
        Ok(server) => server,
        Err(error) => {
            if let Some(failure) = StartupFailure::from_error(&error) {
                writeln!(
                    std::io::stdout().lock(),
                    "{}",
                    serde_json::to_string(&failure)?
                )?;
                std::io::stdout().flush()?;
            }
            return Err(error);
        }
    };
    // stdout carries readiness or the bounded private failure reason, never
    // arbitrary diagnostics, library contents or credentials.
    writeln!(
        std::io::stdout().lock(),
        "{}",
        serde_json::to_string(&server.ready())?
    )?;
    std::io::stdout().flush()?;
    server.serve().await
}
