import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Module from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://nerva.test", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLDialogElement", "SVGElement", "Element", "Node", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: typeof dom.window[key] === "function" && ["getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"].includes(key) ? dom.window[key].bind(dom.window) : dom.window[key] });
}
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
const React = await import("react");
const { render, screen, fireEvent, waitFor, cleanup, act } = await import("@testing-library/react");
const virtualFile = fileURLToPath(new URL(".workspace-ui.cjs", import.meta.url));
const compiled = await build({
  stdin: { contents: 'export { NotesPanel } from "./src/components/NotesPanel"; export { WorkspaceDeleteDialog } from "./src/components/WorkspaceDeleteDialog"; export { useApp } from "./src/store/app"; export { flushNoteEdits } from "./src/lib/noteEdits";', resolveDir: process.cwd(), loader: "ts" },
  bundle: true, write: false, platform: "node", format: "cjs", external: ["react", "react-dom", "zustand", "framer-motion"],
  plugins: [{ name: "native-ipc-fixture", setup(builder) {
    builder.onResolve({ filter: /^(@\/lib\/ipc|@tauri-apps\/api\/(event|window))$/ }, ({ path }) => ({ path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: path === "@/lib/ipc"
      ? 'export const ipc = new Proxy({}, { get(_target, name) { return (...args) => globalThis.__nervaIpc[name](...args); } }); export const formatRemaining = String;'
      : 'export const listen = async () => () => {}; export const emit = async () => {}; export const getCurrentWindow = () => ({ label: "main" });' }));
  } }],
});
const loaded = new Module(virtualFile);
loaded.filename = virtualFile;
loaded.paths = Module._nodeModulePaths(process.cwd());
loaded._compile(compiled.outputFiles[0].text, virtualFile);
const { NotesPanel, WorkspaceDeleteDialog, useApp, flushNoteEdits } = loaded.exports;

function fixture() {
  const data = {
    workspaces: [{ id: "work", name: "Work", color: "#5179c7", created_ms: 1 }, { id: "personal", name: "Personal", color: "#388569", created_ms: 2 }],
    active: "work",
    notes: [
      { id: "alpha", workspace_id: "work", title: "Alpha", body: "Work draft", updated_ms: 2 },
      { id: "beta", workspace_id: "work", title: "Beta", body: "Second draft", updated_ms: 1 },
    ],
    saves: [],
    deletions: [],
  };
  const backend = {
    noteGet: async (id) => structuredClone(data.notes.find((note) => note.id === id) ?? null),
    noteList: async () => structuredClone(data.notes),
    lastNoteForWorkspace: async (id) => data.notes.find((note) => note.workspace_id === id)?.id ?? null,
    noteSave: async (draft) => {
      data.saves.push(structuredClone(draft));
      const saved = { ...draft, updated_ms: Date.now() };
      const index = data.notes.findIndex((note) => note.id === draft.id);
      if (index < 0) data.notes.unshift(saved); else data.notes[index] = saved;
      return saved;
    },
    noteReorder: async (workspaceId, ids) => {
      assert.ok(ids.every((id) => data.notes.some((note) => note.id === id && note.workspace_id === workspaceId)));
      data.notes = [...ids.map((id) => data.notes.find((note) => note.id === id)), ...data.notes.filter((note) => !ids.includes(note.id))];
      return structuredClone(data.notes);
    },
    noteSearch: async () => structuredClone(data.notes),
    noteSemanticSearch: async () => [],
    workspaceActivate: async (id) => { data.active = id; },
    workspaceActive: async () => data.workspaces.find((workspace) => workspace.id === data.active),
    workspaceList: async () => structuredClone(data.workspaces),
    workspaceDelete: async (id, destination) => {
      data.deletions.push({ id, destination });
      data.notes = data.notes.map((note) => note.workspace_id === id ? { ...note, workspace_id: destination } : note);
      data.workspaces = data.workspaces.filter((workspace) => workspace.id !== id);
      if (data.active === id) data.active = destination;
    },
    timerTick: async () => ({ timers: [], completed: [], phase_changes: [] }),
    timerList: async () => [], taskList: async () => [], momentumSnapshot: async () => [], audioState: async () => null, focusState: async () => null,
  };
  globalThis.__nervaIpc = backend;
  useApp.setState({ ready: true, active: data.workspaces[0], workspaces: data.workspaces, notes: structuredClone(data.notes), timers: [], tasks: [] });
  return { data, backend };
}

afterEach(async () => {
  await act(async () => { await flushNoteEdits(); });
  cleanup();
});

test("switching workspace flushes the draft under its original identity", async () => {
  const { data } = fixture();
  render(React.createElement(NotesPanel));
  await waitFor(() => assert.equal(screen.getByLabelText("Note body").value, "Work draft"));
  fireEvent.change(screen.getByLabelText("Note body"), { target: { value: "Final work edit" } });
  await act(async () => { await useApp.getState().activateWorkspace("personal"); });
  await waitFor(() => assert.equal(screen.getByLabelText("Note body").value, ""));
  assert.equal(data.notes.find((note) => note.id === "alpha").body, "Final work edit");
  assert.ok(data.saves.every((draft) => draft.workspace_id === "work" && draft.id === "alpha"));
  assert.equal(screen.queryByRole("button", { name: "Alpha", exact: true }), null);
});

test("an older note load cannot populate a newly selected workspace", async () => {
  const { backend } = fixture();
  let finishLoad;
  backend.noteGet = () => new Promise((resolve) => { finishLoad = resolve; });
  render(React.createElement(NotesPanel));
  await waitFor(() => assert.ok(finishLoad));
  await act(async () => { await useApp.getState().activateWorkspace("personal"); });
  await act(async () => { finishLoad({ id: "alpha", workspace_id: "work", title: "Alpha", body: "Late work result", updated_ms: 1 }); });
  assert.equal(screen.getByLabelText("Note body").value, "");
  assert.equal(screen.getByLabelText("Note title").value, "");
});

test("switching waits for edits typed during an in-flight save", async () => {
  const { data, backend } = fixture();
  const persist = backend.noteSave;
  let finishSave;
  backend.noteSave = (draft) => new Promise((resolve) => { finishSave = async () => resolve(await persist(draft)); });
  render(React.createElement(NotesPanel));
  await waitFor(() => assert.equal(screen.getByLabelText("Note body").value, "Work draft"));
  fireEvent.change(screen.getByLabelText("Note body"), { target: { value: "First edit" } });
  let switching;
  await act(async () => {
    switching = useApp.getState().activateWorkspace("personal");
    await Promise.resolve();
  });
  await waitFor(() => assert.ok(finishSave));
  fireEvent.change(screen.getByLabelText("Note body"), { target: { value: "Newest edit" } });
  backend.noteSave = persist;
  await act(async () => { await finishSave(); await switching; });
  assert.equal(data.notes.find((note) => note.id === "alpha").body, "Newest edit");
  assert.equal(screen.getByLabelText("Note body").value, "");
});

test("creating another note flushes edits and uses a new note ID", async () => {
  const { data } = fixture();
  render(React.createElement(NotesPanel));
  await waitFor(() => assert.equal(screen.getByLabelText("Note body").value, "Work draft"));
  fireEvent.change(screen.getByLabelText("Note body"), { target: { value: "Keep original" } });
  fireEvent.click(screen.getByRole("button", { name: "+ New", exact: true }));
  await waitFor(() => assert.equal(screen.getByLabelText("Note body").value, ""));
  fireEvent.change(screen.getByLabelText("Note body"), { target: { value: "Separate new note" } });
  await act(async () => { await flushNoteEdits(); });
  assert.equal(data.notes.find((note) => note.id === "alpha").body, "Keep original");
  const added = data.notes.find((note) => note.body === "Separate new note");
  assert.ok(added && added.id !== "alpha" && added.workspace_id === "work");
});

test("move controls persist note order across panel remounts", async () => {
  const { data } = fixture();
  const view = render(React.createElement(NotesPanel));
  await waitFor(() => assert.ok(screen.getByRole("button", { name: "Move Alpha down" })));
  fireEvent.click(screen.getByRole("button", { name: "Move Alpha down" }));
  await waitFor(() => assert.deepEqual(data.notes.map((note) => note.id), ["beta", "alpha"]));
  view.unmount();
  render(React.createElement(NotesPanel));
  await waitFor(() => assert.deepEqual(screen.getAllByRole("listitem").map((item) => item.textContent), ["Beta", "Alpha"]));
});

test("workspace deletion requires an explicit destination and preserves note content", async () => {
  const { data } = fixture();
  let closed = false;
  render(React.createElement(WorkspaceDeleteDialog, { workspace: data.workspaces[0], onClose: () => { closed = true; } }));
  assert.equal(screen.getByLabelText("Move workspace contents to").value, "personal");
  fireEvent.click(screen.getByRole("button", { name: "Move and delete" }));
  await waitFor(() => assert.equal(closed, true));
  assert.deepEqual(data.deletions, [{ id: "work", destination: "personal" }]);
  assert.ok(data.notes.every((note) => note.workspace_id === "personal"));
  assert.equal(data.notes[0].body, "Work draft");
});