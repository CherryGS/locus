use super::state::*;

pub fn resources() -> Vec<Resource> {
    let definitions = [
        (
            "雾山来信",
            "Misty mountains · 001",
            "自然与风景",
            0,
            0x90bba8,
        ),
        ("琥珀海岸", "Golden coast · 002", "自然与风景", 1, 0xdab788),
        ("蓝调城市", "After hours · 003", "建筑与空间", 2, 0x859fd5),
        ("月下沙丘", "Lunar dunes · 004", "自然与风景", 3, 0xc6a3b8),
        ("森间微光", "Forest study · 005", "自然与风景", 4, 0x9db59a),
        ("静物习作", "Still life · 006", "创作练习", 5, 0xdbac8f),
        (
            "FLUX.1 · dev",
            "Checkpoint · 23.8 GB",
            "模型实验室",
            0,
            0x90bba8,
        ),
        ("光影胶片 LoRA", "LoRA · 218 MB", "模型实验室", 1, 0xdab788),
        (
            "SDXL · Base 1.0",
            "Checkpoint · 6.94 GB",
            "模型实验室",
            2,
            0x859fd5,
        ),
        ("雨后街角", "Rain studies · 010", "建筑与空间", 2, 0x859fd5),
        (
            "未完成的风景",
            "Metadata pending · 011",
            "自然与风景",
            3,
            0xc6a3b8,
        ),
        ("建筑线条 LoRA", "LoRA · 144 MB", "模型实验室", 5, 0xdbac8f),
    ];
    definitions.into_iter().enumerate().map(|(id, (name, subtitle, collection, artwork, color))| {
        let model = [6, 7, 8, 11].contains(&id);
        Resource {
            id, name, subtitle, collection, artwork, color,
            category: if model { Category::Model } else { Category::Image },
            favorite: [0, 1, 6, 7].contains(&id),
            issue: match id { 10 => Some("生成信息不完整：缺少模型名称和采样参数。"), 11 => Some("来源记录尚未关联版本，模型信息需要补充。"), _ => None },
            file: Some(FileFacts { filename: format!("{}.{extension}", subtitle.split(" · ").next().unwrap_or("resource").replace(' ', "_"), extension = if model { "safetensors" } else { "png" }), format: if model { "SafeTensors" } else { "PNG" }, size: if model { match id { 6 => "23.8 GB", 8 => "6.94 GB", 11 => "144 MB", _ => "218 MB" } } else { "4.82 MB" } }),
            image: (!model).then_some(ImageFacts { dimensions: if id == 2 { "1536 × 1024" } else { "1344 × 896" }, color: "sRGB · RGB · 8 bit" }),
            generation: (!model && id != 10).then_some(GenerationFacts { prompt: match artwork { 0 => "Layered mountains at dawn, quiet mist, soft sage tones, fine art landscape, cinematic natural light.", 1 => "Golden coastal cliffs, an open sea, warm evening light, minimal composition, atmospheric depth.", 2 => "Modern city at blue hour, geometric architecture, glowing windows, reflections, cinematic mood.", 3 => "Moonlit desert, sculptural dunes, dusty rose and violet, peaceful, wide composition.", 4 => "Sunlight through a deep forest, emerald canopy, floating dust, soft natural light.", _ => "Ceramic vessels, warm terracotta, soft studio shadows, calm still life, minimal composition." }, model: "FLUX.1 · dev", seed: "284710936" }),
            model: model.then_some(ModelFacts { architecture: if id == 8 { "SDXL" } else { "FLUX.1" }, version: if id == 11 { "尚未关联" } else { "v1.0" }, precision: if id == 6 { "BF16" } else { "FP16" } }),
            source: (id != 5).then_some(SourceFacts { name: if model { "模型参考集" } else { "创作工作室" }, reference: if model { "模型实验 / 示例来源记录" } else { "九月灵感 / 本地创作样本" }, status: if id == 11 { "信息待补充" } else { "示例记录已关联" } }),
            note: if id == 0 { "喜欢这组雾气的层次。下次尝试更低的饱和度，保留山脊的冷暖对比。".into() } else { String::new() },
            tags: if model { vec!["模型".into(), "待试用".into()] } else { vec![collection.into(), "灵感".into()] },
        }
    }).collect()
}
