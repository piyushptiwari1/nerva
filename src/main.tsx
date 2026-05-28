import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { StickyNote } from "./components/StickyNote";
import { TimerWidget } from "./components/TimerWidget";
import { HabitsWidget } from "./components/HabitsWidget";
import { TasksWidget } from "./components/TasksWidget";
import { bootstrapTheme } from "./store/theme";
import { scheduleUpdateCheck } from "./updater";
import "./styles/globals.css";

// Apply persisted theme before React renders so the first paint matches.
bootstrapTheme();

// Probe the GitHub releases endpoint a few seconds after launch and
// install signed updates in the background. No-op in dev / when
// `latest.json` is missing.
scheduleUpdateCheck();

// Multi-window routing: separate Tauri webview windows reuse the same JS
// bundle and choose their root via URL query params.
//   ?sticky=<note_id>     → sticky-note window
//   ?widget=timer|habits|tasks → floating widget
// Anything else mounts the main app shell.
const params = new URLSearchParams(window.location.search);
const stickyId = params.get("sticky");
const widget = params.get("widget");

let root: React.ReactNode = <App />;
if (stickyId) root = <StickyNote noteId={stickyId} />;
else if (widget === "timer") root = <TimerWidget />;
else if (widget === "habits") root = <HabitsWidget />;
else if (widget === "tasks") root = <TasksWidget />;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{root}</React.StrictMode>
);
