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
    { id: "providers", label: "Providers", group: "Configure AI" }, { id: "models", label: "Models", group: "Configure AI" }, { id: "agents", label: "Agents", group: "Project execution" }, { id: "tasks", label: "Tasks", group: "Project execution" },
  ] },
  { id: "online", label: "Online", views: [
    { id: "discover", label: "Discover", group: "Discover" }, { id: "marketplace", label: "Marketplace", group: "Discover" },
    { id: "extensions", label: "Extensions", group: "Catalog" }, { id: "models", label: "Models", group: "Catalog" }, { id: "agents", label: "Agents", group: "Catalog" }, { id: "tools", label: "Tools", group: "Catalog" }, { id: "integrations", label: "Integrations", group: "Catalog" },
    { id: "installed", label: "Installed", group: "Manage" }, { id: "updates", label: "Updates", group: "Manage" }, { id: "downloads", label: "Downloads", group: "Manage" },
    { id: "providers", label: "Providers", group: "Sources" }, { id: "remote-sources", label: "Remote Sources", group: "Sources" }, { id: "documentation", label: "Documentation", group: "Sources" },
    { id: "security", label: "Security", group: "Trust" }, { id: "activity", label: "Activity", group: "Observe" },
  ] },
  { id: "intelligence", label: "Intelligence", views: [
    { id: "project-graph", label: "Project Graph", group: "Understand the project" }, { id: "dependencies", label: "Dependencies", group: "Understand the project" }, { id: "impact-analysis", label: "Impact Analysis", group: "Explore changes" }, { id: "code-understanding", label: "Code Understanding", group: "Understand the project" }, { id: "ask-kforge", label: "Ask KForge", group: "Explore changes" }, { id: "architecture", label: "Architecture", group: "Understand the project" },
  ] },
  { id: "quality", label: "Quality", views: [
    { id: "sonar", label: "KForge Sonar", group: "Assess" }, { id: "problems", label: "Problems", group: "Assess" }, { id: "solutions", label: "Solutions", group: "Improve and recover" }, { id: "security", label: "Security", group: "Assess" }, { id: "performance", label: "Performance", group: "Assess" }, { id: "technical-debt", label: "Technical Debt", group: "Assess" }, { id: "documentation", label: "Documentation", group: "Improve and recover" }, { id: "snapshots", label: "Snapshots", group: "Improve and recover" },
  ] },
  { id: "developer-tools", label: "Developer Tools", views: [
    { id: "terminal", label: "Terminal", group: "Run and preview" }, { id: "tests", label: "Tests", group: "Verify changes" }, { id: "build", label: "Build", group: "Verify changes" }, { id: "runtime", label: "Runtime", group: "Run and preview" }, { id: "lint", label: "Lint", group: "Verify changes" }, { id: "logs", label: "Logs", group: "Observe" }, { id: "diagnostics", label: "Diagnostics", group: "Observe" }, { id: "preview", label: "Preview", group: "Run and preview" },
  ] },
  { id: "remote", label: "Remote / Git", views: [
    { id: "git", label: "Git", group: "Local repository" }, { id: "branches", label: "Branches", group: "Local repository" }, { id: "commits", label: "Commits", group: "Local repository" }, { id: "github", label: "GitHub", group: "GitHub evidence" }, { id: "pull-requests", label: "Pull Requests", group: "GitHub evidence" }, { id: "issues", label: "Issues", group: "GitHub evidence" }, { id: "actions", label: "Actions", group: "GitHub evidence" }, { id: "releases", label: "Releases", group: "GitHub evidence" },
  ] },
  { id: "release", label: "Release", views: [
    { id: "release-gate", label: "Release Gate", group: "Qualify a release" }, { id: "release-preparation", label: "Release Preparation", group: "Prepare distribution" }, { id: "artifacts", label: "Artifacts", group: "Prepare distribution" }, { id: "versioning", label: "Versioning", group: "Prepare distribution" },
  ] },
  { id: "system", label: "System", views: [
    { id: "settings", label: "Settings", group: "Preferences" }, { id: "trust", label: "Trust", group: "Access and policy" }, { id: "permissions", label: "Permissions", group: "Access and policy" }, { id: "storage", label: "Storage", group: "Maintenance" }, { id: "online-offline", label: "Online / Offline", group: "Access and policy" }, { id: "self-audit", label: "Self Audit", group: "Maintenance" }, { id: "system-diagnostics", label: "System Diagnostics", group: "Maintenance" },
  ] },
];

export const KFORGE_ACTIVITY_IDS = ACTIVITIES.map((activity) => activity.id);
export const ONLINE_EXPLORER_VIEWS = ACTIVITIES.find((activity) => activity.id === "online")!.views.map((view) => view.id);
export const activityDefinition = (id: KForgeActivity) => ACTIVITIES.find((activity) => activity.id === id)!;
export const defaultView = (id: KForgeActivity) => activityDefinition(id).views[0]?.id || "workspace";
export const activityLabel = (id: KForgeActivity) => activityDefinition(id).label;
export const viewLabel = (activity: KForgeActivity, view: string) => activityDefinition(activity).views.find((entry) => entry.id === view)?.label || view;
