use super::{
    bootstrap::{Ready, validate_credential},
    composition::{Domain, Library},
    registry::{ServerConfig, Shared, initial_registry},
};
use crate::api::routes;
use anyhow::{Context, bail};
use locus_task::api::TaskQueue;
use std::sync::{Arc, Mutex};
use tokio::{net::TcpListener, sync::watch};

pub struct Server {
    external_listener: Option<TcpListener>,
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
        let root = config.library_root.clone();
        let require_existing = config.require_existing;
        let ownership = Arc::new(
            tokio::task::spawn_blocking(move || {
                super::ownership::LibraryOwnership::acquire(&root, require_existing)
            })
            .await
            .context("Library ownership worker failed")??,
        );
        // Startup owns its guard independently of the caller's wait. Every
        // initialization TaskHandle is awaited to actual protected completion,
        // even when a caller abandons Server::bind. An unclaimed finished Server
        // is then dropped without publishing readiness or opening admissions.
        tokio::spawn(Self::bind_owned(config, ownership))
            .await
            .context("Backend construction task failed")?
    }
    async fn bind_owned(
        config: ServerConfig,
        ownership: Arc<super::ownership::LibraryOwnership>,
    ) -> anyhow::Result<Self> {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .context("bind IPv4 loopback")?;
        let origin = format!("http://{}", listener.local_addr()?);
        let queue = TaskQueue::new();
        let library = Library::open(
            &queue,
            ownership.root(),
            #[cfg(test)]
            config.startup_probe,
        )
        .await?;
        let (domain, availability) = match Domain::open(&queue, &library).await {
            Ok(mut domain) => {
                if let Some(upstream) = config.civitai_upstream {
                    domain.civitai = locus_civitai::api::CivitaiService::with_upstream(upstream);
                }
                (Some(domain), crate::api::dto::Availability::Normal)
            }
            Err(error) => (
                None,
                crate::api::dto::Availability::Restricted {
                    message: format!("Required library services could not start: {error:#}"),
                },
            ),
        };
        let database = library.database.clone();
        let credential = if domain.is_some() {
            queue
                .submit("Initialize external access", move |task| async move {
                    let mut session = database.session(&task).await?;
                    session
                        .transaction_named("Establish library external credential", |c| {
                            Box::pin(crate::access::persistence::initialize(c))
                        })
                        .await
                })?
                .result()
                .await?
        } else {
            Err(anyhow::anyhow!(
                "External access is unavailable during restricted repair"
            ))
        };
        let mut external_runtime = crate::api::external::dto::ExternalRuntime {
            captured: domain.as_ref().map(|d| d.external_settings.clone()),
            active_address: None,
            override_address: config.external_address_override.map(|a| a.to_string()),
            problem: None,
        };
        let external_listener = if let Some(domain) = &domain {
            let settings: crate::access::settings::ExternalAddress =
                serde_json::from_value(domain.external_settings.value.clone())?;
            let address = config
                .external_address_override
                .unwrap_or(settings.address.parse()?);
            if !address.ip().is_loopback() {
                bail!("External test override must be loopback");
            }
            match TcpListener::bind(address).await {
                Ok(listener) => {
                    external_runtime.active_address = Some(listener.local_addr()?.to_string());
                    Some(listener)
                }
                Err(e) => {
                    external_runtime.problem = Some(format!("Could not bind {address}: {e}"));
                    None
                }
            }
        } else {
            external_runtime.problem = Some("Required configuration is unavailable".into());
            None
        };
        let state = Arc::new(Shared {
            civitai: super::civitai::CivitaiOperationsStore::default(),
            _ownership: ownership,
            uploads: crate::access::uploads::Uploads::default(),
            stopping: watch::channel(false).0,
            access: crate::access::state::AccessState::new(credential, external_runtime),
            imports: crate::imports::ImportStore::default(),
            credential: config.credential,
            origin,
            run_id: uuid::Uuid::now_v7().to_string(),
            queue,
            domain,
            library,
            availability,
            registry: Mutex::new(initial_registry()),
            changes: watch::channel(0).0,
            drained: watch::channel(false).0,
        });
        let router = routes::router(state.clone(), config.renderer_root).await?;
        Ok(Self {
            external_listener,
            state,
            listener,
            router,
        })
    }
    pub fn ready(&self) -> Ready {
        Ready {
            origin: self.state.origin.clone(),
            run_id: self.state.run_id.clone(),
            library_root: self.state.library.files.root().to_path_buf(),
            availability: self.state.availability.clone(),
        }
    }
    pub fn router(&self) -> axum::Router {
        self.router.clone()
    }
    pub fn close_admission(&self) {
        self.state.close();
    }
    pub async fn serve(mut self) -> anyhow::Result<()> {
        let external_router = crate::api::external::routes::router(self.state.clone());
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
                accepted = async { match &self.external_listener {Some(listener)=>listener.accept().await,None=>std::future::pending().await} } => {
                    match accepted {
                        Ok((socket,_))=> {
                            let service=hyper_util::service::TowerToHyperService::new(external_router.clone());
                            connections.spawn(async move {let _=hyper::server::conn::http1::Builder::new().serve_connection(hyper_util::rt::TokioIo::new(socket),service).await;});
                        }
                        Err(error)=> {self.external_listener=None;let mut runtime=self.state.access.runtime.lock().unwrap_or_else(|e|e.into_inner());runtime.active_address=None;runtime.problem=Some(format!("External listener stopped: {error}"));}
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
        drop(self.external_listener);
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
