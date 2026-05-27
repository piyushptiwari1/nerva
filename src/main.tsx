import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { StickyNote } from "./components/StickyNote";
import { TimerWidget } from "./components/TimerWidget";
import "./styles/globals.css";

// Multi-window routing: separate Tauri webview windows reuse the same JS
// bundle and choose their root via URL query params.
//   ?sticky=<note_id>  → sticky-note window
//   ?widget=timer      → floating timer widget
// Anything else mounts the main app shell.
const params = new URLSearchParams(window.location.search);
const stickyId = params.get("sticky");
const widget = params.get("widget");

let root: React.ReactNode = <App />;
if (stickyId) root = <StickyNote noteId={stickyId} />;
else if (widget === "timer") root = <TimerWidget />;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{root}</React.StrictMode>
);
