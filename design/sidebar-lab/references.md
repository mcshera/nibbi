# What the field does with a left bar

Read 2026-09-14. Every claim has a URL. "Take" is what this lab borrows; "leave" is what it deliberately does not.

## T3 Code — Sidebar V2 (the shipped default)

One header row holds everything: a search field that spans the row, then a segmented well of 28px buttons — project scope, new project, new thread. The scope control is a combobox whose popup **anchors to the search field's width, not to its own 28px trigger**, so it reads as a full-width dropdown. Its label is "Filter threads by project": it scopes the list rather than switching a workspace. Below it, one flat thread list across projects, a project favicon on every row, with Pinned / Active / Snoozed / Settled sections. New thread is `⌘N` (`⌘⇧N` skips the project picker); `⌘B` toggles the bar; the bar is drag-resizable between 208px and `viewport − 640`, persisted as `chat_thread_sidebar_width`, double-click to reset. Hovering a row fades its timestamp out to reveal a Settle button, but the pull-request badge deliberately sits outside that fading slot so it stays readable and clickable.

- <https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/sidebar/SidebarThreadHeader.tsx>
- <https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/threadSidebarWidth.ts>
- <https://github.com/pingdotgg/t3code/blob/main/docs/user/keybindings.md>
- Author, on the shape: "Think of it more like an inbox. When you're done with a thread, click the 'settle' button and it slides to the bottom." <https://x.com/theo/status/2079892861689254129>

**Take:** the header row; the dropdown that anchors to the full width; new thread pinned near the top; the keys; drag-to-resize. **Leave:** the flat cross-project list (Nibbi's work is project-shaped), the favicons, and the settle/snooze shelves.

## T3 Code — the legacy sidebar it replaced

A disclosure tree: a "Projects" group label with a sort menu and an add button, then one expandable row per project with its recent threads nested underneath (preview count configurable, default 6). Projects can be grouped by repository. **This is the shape Nibbi has today**, and t3code moved off it as the default.

- <https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/LegacySidebar.tsx>
- Collapsing a project with many threads has been a performance complaint: <https://github.com/pingdotgg/t3code/issues/3962>

**Take:** the disclosure tree is familiar and is worth keeping as a minimal-delta option (`peer`). **Leave:** the fixed preview count.

## OpenCode — the legacy two-pane layout (retired 2026-09-14)

A 64px rail of drag-sortable project tiles on the far left, and beside it a panel of at least 244px showing that project's name, worktree path, a full-width "New session" button, then its sessions grouped by workspace. A 6px status dot on a tile, priority-ordered permission → error → unseen, plus a spinner while any session runs. `⌘B` toggles, `⌘1`–`⌘9` jump to a project, `⌥↑/↓` move between sessions. When collapsed, hovering a tile flies that project's panel out over the content, with a cursor-trajectory guard so moving diagonally into the flyout does not dismiss it.

- <https://github.com/anomalyco/opencode/blob/dev/packages/app/src/pages/layout/sidebar-shell.tsx>
- <https://github.com/anomalyco/opencode/blob/dev/packages/app/src/pages/layout/sidebar-items.tsx>

**Take:** the two-pane shape (`spine`), the full-width new-session button, hover-to-peek, `⌘1-9`. **Leave:** the status dots — Nibbi says attention in words.

## OpenCode — the new layout (default since 1.17.19)

No left bar at all: sessions became browser-style tabs in the titlebar, and navigation moved to a Home page with a 280px projects column beside a 720px sessions column grouped Today / Yesterday / Older.

- <https://github.com/anomalyco/opencode/blob/dev/packages/app/src/pages/home/home-projects-view.tsx>
- The complaint that followed: "The active project is no longer clearly visible. With the new session tabs, it is difficult to identify which project a session belongs to at a glance." <https://github.com/anomalyco/opencode/issues/37273>

**Take:** the warning. Whatever replaces the tree must keep "which project am I in" answerable at a glance. **Leave:** titlebar tabs — Nibbi's Tauri window already gives its titlebar to the traffic lights and an overlay title.

## Claude Code desktop, Zed, Cursor — grouping as a view

All three keep one list and make project grouping a mode rather than a structure. Claude Code desktop puts filter-by-status/project/environment and group-by-project controls at the top of the sidebar; Zed's Threads Sidebar (`⌘⌥J`) groups threads by project and keeps `ctrl-tab` for cycling without opening it; Cursor's Agents Window groups agents by repository.

- <https://code.claude.com/docs/en/desktop> · <https://zed.dev/docs/ai/agent-panel> · <https://cursor.com/docs/agent/agents-window>
- Truncated repository names with no tooltip are a live complaint in Cursor: <https://forum.cursor.com/t/repo-list-in-agent-view-sidebar/165972>

**Take:** sequential thread navigation that never opens the list; always give a truncated name a title. **Leave:** a grouping mode — one more preference to explain.

## Warp — the outlier

The left Conversation Panel has two collapsible sections, Active and Past, each row showing title, relative time and working directory. There is no project switcher: the directory is per-row metadata, and the New conversation button sits at the *bottom* of the Active section.

- <https://docs.warp.dev/agent-platform/warp-agents/interacting-with-agents>

**Take:** nothing structural. **Leave:** the bottom-placed new button — that is the mistake this lab is trying to undo.

## Two anti-patterns worth naming

1. **Bottom-pinned shelves leave a dead zone.** T3 Code pins its Snoozed and Settled headers with `margin-top: auto`: "A large blank area separates the upper task list from the 'Settled' section… this gap occupies roughly half the visible sidebar." <https://github.com/pingdotgg/t3code/issues/11752>
2. **A collapsed project control hides other projects' attention.** "The project switcher hides whether another project has a thread that needs attention. A user has to switch projects or clear the filter to find a completed turn, an input request, or a failure." <https://github.com/pingdotgg/t3code/issues/7954> — every option in this lab answers this with the `rollupText` improvement.
