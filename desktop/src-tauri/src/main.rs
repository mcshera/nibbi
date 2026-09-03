// Nibbi desktop — thin shell over the local Nibbi host (127.0.0.1:4527), which proxies to the Oracle gateway.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::{SocketAddr, TcpStream};
use std::process::{Command, Stdio};
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

const PORT: u16 = 4527;
const NIBBI_HOME: &str = "/Users/Matty/Documents/Nibbi";

fn host_up() -> bool {
    let addr: SocketAddr = ([127, 0, 0, 1], PORT).into();
    TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok()
}

/// Start `node server.mjs` if nothing is listening yet (the launchd unit, if installed, normally owns this).
fn ensure_host() {
    if host_up() {
        return;
    }
    let home = std::env::var("NIBBI_HOME").unwrap_or_else(|_| NIBBI_HOME.to_string());
    let server = format!("{home}/server.mjs");
    let candidates = [
        "node".to_string(),
        "/opt/homebrew/bin/node".to_string(),
        "/usr/local/bin/node".to_string(),
        format!("{}/.local/node/node-v22.14.0-darwin-arm64/bin/node", std::env::var("HOME").unwrap_or_default()),
    ];
    for node in candidates.iter() {
        let spawned = Command::new(node)
            .arg(&server)
            .arg("--port")
            .arg(PORT.to_string())
            .current_dir(&home)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
        if spawned.is_ok() {
            for _ in 0..25 {
                if host_up() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(120));
            }
            return;
        }
    }
}

fn main() {
    use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};
    ensure_host();
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin({
            use tauri_plugin_window_state::StateFlags;
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build()
        })
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts(["alt+space"])
                .expect("register alt+space")
                .with_handler(|app, shortcut, event| {
                    if event.state == ShortcutState::Pressed
                        && shortcut.matches(Modifiers::ALT, Code::Space)
                    {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                            let _ = w.emit("toggle-live", ()); // the surface toggles the mic
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Open Nibbi", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // ⌘W / red button hides; tray, dock or ⌥Space brings it back
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building nibbi")
        .run(|app, event| {
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(w) = tauri::Manager::get_webview_window(app, "main") {
                    let _ = w.unminimize();
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        });
}
