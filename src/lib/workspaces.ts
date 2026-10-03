export function inWorkspace(item: { workspace_id: string | null }, workspaceId: string | null): boolean {
  return (item.workspace_id || null) === workspaceId;
}