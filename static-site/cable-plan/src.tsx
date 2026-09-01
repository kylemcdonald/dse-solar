import { createRoot } from "react-dom/client";
import CablePlanPage from "@/app/cable-plan/page";
import "@/app/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");

createRoot(root).render(<CablePlanPage />);
