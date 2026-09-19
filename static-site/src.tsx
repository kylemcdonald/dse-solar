/// <reference types="vite/client" />
import { createRoot } from "react-dom/client";
import { SystemViewer } from "@/app/SystemViewer";
import "@/app/globals.css";

import { configureViewerBasePath } from "@/app/viewerRoutes";
configureViewerBasePath(import.meta.env.BASE_URL);

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");

createRoot(root).render(<SystemViewer />);
