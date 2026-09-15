import { notFound, redirect } from "next/navigation";
import { parseViewerPath, viewerHref } from "../viewerRoutes";

export default async function ProjectPage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  const route = parseViewerPath(`/${project}`);
  if (!route) notFound();
  redirect(viewerHref(route.project, route.mode));
}
