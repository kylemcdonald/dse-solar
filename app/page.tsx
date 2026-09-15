import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "DSE Fiji + Inowon Polowat Solar Systems",
  description:
    "Wiring diagrams, 3D installation models, bills of materials, and cost plans for the DSE Fiji and Inowon Polowat solar systems.",
  other: {
    "codex-preview": "development",
  },
};

export default function Home() {
  redirect("/fiji/diagram");
}
