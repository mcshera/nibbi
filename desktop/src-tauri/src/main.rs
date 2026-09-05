// Thin native shell. One versioned local backend owns every agent and runtime action.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::{SocketAddr, TcpStream};
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

const PORT: u16 = 4527;

fn host_up() -> bool {
    let addr: SocketAddr = ([127, 0, 0, 1], PORT).into();
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(400)) else { return false; };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(700)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(700)));
    if stream.write_all(b"GET /nibbi/health HTTP/1.1\r\nHost: 127.0.0.1:4527\r\nConnection: close\r\n\r\n").is_err() { return false; }
    let mut response = String::new();
    if stream.take(65536).read_to_string(&mut response).is_err() { return false; }
    if !response.starts_with("HTTP/1.1 200") { return false; }
    let Some(body) = response.split("\r\n\r\n").nth(1) else { return false; };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(body) else { return false; };
    value["app"] == "nibbi" && value["protocolVersion"] == 1 && value["brain"] == true
}

/// Start `node server.mjs` if nothing is listening yet (the launchd unit, if installed, normally owns this).
fn ensure_host() -> Result<(), String> {
    if host_up() {
        return Ok(());
    }
    let addr: SocketAddr = ([127, 0, 0, 1], PORT).into();
    if TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok() { return Err("Port 4527 is occupied by an incompatible backend. Finish migration before opening this version.".into()); }
    // where is the host? install.sh writes ~/.nibbi/host.json {"path": ".../server.mjs", "node": ".../node"}; env NIBBI_HOME overrides
    let user_home = std::env::var("HOME").unwrap_or_default();
    let mut server = String::new();
    let mut node_hint = String::new();
    let state_dir = std::env::var("NIBBI_STATE_DIR").unwrap_or_else(|_| format!("{user_home}/.nibbi"));
    let mut runtime_env: Vec<(String, String)> = Vec::new();
    if let Ok(txt) = std::fs::read_to_string(format!("{state_dir}/host.json")) {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&txt) {
            server = value["path"].as_str().unwrap_or_default().to_string();
            node_hint = value["node"].as_str().unwrap_or_default().to_string();
            for (key, name) in [("stateDir", "NIBBI_STATE_DIR"), ("vaultDir", "NIBBI_VAULT_DIR"), ("workDir", "NIBBI_WORK_DIR"), ("projectsDir", "NIBBI_PROJECTS_DIR")] {
                if let Some(path) = value[key].as_str() { runtime_env.push((name.to_string(), path.to_string())); }
            }
            if value["port"].as_u64().is_some_and(|port| port != PORT as u64) { return Err("The desktop shell uses port 4527. Use the browser for a custom-port backend.".into()); }
        }
    }
    if let Ok(h) = std::env::var("NIBBI_HOME") { server = format!("{h}/server.mjs"); }
    if server.is_empty() { server = format!("{user_home}/Documents/Nibbi/server.mjs"); }
    let home = std::path::Path::new(&server).parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
    let candidates = [
        node_hint,
        "node".to_string(),
        "/opt/homebrew/bin/node".to_string(),
        "/usr/local/bin/node".to_string(),
        format!("{}/.local/node/node-v22.14.0-darwin-arm64/bin/node", std::env::var("HOME").unwrap_or_default()),
    ];
    for node in candidates.iter().filter(|n| !n.is_empty()) {
        let spawned = Command::new(node)
            .arg(&server)
            .arg("--port")
            .arg(PORT.to_string())
            .envs(runtime_env.iter().cloned())
            .current_dir(&home)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
        if spawned.is_ok() {
            for _ in 0..25 {
                if host_up() {
                    return Ok(());
                }
                std::thread::sleep(Duration::from_millis(120));
            }
            return Err("Nibbi did not become ready. Check ~/.nibbi/logs and run npm run build in the source checkout.".into());
        }
    }
    Err("Could not start Node. Re-run install.sh to configure the backend path.".into())
}

fn main() {
    use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};
    if let Err(error) = ensure_host() { eprintln!("{error}"); std::process::exit(1); }
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
