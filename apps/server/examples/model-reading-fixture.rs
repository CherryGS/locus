use locus_core::api::{Kernel, Membership};
use locus_file::api::{FILE_KIND, FileOwner, FileService};
use locus_model::api::{MODEL_KIND, ModelOwner, ModelService};
use locus_store::api::Session;
use std::{path::PathBuf, sync::Arc};
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let root = PathBuf::from(
        std::env::args_os()
            .nth(1)
            .ok_or_else(|| anyhow::anyhow!("expected new absolute fixture root"))?,
    );
    anyhow::ensure!(
        root.is_absolute() && !root.join("metadata.sqlite").exists(),
        "fixture requires a new absolute library"
    );
    let files = FileService::new(&root).await?;
    let mut s = Session::open(root.join("metadata.sqlite")).await?;
    let mut k = Kernel::new();
    k.register(Arc::new(FileOwner))?;
    k.register(Arc::new(ModelOwner))?;
    let m = ModelService::new();
    locus_migration::api::migrate(&mut s).await?;
    let mut entries = Vec::new();
    for name in [
        "complete",
        "metadata-absent",
        "metadata-empty",
        "uninspected",
        "first-failure",
        "retained-failure",
        "changed-input",
        "large",
    ] {
        let e = k.create_entity(&mut s).await?;
        let id = m.create(&k, &mut s).await?;
        k.attach(
            &mut s,
            Membership {
                entity: e,
                kind: MODEL_KIND,
                component: id.component(),
            },
        )
        .await?;
        let mut header = serde_json::Map::new();
        if name != "metadata-absent" {
            header.insert("__metadata__".into(),if name=="metadata-empty"{serde_json::json!({})}else{serde_json::json!({"name":"Synthetic weight sample","architecture":"A file-provided claim, not inferred","notes":if name=="large"{"extended declaration ".repeat(10000)}else{"Local synthetic fixture".into()}})});
        }
        let count = if name == "large" { 10000 } else { 3 };
        for i in 0..count {
            header.insert(format!("layer_{i:05}.weight"),serde_json::json!({"dtype":if name=="first-failure"{"UNKNOWN"}else{"F16"},"shape":[0,if i==2 {9_007_199_254_740_993u64}else{64}],"data_offsets":[0,0]}));
        }
        let h = serde_json::to_vec(&header)?;
        let mut b = (h.len() as u64).to_le_bytes().to_vec();
        b.extend(&h);
        let p = root.join(format!("fixture-{name}.bin"));
        std::fs::write(&p, &b)?;
        let f = files.admit(&k, &mut s, &p).await?;
        let fm = Membership {
            entity: e,
            kind: FILE_KIND,
            component: f.id.component(),
        };
        k.attach(&mut s, fm).await?;
        if name != "uninspected" {
            m.inspect(&k, &files, &mut s, id).await?;
        }
        if name == "retained-failure" {
            k.detach(&mut s, fm).await?;
            m.inspect(&k, &files, &mut s, id).await?;
            k.attach(&mut s, fm).await?;
        }
        if name == "changed-input" {
            k.detach(&mut s, fm).await?;
            let another = files.admit(&k, &mut s, &p).await?;
            k.attach(
                &mut s,
                Membership {
                    entity: e,
                    kind: FILE_KIND,
                    component: another.id.component(),
                },
            )
            .await?;
        }
        entries.push(serde_json::json!({"name":name,"entityId":e.to_string(),"componentId":id.component().to_string(),"fileId":f.id.to_string(),"headerBytes":h.len(),"tensorCount":count}));
    }
    println!("{}", serde_json::json!({"entries":entries}));
    Ok(())
}
