use super::{
    super::{state::Resource, view::*},
    catalog::fact,
};
use gpui_kit::*;
pub fn render(item: &Resource) -> AnyElement {
    let Some(generation) = &item.generation else {
        return div().into_any_element();
    };
    column()
        .gap_2()
        .child(eyebrow("正向提示词"))
        .child(
            div()
                .p_3()
                .rounded_md()
                .bg(rgb(BG))
                .text_size(px(11.))
                .child(generation.prompt),
        )
        .child(
            column()
                .gap_1()
                .child(fact("模型", generation.model))
                .child(fact("随机种子", generation.seed))
                .child(fact("采样器", "Euler · 28 steps"))
                .child(fact("引导强度", "3.5")),
        )
        .into_any_element()
}
