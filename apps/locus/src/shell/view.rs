use super::state::Library;
use gpui_kit::{
    component::{
        input::{InputEvent, InputState, TextareaState},
        resizable::{h_resizable, resizable_panel},
    },
    *,
};
use std::{collections::HashSet, sync::Arc};

pub const BG: u32 = 0x181b20;
pub const PANEL: u32 = 0x1e2228;
pub const LINE: u32 = 0x30363d;
pub const TEXT: u32 = 0xe4e7ed;
pub const MUTED: u32 = 0x919ba8;
pub const ACCENT: u32 = 0xa4cabb;

pub struct Editors {
    pub note: Entity<TextareaState>,
    pub tag: Entity<InputState>,
    pub feedback: &'static str,
}
#[derive(Clone, Copy, PartialEq)]
pub enum InspectorTab {
    Overview,
    Components,
    Notes,
}
pub struct Shell {
    pub library: Library,
    pub search: Entity<InputState>,
    pub editors: Vec<Editors>,
    pub artwork: Vec<Arc<Image>>,
    pub grid: bool,
    pub tab: InspectorTab,
    pub collapsed: HashSet<&'static str>,
    _subscriptions: Vec<Subscription>,
}
impl Shell {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let library = Library::new();
        let search = cx.new(|cx| InputState::new(window, cx).placeholder("搜索名称、标签或描述…"));
        let mut subscriptions = vec![cx.subscribe(&search, |this, search, event, cx| {
            if matches!(event, InputEvent::Change) {
                this.library.query = search.read(cx).value().to_string();
                this.library.reconcile();
                cx.notify();
            }
        })];
        // Each editor and its callbacks belong to one fixture for the whole session.
        // Selection never repopulates an editor, so queued changes cannot leak into another item.
        let editors = library
            .resources
            .iter()
            .map(|item| {
                let id = item.id;
                let note = cx.new(|cx| {
                    TextareaState::new(window, cx)
                        .placeholder("记录想法、用途或下次创作的灵感…")
                        .default_value(item.note.clone())
                });
                let tag =
                    cx.new(|cx| InputState::new(window, cx).placeholder("新标签，按 Enter 添加"));
                subscriptions.push(cx.subscribe(&note, move |this, note, event, cx| {
                    if matches!(event, InputEvent::Change) {
                        this.library.set_note(id, note.read(cx).value().to_string());
                        cx.notify();
                    }
                }));
                subscriptions.push(cx.subscribe_in(
                    &tag,
                    window,
                    move |this, _, event, window, cx| {
                        if matches!(event, InputEvent::PressEnter { .. }) {
                            this.add_tag(id, window, cx);
                        }
                    },
                ));
                Editors {
                    note,
                    tag,
                    feedback: "标签与笔记仅保留在本次会话",
                }
            })
            .collect();
        let artwork = [
            include_bytes!("../../assets/mountains.svg").as_slice(),
            include_bytes!("../../assets/coast.svg").as_slice(),
            include_bytes!("../../assets/city.svg").as_slice(),
            include_bytes!("../../assets/dunes.svg").as_slice(),
            include_bytes!("../../assets/forest.svg").as_slice(),
            include_bytes!("../../assets/still-life.svg").as_slice(),
        ]
        .into_iter()
        .map(|bytes| Arc::new(Image::from_bytes(ImageFormat::Svg, bytes.to_vec())))
        .collect();
        Self {
            library,
            search,
            editors,
            artwork,
            grid: true,
            tab: InspectorTab::Overview,
            collapsed: HashSet::new(),
            _subscriptions: subscriptions,
        }
    }
    pub fn add_tag(&mut self, id: usize, window: &mut Window, cx: &mut Context<Self>) {
        let value = self.editors[id].tag.read(cx).value().to_string();
        if self.library.add_tag(id, &value) {
            self.editors[id]
                .tag
                .update(cx, |input, cx| input.set_value("", window, cx));
            self.editors[id].feedback = "已添加 · 仅本次会话";
        } else {
            self.editors[id].feedback = "请输入新标签，空白或重复标签不会添加";
        }
        self.library.reconcile();
        cx.notify();
    }
    pub fn reset_filters(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.library.reset();
        self.search
            .update(cx, |input, cx| input.set_value("", window, cx));
        cx.notify();
    }
}

impl Render for Shell {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(rgb(BG))
            .text_color(rgb(TEXT))
            .font_family("Microsoft YaHei UI")
            .text_size(px(13.))
            .child(
                div().flex_1().min_h_0().child(
                    h_resizable("workspace-columns")
                        .child(
                            resizable_panel()
                                .size(px(202.))
                                .size_range(px(176.)..px(280.))
                                .child(self.navigation(cx)),
                        )
                        .child(
                            resizable_panel()
                                .size(px(790.))
                                .size_range(px(380.)..px(1600.))
                                .child(self.browser(cx)),
                        )
                        .child(
                            resizable_panel()
                                .size(px(368.))
                                .size_range(px(310.)..px(520.))
                                .child(self.inspector(cx)),
                        ),
                ),
            )
            .child(
                div()
                    .h(px(27.))
                    .flex_shrink_0()
                    .px_4()
                    .flex()
                    .items_center()
                    .justify_between()
                    .border_t_1()
                    .border_color(rgb(LINE))
                    .text_size(px(10.))
                    .text_color(rgb(MUTED))
                    .child("●  演示工作区 · 12 个本地样本")
                    .child("所有更改仅保留在本次会话  ·  拖动分栏边界调整宽度"),
            )
    }
}

pub fn column() -> Div {
    div().flex().flex_col().gap_3()
}
pub fn row() -> Div {
    div().flex().items_center().gap_2()
}
pub fn eyebrow(label: &'static str) -> Div {
    div().text_size(px(10.)).text_color(rgb(MUTED)).child(label)
}
pub fn section_title(label: &'static str) -> Div {
    div()
        .text_size(px(12.))
        .font_weight(FontWeight::SEMIBOLD)
        .child(label)
}
pub fn badge(text: impl Into<SharedString>) -> Div {
    div()
        .px_2()
        .py_1()
        .rounded_md()
        .bg(rgb(0x2c3438))
        .text_color(rgb(ACCENT))
        .text_size(px(10.))
        .child(text.into())
}
