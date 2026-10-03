import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const compiled = await build({ entryPoints: ["src/lib/workspaces.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { inWorkspace } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);

test("workspace views never include another workspace or unassigned content", () => {
  const items = [{ id: "work", workspace_id: "work" }, { id: "personal", workspace_id: "personal" }, { id: "unassigned", workspace_id: null }];
  assert.deepEqual(items.filter(item => inWorkspace(item, "new-workspace")), []);
  assert.deepEqual(items.filter(item => inWorkspace(item, "work")).map(item => item.id), ["work"]);
  assert.deepEqual(items.filter(item => inWorkspace(item, null)).map(item => item.id), ["unassigned"]);
  assert.equal(inWorkspace({ workspace_id: "" }, null), true);
});