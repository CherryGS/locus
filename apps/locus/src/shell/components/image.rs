use super::{
    super::{state::Resource, view::*},
    catalog::fact,
};
use gpui_kit::*;
pub fn render(item: &Resource) -> AnyElement {
    let Some(image) = &item.image else {
        return div().into_any_element();
    };
    column()
        .gap_1()
        .child(fact("分辨率", image.dimensions))
        .child(fact("色彩", image.color))
        .child(fact("方向", "横向 · 3:2"))
        .child(fact("预览", "内置原创插画"))
        .into_any_element()
}
