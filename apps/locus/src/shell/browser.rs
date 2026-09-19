use super::{state::Category, view::*};
use gpui_kit::{
    assets::IconName,
    component::{
        Sizable,
        button::{Button, ButtonVariants},
        input::Input,
    },
    prelude::FluentBuilder as _,
    *,
};

impl Shell {
    pub fn browser(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let visible = self.library.visible();
        let mut results = div()
            .id("resource-scroll")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .p_5();
        if visible.is_empty() {
            results = results.child(
                column()
                    .h_full()
                    .items_center()
                    .justify_center()
                    .gap_4()
                    .child(
                        div()
                            .text_size(px(32.))
                            .text_color(rgb(MUTED))
                            .child(IconName::Search),
                    )
                    .child(section_title("没有符合条件的资源"))
                    .child(
                        div()
                            .text_color(rgb(MUTED))
                            .child("试试其他关键词，或清除筛选条件。"),
                    )
                    .child(
                        Button::new("reset-empty")
                            .outline()
                            .label("清除全部筛选")
                            .on_click(
                                cx.listener(|this, _, window, cx| this.reset_filters(window, cx)),
                            ),
                    ),
            );
        } else if self.grid {
            results = results.child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap_3()
                    .children(visible.iter().map(|&id| self.card(id, cx))),
            );
        } else {
            results = results.child(
                column()
                    .gap_2()
                    .children(visible.iter().map(|&id| self.list_row(id, cx))),
            );
        }
        column()
            .size_full()
            .gap_0()
            .min_w_0()
            .child(
                column()
                    .p_5()
                    .gap_4()
                    .border_b_1()
                    .border_color(rgb(LINE))
                    .child(
                        row()
                            .justify_between()
                            .child(
                                column().gap_1().child(eyebrow("工作区 / 资源浏览")).child(
                                    row()
                                        .gap_3()
                                        .child(
                                            div()
                                                .text_size(px(23.))
                                                .font_weight(FontWeight::SEMIBOLD)
                                                .child(self.library.scope.title()),
                                        )
                                        .child(badge(format!("{}", visible.len()))),
                                ),
                            )
                            .child(badge("本地样本")),
                    )
                    .child(
                        Input::new(&self.search)
                            .prefix(IconName::Search)
                            .cleanable(true)
                            .aria_label("搜索资源"),
                    )
                    .child(
                        row()
                            .justify_between()
                            .gap_1()
                            .child(
                                row()
                                    .gap_1()
                                    .child(
                                        Button::new("issue-filter")
                                            .ghost()
                                            .small()
                                            .label(if self.library.issues_only {
                                                "仅有问题"
                                            } else {
                                                "全部状态"
                                            })
                                            .icon(IconName::Funnel)
                                            .toggled(self.library.issues_only)
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.library.issues_only =
                                                    !this.library.issues_only;
                                                this.library.reconcile();
                                                cx.notify();
                                            })),
                                    )
                                    .child(
                                        Button::new("sort")
                                            .ghost()
                                            .small()
                                            .label(if self.library.alphabetical {
                                                "名称 ↑"
                                            } else {
                                                "默认排序"
                                            })
                                            .icon(IconName::ArrowDownUp)
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.library.alphabetical =
                                                    !this.library.alphabetical;
                                                cx.notify();
                                            })),
                                    ),
                            )
                            .child(
                                row()
                                    .gap_1()
                                    .child(
                                        Button::new("grid")
                                            .ghost()
                                            .small()
                                            .icon(IconName::LayoutDashboard)
                                            .tooltip("网格视图")
                                            .accessibility_label("网格视图")
                                            .toggled(self.grid)
                                            .when(self.grid, |button| {
                                                button.bg(rgb(0x2d3e39)).text_color(rgb(ACCENT))
                                            })
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.grid = true;
                                                cx.notify();
                                            })),
                                    )
                                    .child(
                                        Button::new("list")
                                            .ghost()
                                            .small()
                                            .icon(IconName::List)
                                            .tooltip("列表视图")
                                            .accessibility_label("列表视图")
                                            .toggled(!self.grid)
                                            .when(!self.grid, |button| {
                                                button.bg(rgb(0x2d3e39)).text_color(rgb(ACCENT))
                                            })
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.grid = false;
                                                cx.notify();
                                            })),
                                    ),
                            ),
                    ),
            )
            .child(results)
            .child(
                row()
                    .px_5()
                    .h(px(33.))
                    .flex_shrink_0()
                    .border_t_1()
                    .border_color(rgb(LINE))
                    .text_size(px(10.))
                    .text_color(rgb(MUTED))
                    .justify_between()
                    .child(format!(
                        "{} 个资源 · {} 个已选中",
                        visible.len(),
                        usize::from(self.library.selected.is_some())
                    ))
                    .child("单击资源查看组件 →"),
            )
    }
    fn card(&self, id: usize, cx: &mut Context<Self>) -> AnyElement {
        let item = &self.library.resources[id];
        let selected = self.library.selected == Some(id);
        div()
            .id(("card", id))
            .w(px(184.))
            .flex_grow(1.)
            .max_w(px(240.))
            .rounded_lg()
            .overflow_hidden()
            .border_1()
            .border_color(rgb(if selected { ACCENT } else { LINE }))
            .bg(rgb(if selected { 0x25332f } else { PANEL }))
            .cursor_pointer()
            .hover(|style| style.border_color(rgb(0x687b75)))
            .on_click(cx.listener(move |this, _, _, cx| {
                this.library.selected = Some(id);
                cx.notify();
            }))
            .child(
                div()
                    .relative()
                    .h(px(133.))
                    .w_full()
                    .overflow_hidden()
                    .child(
                        img(self.artwork[item.artwork].clone())
                            .size_full()
                            .object_fit(ObjectFit::Cover),
                    )
                    .when(item.category == Category::Model, |view| {
                        view.child(
                            div()
                                .absolute()
                                .bottom_2()
                                .left_2()
                                .child(badge("模型权重")),
                        )
                    })
                    .when(item.favorite, |view| {
                        view.child(
                            div()
                                .absolute()
                                .top_2()
                                .right_2()
                                .text_color(rgb(0xf4ddac))
                                .child(IconName::Star),
                        )
                    })
                    .when(item.issue.is_some(), |view| {
                        view.child(
                            div()
                                .absolute()
                                .top_2()
                                .left_2()
                                .text_color(rgb(0xf0c183))
                                .child(IconName::TriangleAlert),
                        )
                    }),
            )
            .child(
                column()
                    .p_3()
                    .gap_1()
                    .child(
                        div()
                            .font_weight(FontWeight::MEDIUM)
                            .truncate()
                            .child(item.name),
                    )
                    .child(
                        div()
                            .text_size(px(10.))
                            .text_color(rgb(MUTED))
                            .truncate()
                            .child(item.subtitle),
                    )
                    .child(
                        row()
                            .mt_2()
                            .justify_between()
                            .text_size(px(10.))
                            .text_color(rgb(MUTED))
                            .child(item.collection)
                            .child(
                                div()
                                    .text_color(rgb(item.color))
                                    .child(item.category.label()),
                            ),
                    ),
            )
            .into_any_element()
    }
    fn list_row(&self, id: usize, cx: &mut Context<Self>) -> AnyElement {
        let item = &self.library.resources[id];
        let selected = self.library.selected == Some(id);
        row()
            .id(("resource-row", id))
            .p_2()
            .gap_3()
            .rounded_lg()
            .border_1()
            .border_color(rgb(if selected { ACCENT } else { LINE }))
            .bg(rgb(if selected { 0x25332f } else { PANEL }))
            .cursor_pointer()
            .hover(|style| style.bg(rgb(0x2a3037)))
            .on_click(cx.listener(move |this, _, _, cx| {
                this.library.selected = Some(id);
                cx.notify();
            }))
            .child(
                img(self.artwork[item.artwork].clone())
                    .w(px(66.))
                    .h(px(46.))
                    .rounded_md()
                    .object_fit(ObjectFit::Cover),
            )
            .child(
                column()
                    .flex_1()
                    .min_w_0()
                    .gap_1()
                    .child(div().truncate().child(item.name))
                    .child(
                        div()
                            .text_size(px(10.))
                            .text_color(rgb(MUTED))
                            .truncate()
                            .child(item.subtitle),
                    ),
            )
            .child(badge(item.category.label()))
            .when(item.issue.is_some(), |view| {
                view.child(IconName::TriangleAlert)
            })
            .when(item.favorite, |view| view.child(IconName::Star))
            .into_any_element()
    }
}
