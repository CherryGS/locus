use super::{
    super::{state::Resource, view::*},
    catalog::fact,
};
use gpui_kit::*;
pub fn render(item: &Resource) -> AnyElement {
    let Some(source) = &item.source else {
        return div().into_any_element();
    };
    column()
        .gap_1()
        .child(fact("来源", source.name))
        .child(fact("参考记录", source.reference))
        .child(fact("状态", source.status))
        .child(fact("记录日期", "2026-09-19"))
        .into_any_element()
}
