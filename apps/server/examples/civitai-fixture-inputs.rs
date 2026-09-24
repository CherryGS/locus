use serde_json::json;
use std::path::PathBuf;
fn main() -> anyhow::Result<()> {
    let root = PathBuf::from(
        std::env::args_os()
            .nth(1)
            .ok_or_else(|| anyhow::anyhow!("Expected isolated fixture directory"))?,
    );
    anyhow::ensure!(root.is_absolute(), "Expected absolute fixture directory");
    std::fs::create_dir_all(&root)?;
    let preview = root.join("managed-example.png");
    let mut image = image::RgbImage::new(320, 240);
    for (x, y, pixel) in image.enumerate_pixels_mut() {
        *pixel = image::Rgb([(x % 255) as u8, (y % 255) as u8, 120]);
    }
    image.save(&preview)?;
    let example = json!({"id":901,"url":"https://image.civitai.com/controlled/example.png","type":"image","width":320,"height":240});
    let mut cases = Vec::new();
    let mut lookups = serde_json::Map::new();
    for (name, version, file) in [
        ("A", 10, 100),
        ("B", 30, 300),
        ("C", 30, 301),
        ("existing", 10, 102),
    ] {
        let header = serde_json::to_vec(
            &json!({"__metadata__":{"name":name},"weight":{"dtype":"F32","shape":[1],"data_offsets":[0,4]}}),
        )?;
        let mut bytes = (header.len() as u64).to_le_bytes().to_vec();
        bytes.extend(header);
        bytes.extend([0; 4]);
        let path = root.join(format!("{name}.safetensors"));
        std::fs::write(&path, &bytes)?;
        let hash = blake3::hash(&bytes).to_hex().to_string();
        let matched = json!({"id":version,"modelId":1,"name":format!("Version {version} from {name}"),"description":format!("<p>{name} version description</p>"),"baseModel":"Synthetic","files":[{"id":file,"name":format!("{name}.safetensors"),"type":"Model","hashes":{"BLAKE3":hash}}],"images":[example.clone()]});
        let roster = if name == "A" {
            vec![
                matched.clone(),
                json!({"id":20,"modelId":1,"name":"A listed version","files":[],"images":[]}),
            ]
        } else if name == "existing" {
            vec![matched.clone()]
        } else {
            vec![
                matched.clone(),
                json!({"id":40,"modelId":1,"name":"Peer merely listed; excluded from A","files":[],"images":[]}),
            ]
        };
        let model = json!({"id":1,"name":"Saved model atlas","type":"Checkpoint","description":format!("<p>{name} independent model description</p><img src='https://invalid.example/unadmitted.png' onerror='alert(1)'><script>alert(2)</script>"),"tags":["synthetic","local fixture"],"modelVersions":roster});
        lookups.insert(hash.clone(), matched);
        cases.push(json!({"name":name,"path":path,"hash":hash,"model":model}));
    }
    let config = json!({"lookups":lookups,"models":{"1":cases[0]["model"].clone()},"examples":{"https://image.civitai.com/controlled/example.png":preview}});
    let config_path = root.join("provider.json");
    std::fs::write(&config_path, serde_json::to_vec(&config)?)?;
    println!("{}", json!({"config":config_path,"cases":cases}));
    Ok(())
}
