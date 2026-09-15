"use client";

import { useEffect, useSyncExternalStore, type MouseEvent } from "react";
import { parseViewerPath, viewerHref, type ViewerRoute } from "./viewerRoutes";

const navigationEvent = "viewer:navigate";
function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(navigationEvent, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(navigationEvent, onChange);
  };
}
const currentPath = () => window.location.pathname;

/** The same URL state supports the server-rendered viewer and static Pages build. */
export function useViewerRoute(initialRoute: ViewerRoute) {
  const pathname = useSyncExternalStore(subscribe, currentPath, () => viewerHref(initialRoute.project, initialRoute.mode));
  const route = parseViewerPath(pathname);
  useEffect(() => {
    // Server routes redirect these aliases; the static build normalizes them here.
    const current = parseViewerPath(window.location.pathname);
    if (!current) return;
    const canonical = viewerHref(current.project, current.mode);
    if (window.location.pathname !== canonical) {
      window.history.replaceState(window.history.state, "", canonical + window.location.search + window.location.hash);
      window.dispatchEvent(new Event(navigationEvent));
    }
  }, [pathname]);
  return route;
}

/** Keep the mounted viewer on ordinary clicks; modified clicks use native links. */
export function navigateViewer(event: MouseEvent<HTMLAnchorElement>) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const href = event.currentTarget.getAttribute("href")!;
  if (href === window.location.pathname) return;
  window.history.pushState(null, "", href);
  window.dispatchEvent(new Event(navigationEvent));
  window.scrollTo({ top: 0 });
}
