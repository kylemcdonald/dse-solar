import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const path = fileURLToPath(new URL("../data/dse-system.json", import.meta.url));
const document = JSON.parse(await readFile(path, "utf8"));
const detail = document.diagram.views.detail;

if (detail.canvas.width === 2700 && detail.canvas.height === 1560) {
  const scaleX = 1.28;
  const scaleY = 1.32;
  detail.canvas = { width: Math.round(detail.canvas.width * scaleX), height: Math.round(detail.canvas.height * scaleY) };
  detail.nodes = detail.nodes.map((node: { x: number; y: number }) => ({
    ...node,
    x: Math.round(node.x * scaleX),
    y: Math.round(node.y * scaleY),
  }));
  detail.edges = detail.edges.map((edge: { labelAt?: { x: number; y: number }; waypoints?: Array<{ x: number; y: number }> }) => ({
    ...edge,
    ...(edge.labelAt ? { labelAt: { x: Math.round(edge.labelAt.x * scaleX), y: Math.round(edge.labelAt.y * scaleY) } } : {}),
    ...(edge.waypoints ? { waypoints: edge.waypoints.map((point) => ({ x: Math.round(point.x * scaleX), y: Math.round(point.y * scaleY) })) } : {}),
  }));
  await writeFile(path, `${JSON.stringify(document, null, 2)}\n`);
}

process.stdout.write(`${JSON.stringify(detail.canvas)}\n`);
