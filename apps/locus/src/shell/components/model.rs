use super::{
    super::{state::Resource, view::*},
    catalog::fact,
};
use gpui_kit::*;
pub fn render(item: &Resource) -> AnyElement {
    let Some(model) = &item.model else {
        return div().into_any_element();
    };
    column()
        .gap_2()
        .child(
            row()
                .child(badge(model.architecture))
                .child(badge(model.precision)),
        )
        .child(
            column()
                .gap_1()
                .child(fact("版本", model.version))
                .child(fact(
                    "用途",
                    if item.name.contains("LoRA") {
                        "风格适配 · LoRA"
                    } else {
                        "基础生成 · Checkpoint"
                    },
                ))
                .child(fact("文件类型", "SafeTensors")),
        )
        .child(
            div()
                .text_size(px(10.))
                .text_color(rgb(MUTED))
                .child("样本参数用于界面演示，不执行模型加载。"),
        )
        .into_any_element()
}
