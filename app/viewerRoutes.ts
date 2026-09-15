let viewerBasePath = "";
/** Static hosts may mount the viewer beneath a repository path. */
export function configureViewerBasePath(base: string) { viewerBasePath = base.replace(/\/$/, ""); }

export type ProjectMode = "dse" | "polowat";
export type ViewerMode = "simple" | "diagram" | "model" | "system" | "bom" | "cost" | "cables" | "notes";
export type ViewerRoute = { project: ProjectMode; mode: ViewerMode };

export const defaultViewerRoute: ViewerRoute = { project: "dse", mode: "diagram" };
export const viewerTabs: Array<{ id: ViewerMode; slug: string; label: string; fijiOnly?: boolean }> = [
  { id: "simple", slug: "simple", label: "Simple diagram", fijiOnly: true },
  { id: "diagram", slug: "diagram", label: "Detailed diagram" },
  { id: "model", slug: "model", label: "3D model" },
  { id: "system", slug: "system", label: "System" },
  { id: "bom", slug: "bom", label: "Bill of materials" },
  { id: "cost", slug: "costs", label: "Costs" },
  { id: "cables", slug: "cables", label: "Wire cut list", fijiOnly: true },
  { id: "notes", slug: "notes", label: "Field notes" },
];

export function tabsForProject(project: ProjectMode) {
  return viewerTabs.filter(tab => project === "dse" || !tab.fijiOnly)
    .map(tab => ({ ...tab, label: project === "polowat" && tab.id === "diagram" ? "Wiring diagram" : tab.label }));
}

export function viewerHref(project: ProjectMode, mode: ViewerMode = "diagram") {
  const tab = tabsForProject(project).find(tab => tab.id === mode);
  return `${viewerBasePath}/${project === "dse" ? "fiji" : "polowat"}/${tab?.slug ?? "diagram"}`;
}

/** Only the two public projects and their visible tabs are valid viewer routes. */
export function parseViewerPath(pathname: string): ViewerRoute | null {
  if (viewerBasePath && (pathname === viewerBasePath || pathname.startsWith(viewerBasePath + "/"))) pathname = pathname.slice(viewerBasePath.length) || "/";
  if (pathname === "/") return defaultViewerRoute;
  const parts = pathname.replace(/\/$/, "").split("/");
  if (parts[0] !== "" || parts.length < 2 || parts.length > 3) return null;
  const project = parts[1] === "fiji" ? "dse" : parts[1] === "polowat" ? "polowat" : null;
  if (!project) return null;
  if (parts.length === 2) return { project, mode: "diagram" };
  const tab = tabsForProject(project).find(tab => tab.slug === parts[2]);
  return tab ? { project, mode: tab.id } : null;
}
