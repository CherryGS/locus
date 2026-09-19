use super::{
    state::{Library, Scope},
    view::*,
};
use gpui_kit::{
    assets::IconName,
    component::{
        Sizable,
        button::{Button, ButtonVariants},
    },
    prelude::FluentBuilder as _,
    *,
};

impl Shell {
    pub fn navigation(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let mut navigation = column()
            .size_full()
            .gap_0()
            .bg(rgb(0x1c2025))
            .border_r_1()
            .border_color(rgb(LINE))
            .child(
                column()
                    .p_5()
                    .gap_1()
                    .child(
                        row()
                            .gap_3()
                            .child(
                                div()
                                    .size(px(28.))
                                    .rounded_lg()
                                    .bg(rgb(ACCENT))
                                    .text_color(rgb(BG))
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .font_weight(FontWeight::BOLD)
                                    .child("L"),
                            )
                            .child(
                                div()
                                    .text_size(px(21.))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child("Locus"),
                            ),
                    )
                    .child(
                        div()
                            .pl(px(40.))
                            .text_color(rgb(MUTED))
                            .text_size(px(10.))
                            .child("你的创作，井然有序"),
                    ),
            )
            .child(div().px_4().pt_4().pb_2().child(eyebrow("资源库")));
        for (scope, icon) in [
            (Scope::All, IconName::LayoutDashboard),
            (Scope::Media, IconName::Image),
            (Scope::Models, IconName::Layers),
            (Scope::Favorites, IconName::Star),
            (Scope::Issues, IconName::TriangleAlert),
        ] {
            navigation = navigation.child(self.nav_item(scope, icon, cx));
        }
        navigation = navigation
            .child(div().px_4().pt_6().pb_2().child(eyebrow("收藏集")))
            .child(self.nav_item(Scope::Landscape, IconName::Folder, cx))
            .child(div().px_4().pt_6().pb_2().child(eyebrow("来源")))
            .child(self.nav_item(Scope::Studio, IconName::FolderOpen, cx));
        navigation.child(div().flex_1()).child(
            column()
                .m_3()
                .p_3()
                .gap_2()
                .rounded_lg()
                .border_1()
                .border_color(rgb(LINE))
                .child(badge("交互预览"))
                .child(
                    div()
                        .text_size(px(11.))
                        .text_color(rgb(MUTED))
                        .child("自由浏览和整理示例资源。笔记、标签与收藏只在本次会话中保留。"),
                ),
        )
    }
    fn nav_item(&self, scope: Scope, icon: IconName, cx: &mut Context<Self>) -> impl IntoElement {
        let active = self.library.scope == scope;
        let count = self
            .library
            .resources
            .iter()
            .filter(|item| Library::in_scope(item, scope))
            .count();
        div().px_2().py_0p5().child(
            Button::new(SharedString::from(format!("scope-{}", scope.title())))
                .ghost()
                .small()
                .w_full()
                .h(px(36.))
                .justify_start()
                .icon(icon)
                .label(format!("{}   {}", scope.title(), count))
                .toggled(active)
                .when(active, |button| {
                    button.bg(rgb(0x2d3e39)).text_color(rgb(ACCENT))
                })
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.library.scope = scope;
                    this.library.reconcile();
                    cx.notify();
                })),
        )
    }
}
