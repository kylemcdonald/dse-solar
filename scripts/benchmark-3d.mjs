import { chromium } from "playwright";
import { spawn } from "node:child_process";

const baseUrl = process.env.BENCHMARK_URL ?? "http://127.0.0.1:4173/";
const sampleCount = Number(process.env.BENCHMARK_SAMPLES ?? 5);

async function serverResponds() {
  try {
    return (await fetch(baseUrl)).ok;
  } catch {
    return false;
  }
}

let previewProcess;
if (!(await serverResponds())) {
  previewProcess = spawn(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "preview:pages", "--", "--host", "127.0.0.1", "--port", "4173"],
    { stdio: "ignore" },
  );
  for (let attempt = 0; attempt < 60 && !(await serverResponds()); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!(await serverResponds())) {
    previewProcess.kill("SIGTERM");
    throw new Error(`Could not start the local benchmark server at ${baseUrl}`);
  }
}

function median(values) {
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const browser = await chromium.launch({ headless: true });
const samples = [];

try {
  for (let index = 0; index < sampleCount; index += 1) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    const firstOpenMs = await page.evaluate(async () => {
      const button = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.textContent?.trim() === "3D model");
      if (!(button instanceof HTMLButtonElement)) throw new Error("3D model button not found");
      const startedAt = performance.now();
      button.click();
      while (!document.querySelector('[data-model-ready="true"]')) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return performance.now() - startedAt;
    });
    await page.waitForFunction(() => (
      document.querySelector(".model-canvas")?.getAttribute("data-shadow-state") === "cached"
    ));

    const profile = await page.locator(".model-canvas").evaluate((element) => ({
      batchedDrawCalls: Number(element.dataset.sceneBatchedDrawCalls),
      cableMeshes: Number(element.dataset.sceneCableMeshes),
      firstRenderCpuMs: Number(element.dataset.profileFirstRenderMs),
      geometries: Number(element.dataset.sceneGeometries),
      initializationCpuMs: Number(element.dataset.profileInitializationMs),
      materials: Number(element.dataset.sceneMaterials),
      renderCalls: Number(element.dataset.renderCalls),
      rendererCreationMs: Number(element.dataset.profileRendererCreationMs),
      sceneBuildMs: Number(element.dataset.profileSceneBuildMs),
      shadowCasters: Number(element.dataset.sceneShadowCasters),
    }));

    const tabReturnMs = await page.evaluate(async () => {
      const button = (label) => [...document.querySelectorAll("button")]
        .find((candidate) => candidate.textContent?.trim() === label);
      button("Diagram")?.click();
      while (!document.querySelector(".model-workspace")?.hasAttribute("hidden")) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      const startedAt = performance.now();
      button("3D model")?.click();
      while (document.querySelector(".model-workspace")?.hasAttribute("hidden")) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return performance.now() - startedAt;
    });

    const projectReturn = await page.evaluate(async () => {
      const canvas = document.querySelector(".model-canvas");
      if (!(canvas instanceof HTMLElement)) throw new Error("3D canvas host not found");
      canvas.dataset.benchmarkRenderer = "persistent";
      const button = (label) => [...document.querySelectorAll("button")]
        .find((candidate) => candidate.textContent?.trim() === label);
      button("PG · PNG")?.click();
      while (!document.querySelector(".model-unavailable")) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      const startedAt = performance.now();
      button("DSE · Fiji")?.click();
      while (document.querySelector(".persisted-dse-model")?.hasAttribute("hidden")) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return {
        milliseconds: performance.now() - startedAt,
        rendererReused: document.querySelector(".model-canvas")?.getAttribute("data-benchmark-renderer") === "persistent",
      };
    });

    samples.push({ firstOpenMs, profile, projectReturn, tabReturnMs });
    await page.close();
  }
} finally {
  await browser.close();
  previewProcess?.kill("SIGTERM");
}

const summary = {
  url: baseUrl,
  samples: sampleCount,
  medianFirstOpenMs: Number(median(samples.map((sample) => sample.firstOpenMs)).toFixed(1)),
  medianTabReturnMs: Number(median(samples.map((sample) => sample.tabReturnMs)).toFixed(1)),
  medianProjectReturnMs: Number(median(samples.map((sample) => sample.projectReturn.milliseconds)).toFixed(1)),
  rendererPersistedAcrossProjects: samples.every((sample) => sample.projectReturn.rendererReused),
  medianCpuProfile: Object.fromEntries(
    Object.keys(samples[0].profile).map((key) => [
      key,
      Number(median(samples.map((sample) => sample.profile[key])).toFixed(1)),
    ]),
  ),
};

console.log(JSON.stringify(summary, null, 2));
