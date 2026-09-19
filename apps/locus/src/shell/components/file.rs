use super::{
    super::{state::Resource, view::*},
    catalog::fact,
};
use gpui_kit::*;
pub fn render(item: &Resource) -> AnyElement {
    let Some(file) = &item.file else {
        return div().into_any_element();
    };
    column()
        .gap_1()
        .child(fact("文件名", file.filename.clone()))
        .child(fact("格式", file.format))
        .child(fact("大小", file.size))
        .child(fact("位置", format!("示例资源 / {}", item.collection)))
        .child(
            div()
                .mt_2()
                .text_size(px(10.))
                .text_color(rgb(MUTED))
                .child("演示文件信息 · 不读取本地磁盘"),
        )
        .into_any_element()
}
