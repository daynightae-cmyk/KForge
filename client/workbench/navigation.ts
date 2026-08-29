import type { KForgeActivity } from "@shared/workspace";

export type WorkbenchView = { id: string; label: string; group?: string };
export type WorkbenchActivity = { id: KForgeActivity; label: string; views: WorkbenchView[] };

export const ACTIVITIES: WorkbenchActivity[] = [
  { id: "projects", label: "Projects", views: [
    { id: "workspace", label: "Workspace", group: "Projects" }, { id: "health", label: "Project Health", group: "Projects" },
    { id: "recent", label: "Recent", group: "Collections" }, { id: "favorites", label: "Favorites", group: "Collections" }, { id: "pinned", label: "Pinned", group: "Collections" }, { id: "archive", label: "Archive", group: "Collections" },
    { id: "open-project", label: "Open Project", group: "Actions" }, { id: "import-project", label: "Import Project", group: "Actions" },
  ] },
  { id: "ai", label: "AI", views: [
    { id: "providers", label: "Providers" }, { id: "models", label: "Models" }, { id: "agents", label: "Agents" }, { id: "tasks", label: "Tasks" },
  ] },
  { id: "online", label: "Online", views: [
    { id: "discover", label: "Discover", group: "Discover" }, { id: "marketplace", label: "Marketplace", group: "Discover" },
    { id: "extensions", label: "Extensions", group: "Catalog" }, { id: "models", label: "Models", group: "Catalog" }, { id: "agents", label: "Agents", group: "Catalog" }, { id: "tools", label: "Tools", group: "Catalog" }, { id: "integrations", label: "Integrations", group: "Catalog" },
    { id: "installed", label: "Installed", group: "Manage" }, { id: "updates", label: "Updates", group: "Manage" }, { id: "downloads", label: "Downloads", group: "Manage" },
    { id: "providers", label: "Providers", group: "Sources" }, { id: "remote-sources", label: "Remote Sources", group: "Sources" },
    { id: "security", label: "Security", group: "Trust" }, { id: "activity", label: "Activity", group: "Observe" },
  ] },
  { id: "intelligence", label: "Intelligence", views: [
    { id: "project-graph", label: "Project Graph" }, { id: "dependencies", label: "Dependencies" }, { id: "impact-analysis", label: "Impact Analysis" }, { id: "code-understanding", label: "Code Understanding" }, { id: "ask-kforge", label: "Ask KForge" }, { id: "architecture", label: "Architecture" },
  ] },
  { id: "quality", label: "Quality", views: [
    { id: "sonar", label: "KForge Sonar" }, { id: "problems", label: "Problems" }, { id: "solutions", label: "Solutions" }, { id: "security", label: "Security" }, { id: "performance", label: "Performance" }, { id: "technical-debt", label: "Technical Debt" }, { id: "documentation", label: "Documentation" }, { id: "snapshots", label: "Snapshots" },
  ] },
  { id: "developer-tools", label: "Developer Tools", views: [
    { id: "terminal", label: "Terminal" }, { id: "tests", label: "Tests" }, { id: "build", label: "Build" }, { id: "runtime", label: "Runtime" }, { id: "lint", label: "Lint" }, { id: "logs", label: "Logs" }, { id: "diagnostics", label: "Diagnostics" }, { id: "preview", label: "Preview" },
  ] },
  { id: "remote", label: "Remote / Git", views: [
    { id: "git", label: "Git" }, { id: "branches", label: "Branches" }, { id: "commits", label: "Commits" }, { id: "github", label: "GitHub" }, { id: "pull-requests", label: "Pull Requests" }, { id: "issues", label: "Issues" }, { id: "actions", label: "Actions" }, { id: "releases", label: "Releases" },
  ] },
  { id: "release", label: "Release", views: [
    { id: "release-gate", label: "Release Gate" }, { id: "release-preparation", label: "Release Preparation" }, { id: "artifacts", label: "Artifacts" }, { id: "versioning", label: "Versioning" },
  ] },
  { id: "system", label: "System", views: [
    { id: "settings", label: "Settings" }, { id: "trust", label: "Trust" }, { id: "permissions", label: "Permissions" }, { id: "storage", label: "Storage" }, { id: "online-offline", label: "Online / Offline" }, { id: "self-audit", label: "Self Audit" }, { id: "system-diagnostics", label: "System Diagnostics" },
  ] },
];

export const KFORGE_ACTIVITY_IDS = ACTIVITIES.map((activity) => activity.id);
export const ONLINE_EXPLORER_VIEWS = ACTIVITIES.find((activity) => activity.id === "online")!.views.map((view) => view.id);
export const activityDefinition = (id: KForgeActivity) => ACTIVITIES.find((activity) => activity.id === id)!;
export const defaultView = (id: KForgeActivity) => activityDefinition(id).views[0]?.id || "workspace";
export const activityLabel = (id: KForgeActivity) => activityDefinition(id).label;
export const viewLabel = (activity: KForgeActivity, view: string) => activityDefinition(activity).views.find((entry) => entry.id === view)?.label || view;
