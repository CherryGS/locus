use super::{
    components::{PANELS, fact},
    state::Scope,
    view::*,
};
use gpui_kit::{
    assets::IconName,
    component::{
        Sizable,
        button::{Button, ButtonVariants},
        input::{Input, Textarea},
    },
    prelude::FluentBuilder as _,
    *,
};

impl Shell {
    pub fn inspector(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(id) = self.library.selected else {
            return column()
                .size_full()
                .p_6()
                .bg(rgb(PANEL))
                .justify_center()
                .items_center()
                .child(IconName::MousePointer)
                .child(section_title("选择一个资源"))
                .child(
                    div()
                        .text_color(rgb(MUTED))
                        .child("在资源浏览区选择项目，查看组件与笔记。"),
                )
                .into_any_element();
        };
        let item = &self.library.resources[id];
        let mut tabs = row()
            .gap_1()
            .px_3()
            .py_2()
            .border_b_1()
            .border_color(rgb(LINE));
        for (tab, label) in [
            (InspectorTab::Overview, "概览"),
            (InspectorTab::Components, "组件"),
            (InspectorTab::Notes, "笔记与标签"),
        ] {
            tabs = tabs.child(
                Button::new(SharedString::from(format!("tab-{label}")))
                    .ghost()
                    .small()
                    .label(label)
                    .toggled(self.tab == tab)
                    .when(self.tab == tab, |button| {
                        button.bg(rgb(0x2d3e39)).text_color(rgb(ACCENT))
                    })
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.tab = tab;
                        cx.notify();
                    })),
            );
        }
        let content = match self.tab {
            InspectorTab::Overview => self.overview(id, cx),
            InspectorTab::Components => self.component_panels(id, cx),
            InspectorTab::Notes => self.annotations(id, cx),
        };
        column()
            .size_full()
            .gap_0()
            .bg(rgb(PANEL))
            .border_l_1()
            .border_color(rgb(LINE))
            .child(
                column()
                    .p_4()
                    .gap_3()
                    .child(
                        row().justify_between().child(eyebrow("资源检查器")).child(
                            Button::new("favorite")
                                .ghost()
                                .small()
                                .icon(IconName::Star)
                                .toggled(item.favorite)
                                .accessibility_label(if item.favorite {
                                    "取消收藏"
                                } else {
                                    "加入收藏"
                                })
                                .tooltip(if item.favorite {
                                    "取消收藏"
                                } else {
                                    "加入收藏"
                                })
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.library.resources[id].favorite =
                                        !this.library.resources[id].favorite;
                                    this.library.reconcile();
                                    cx.notify();
                                })),
                        ),
                    )
                    .child(
                        div()
                            .text_size(px(19.))
                            .font_weight(FontWeight::SEMIBOLD)
                            .truncate()
                            .child(item.name),
                    )
                    .child(
                        row().child(badge(item.category.label())).child(
                            div()
                                .text_size(px(10.))
                                .text_color(rgb(MUTED))
                                .child(format!("LC · {:04}", id + 1)),
                        ),
                    ),
            )
            .child(tabs)
            .child(
                div()
                    .id(SharedString::from(format!(
                        "inspector-scroll-{id}-{}",
                        self.tab as u8
                    )))
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .p_4()
                    .child(content),
            )
            .into_any_element()
    }
    fn overview(&self, id: usize, cx: &mut Context<Self>) -> AnyElement {
        let item = &self.library.resources[id];
        let issue = item.issue;
        let mut content = column()
            .gap_4()
            .child(
                img(self.artwork[item.artwork].clone())
                    .w_full()
                    .h(px(177.))
                    .object_fit(ObjectFit::Cover)
                    .rounded_lg(),
            )
            .child(
                column().gap_2().child(section_title("基本信息")).child(
                    column()
                        .gap_0()
                        .child(fact("资源类型", item.category.label()))
                        .child(fact("收藏集", item.collection))
                        .child(fact("加入日期", "2026-09-19"))
                        .child(fact(
                            "组件数量",
                            format!(
                                "{} 个",
                                PANELS.iter().filter(|panel| (panel.applies)(item)).count()
                            ),
                        )),
                ),
            )
            .child(
                column()
                    .gap_2()
                    .p_3()
                    .rounded_lg()
                    .border_1()
                    .border_color(rgb(if issue.is_some() { 0x66513b } else { LINE }))
                    .child(section_title("当前资源状态"))
                    .child(
                        div()
                            .text_size(px(11.))
                            .text_color(rgb(if issue.is_some() { 0xe1b882 } else { ACCENT }))
                            .child(issue.unwrap_or("样本信息完整，暂无需要关注的问题。")),
                    ),
            )
            .child(
                column()
                    .gap_2()
                    .child(section_title("资源库问题 · 2"))
                    .child(
                        div()
                            .text_size(px(10.))
                            .text_color(rgb(MUTED))
                            .child("以下问题属于整个演示资源库。点击定位资源。"),
                    ),
            );
        for resource in self
            .library
            .resources
            .iter()
            .filter(|resource| resource.issue.is_some())
        {
            let target = resource.id;
            content = content.child(
                Button::new(("issue-link", target))
                    .ghost()
                    .small()
                    .w_full()
                    .justify_start()
                    .icon(IconName::TriangleAlert)
                    .label(resource.name)
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.reset_filters(window, cx);
                        this.library.scope = Scope::Issues;
                        this.library.selected = Some(target);
                        this.tab = InspectorTab::Overview;
                        cx.notify();
                    })),
            );
        }
        content.into_any_element()
    }
    fn component_panels(&self, id: usize, cx: &mut Context<Self>) -> AnyElement {
        let item = &self.library.resources[id];
        let mut content = column().gap_3().child(
            div()
                .text_size(px(10.))
                .text_color(rgb(MUTED))
                .child("独立组件 · 仅显示当前资源拥有的信息"),
        );
        for panel in PANELS.iter().filter(|panel| (panel.applies)(item)) {
            let key = panel.key;
            let collapsed = self.collapsed.contains(key);
            content = content.child(
                column()
                    .gap_0()
                    .border_1()
                    .border_color(rgb(LINE))
                    .rounded_lg()
                    .overflow_hidden()
                    .child(
                        Button::new(key)
                            .ghost()
                            .w_full()
                            .justify_start()
                            .icon(if collapsed {
                                IconName::ChevronRight
                            } else {
                                IconName::ChevronDown
                            })
                            .label(format!("{}   {}", panel.title, panel.subtitle))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                if !this.collapsed.remove(key) {
                                    this.collapsed.insert(key);
                                }
                                cx.notify();
                            })),
                    )
                    .when(!collapsed, |view| {
                        view.child(
                            div()
                                .p_3()
                                .border_t_1()
                                .border_color(rgb(LINE))
                                .child((panel.render)(item)),
                        )
                    }),
            );
        }
        content.into_any_element()
    }
    fn annotations(&self, id: usize, cx: &mut Context<Self>) -> AnyElement {
        let item = &self.library.resources[id];
        let editor = &self.editors[id];
        column()
            .gap_5()
            .child(
                column()
                    .gap_3()
                    .child(
                        row()
                            .justify_between()
                            .child(section_title("笔记"))
                            .child(eyebrow("会话内自动保留")),
                    )
                    .child(
                        Textarea::new(&editor.note)
                            .h(px(190.))
                            .aria_label("资源笔记"),
                    )
                    .child(
                        div()
                            .text_size(px(10.))
                            .text_color(rgb(MUTED))
                            .child("切换资源后仍可继续编辑，关闭应用后清空。"),
                    ),
            )
            .child(
                column()
                    .gap_3()
                    .child(section_title("标签"))
                    .child(div().flex().flex_wrap().gap_2().children(
                        item.tags.iter().enumerate().map(|(index, tag)| {
                            let tag_value = tag.clone();
                            Button::new(("tag", index))
                                .ghost()
                                .small()
                                .label(format!("{tag}  ×"))
                                .tooltip("移除此标签")
                                .bg(rgb(0x2c3934))
                                .text_color(rgb(ACCENT))
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.library.resources[id]
                                        .tags
                                        .retain(|value| value != &tag_value);
                                    this.editors[id].feedback = "已移除 · 仅本次会话";
                                    this.library.reconcile();
                                    cx.notify();
                                }))
                        }),
                    ))
                    .child(Input::new(&editor.tag).aria_label("新标签"))
                    .child(
                        Button::new("add-tag")
                            .outline()
                            .small()
                            .icon(IconName::Plus)
                            .label("添加标签")
                            .on_click(
                                cx.listener(move |this, _, window, cx| {
                                    this.add_tag(id, window, cx)
                                }),
                            ),
                    )
                    .child(
                        div()
                            .text_size(px(10.))
                            .text_color(rgb(MUTED))
                            .child(editor.feedback),
                    ),
            )
            .into_any_element()
    }
}
