import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { StickyNote } from "./components/StickyNote";
import "./styles/globals.css";

// Multi-window routing: a "sticky-*" window passes the note id as
// `?sticky=<id>`. Everything else mounts the main app shell.
const params = new URLSearchParams(window.location.search);
const stickyId = params.get("sticky");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {stickyId ? <StickyNote noteId={stickyId} /> : <App />}
  </React.StrictMode>
);
