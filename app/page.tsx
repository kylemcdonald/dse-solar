import type { Metadata } from "next";
import { SystemViewer } from "./SystemViewer";

export const metadata: Metadata = {
  title: "DSE Fiji Solar System",
  description:
    "Canonical wiring diagram, routed 3D installation model, and bill of materials for the DSE Fiji solar system.",
  other: {
    "codex-preview": "development",
  },
};

export default function Home() {
  return <SystemViewer />;
}
