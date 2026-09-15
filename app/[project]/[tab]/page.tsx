import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SystemViewer } from "../../SystemViewer";
import { parseViewerPath, tabsForProject } from "../../viewerRoutes";

type Props = { params: Promise<{ project: string; tab: string }> };

async function pageRoute({ params }: Props) {
  const { project, tab } = await params;
  const route = parseViewerPath(`/${project}/${tab}`);
  if (!route) notFound();
  return route;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const route = await pageRoute(props);
  const title = tabsForProject(route.project).find(tab => tab.id === route.mode)!.label;
  return { title: `${route.project === "dse" ? "DSE Fiji" : "Inowon Polowat"} · ${title}` };
}

export default async function ViewerPage(props: Props) {
  return <SystemViewer initialRoute={await pageRoute(props)} />;
}
