import type { Metadata } from "next";
import { SystemViewer } from "./SystemViewer";

export const metadata: Metadata = {
  title: "DSE & PG Solar Systems",
  description:
    "Interactive solar system diagrams, physical 3D layout and bills of materials for Drua Sailing Experience and Pasana Group.",
  other: {
    "codex-preview": "development",
  },
};

export default function Home() {
  return <SystemViewer />;
}
