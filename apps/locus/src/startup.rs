use crate::shell::Shell;
use anyhow::Context as _;
use gpui_kit::{
    component::{Root, Theme, ThemeMode},
    *,
};
use std::{cell::RefCell, rc::Rc};

pub fn run() -> anyhow::Result<()> {
    let launch_error = Rc::new(RefCell::new(None));
    let error = launch_error.clone();
    gpui_kit::application()
        .with_assets(gpui_kit::assets::AllAssets)
        .run(move |cx| {
            gpui_kit::init(cx);
            Theme::change(ThemeMode::Dark, None, cx);
            let options = WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                    None,
                    size(px(1360.), px(850.)),
                    cx,
                ))),
                window_min_size: Some(size(px(1040.), px(660.))),
                titlebar: Some(TitlebarOptions {
                    title: Some("Locus · 资源工作台".into()),
                    ..Default::default()
                }),
                ..Default::default()
            };
            match cx.open_window(options, |window, cx| {
                let shell = cx.new(|cx| Shell::new(window, cx));
                cx.new(|cx| Root::new(shell, window, cx))
            }) {
                Ok(_) => cx.activate(true),
                Err(failure) => {
                    *error.borrow_mut() = Some(failure);
                    cx.quit();
                }
            }
            cx.on_window_closed(|cx, _| {
                if cx.windows().is_empty() {
                    cx.quit();
                }
            })
            .detach();
        });
    match launch_error.borrow_mut().take() {
        Some(error) => Err(error).context("open the Locus native window"),
        None => Ok(()),
    }
}
