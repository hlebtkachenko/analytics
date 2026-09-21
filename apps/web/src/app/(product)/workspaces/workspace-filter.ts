// Pure membership filtering for the "Member of" table, split out so it can be
// unit tested without driving the Carbon filter panel through jsdom. Kept local
// to the workspaces page; a shared extraction with members is future backlog.

export type FilterableWorkspace = Readonly<{
  role: string;
  status: string;
}>;

export type WorkspaceFilterSelection = Readonly<{
  roles: readonly string[];
  statuses: readonly string[];
}>;

// A workspace passes when it matches every non-empty filter category.
export function workspaceMatchesFilters(
  workspace: FilterableWorkspace,
  selection: WorkspaceFilterSelection,
): boolean {
  if (selection.roles.length > 0 && !selection.roles.includes(workspace.role)) {
    return false;
  }
  if (
    selection.statuses.length > 0 &&
    !selection.statuses.includes(workspace.status)
  ) {
    return false;
  }
  return true;
}
