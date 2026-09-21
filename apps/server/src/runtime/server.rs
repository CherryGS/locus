use super::{
    bootstrap::{Ready, validate_credential},
    composition::Domain,
    registry::{ServerConfig, Shared, initial_registry},
};
use crate::api::routes;
use anyhow::{Context, bail};
use locus_task::api::TaskQueue;
use std::sync::{Arc, Mutex};
use tokio::{net::TcpListener, sync::watch};

pub struct Server {
    pub(super) state: Arc<Shared>,
    listener: TcpListener,
    router: axum::Router,
}
impl Server {
    pub async fn bind(config: ServerConfig) -> anyhow::Result<Self> {
        validate_credential(&config.credential)?;
        if !config.library_root.is_absolute() {
            bail!("invalid server configuration");
        }
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .context("bind IPv4 loopback")?;
        let origin = format!("http://{}", listener.local_addr()?);
        let queue = TaskQueue::new();
        let domain = Domain::open(&queue, &config.library_root).await?;
        let state = Arc::new(Shared {
            credential: config.credential,
            origin,
            run_id: uuid::Uuid::now_v7().to_string(),
            queue,
            domain,
            registry: Mutex::new(initial_registry()),
            changes: watch::channel(0).0,
            drained: watch::channel(false).0,
        });
        let router = routes::router(state.clone(), config.renderer_root).await?;
        Ok(Self {
            state,
            listener,
            router,
        })
    }
    pub fn ready(&self) -> Ready {
        Ready {
            origin: self.state.origin.clone(),
            run_id: self.state.run_id.clone(),
        }
    }
    pub fn router(&self) -> axum::Router {
        self.router.clone()
    }
    pub fn close_admission(&self) {
        self.state.close();
    }
    pub async fn serve(self) -> anyhow::Result<()> {
        let mut connections = tokio::task::JoinSet::new();
        let signal = tokio::signal::ctrl_c();
        tokio::pin!(signal);
        let mut signal_received = false;
        let mut serve_error = None;
        loop {
            tokio::select! {
                biased;
                () = self.state.wait_drained() => break,
                result = &mut signal, if !signal_received => {
                    signal_received = true;
                    if let Err(error) = result { serve_error = Some(anyhow::Error::new(error).context("monitor Ctrl-C")); }
                    self.state.close();
                }
                accepted = self.listener.accept() => {
                    match accepted {
                        Ok((socket, _)) => {
                            let service = hyper_util::service::TowerToHyperService::new(self.router.clone());
                            connections.spawn(async move {
                                let _ = hyper::server::conn::http1::Builder::new()
                                    .serve_connection(hyper_util::rt::TokioIo::new(socket), service).await;
                            });
                        }
                        Err(error) => {
                            serve_error = Some(anyhow::Error::new(error).context("accept loopback connection"));
                            self.state.close();
                            self.state.wait_drained().await;
                            break;
                        }
                    }
                }
                completed = connections.join_next(), if !connections.is_empty() => {
                    if let Some(Err(error)) = completed {
                        serve_error = Some(anyhow::Error::new(error).context("HTTP connection task failed"));
                        self.state.close();
                    }
                },
            }
        }
        drop(self.listener);
        // Accepted work has finished. Give final HTTP/SSE responses a bounded
        // flush window, then abort owned passive connections, even when peers
        // stop reading or send an unfinished request body. No domain work is
        // attached to these connection futures.
        if tokio::time::timeout(std::time::Duration::from_secs(1), async {
            while connections.join_next().await.is_some() {}
        })
        .await
        .is_err()
        {
            connections.abort_all();
            while connections.join_next().await.is_some() {}
        }
        match serve_error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
}
