import { createRoot } from "react-dom/client";
import { SystemViewer } from "@/app/SystemViewer";
import "@/app/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");

createRoot(root).render(<SystemViewer />);
