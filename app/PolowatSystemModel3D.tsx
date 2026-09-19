"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { SVGRenderer } from "three/examples/jsm/renderers/SVGRenderer.js";
import { createPolowatShell } from "./polowatShellGeometry";
import { createPolowatAssembly } from "./polowatAssemblyGeometry";
import { assemblyParts } from "./polowatAssembly";
import { polowatCableRoutes, cableCurve } from "./polowatCableRoutes";
import { PolowatModelInspector, type PolowatModelSelection } from "./PolowatModelInspector";
import { GrabPointCameraControls } from "./GrabPointCameraControls";
import {
  polowatDeviceById,
  polowatTopology,
  type PolowatConductorKind,
  type PolowatDevice,
} from "./polowatTopology";

const kindColors: Record<PolowatDevice["kind"], string> = {
  shunt: "#b78643",
  monitor: "#2479ad",
  fuse: "#303940",
  panel: "#24558c",
  battery: "#3f4648",
  breaker: "#f2f0e8",
  controller: "#2479ad",
  bus: "#b78643",
  converter: "#426d93",
  distribution: "#858c88",
  load: "#65716d",
  enclosure: "#d7d2c5",
};

const conductorColors: Record<PolowatConductorKind, string> = {
  positive: "#c83f38",
  negative: "#252b2d",
  pv: "#dd6846",
  series: "#e2a236",
  regulated: "#3b6ea8",
  usb: "#4a82b4",
  data: "#8b68ac",
};

function disposeObject(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => material.dispose());
  });
}

function addPanelDetails(group: THREE.Group, device: PolowatDevice) {
  const lineMaterial = new THREE.LineBasicMaterial({ color: "#8ab5de", transparent: true, opacity: 0.88 });
  for (let column = 1; column < 6; column += 1) {
    const x = -device.size[0] / 2 + device.size[0] * column / 6;
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, -device.size[1] / 2, device.size[2] / 2 + 0.001),
      new THREE.Vector3(x, device.size[1] / 2, device.size[2] / 2 + 0.001),
    ]), lineMaterial));
  }
  for (let row = 1; row < 10; row += 1) {
    const y = -device.size[1] / 2 + device.size[1] * row / 10;
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-device.size[0] / 2, y, device.size[2] / 2 + 0.001),
      new THREE.Vector3(device.size[0] / 2, y, device.size[2] / 2 + 0.001),
    ]), lineMaterial));
  }
}

function addBatteryDetails(group: THREE.Group, device: PolowatDevice) {
  const red = new THREE.MeshStandardMaterial({ color: "#bf443d", metalness: 0.36, roughness: 0.42 });
  const dark = new THREE.MeshStandardMaterial({ color: "#252b2d", metalness: 0.36, roughness: 0.42 });
  [-0.25, 0.25].forEach((fraction, index) => {
    const terminal = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.026, 14), index === 0 ? dark : red);
    terminal.position.set(device.size[0] * fraction, device.size[1] / 2 + 0.013, 0);
    group.add(terminal);
  });
  const strap = new THREE.Mesh(
    new THREE.BoxGeometry(device.size[0] * 1.05, 0.018, device.size[2] * 1.15),
    new THREE.MeshStandardMaterial({ color: "#786f61", roughness: 0.76 }),
  );
  strap.position.y = device.size[1] / 2 + 0.035;
  group.add(strap);
}

function deviceObject(device: PolowatDevice) {
  const group = new THREE.Group();
  group.name = `polowat-device:${device.id}`;
  group.userData.deviceId = device.id;

  if (device.kind === "enclosure") {
    group.add(createPolowatShell(device));
  } else {
    const material = new THREE.MeshStandardMaterial({
      color: kindColors[device.kind],
      roughness: device.kind === "bus" ? 0.32 : 0.62,
      metalness: device.kind === "bus" ? 0.62 : 0.05,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(...device.size), material);
    body.userData.deviceId = device.id;
    group.add(body);

    if (device.kind === "panel") addPanelDetails(group, device);
    if (device.kind === "battery") addBatteryDetails(group, device);
    if (device.kind === "breaker") {
      const toggle = new THREE.Mesh(
        new THREE.BoxGeometry(Math.min(0.020, device.size[0] * 0.55), 0.034, 0.012),
        new THREE.MeshStandardMaterial({ color: "#333638", roughness: 0.45 }),
      );
      toggle.position.set(0, 0.006, device.size[2] / 2 + 0.007);
      toggle.rotation.x = -0.18;
      group.add(toggle);
    }
    if (device.id === "usbCharger") {
      const face = new THREE.Mesh(
        new THREE.BoxGeometry(device.size[0] * 0.72, device.size[1] * 0.58, 0.006),
        new THREE.MeshStandardMaterial({ color: "#172e3d", roughness: 0.45 }),
      );
      face.position.z = device.size[2] / 2 + 0.004;
      group.add(face);
    }
    if (device.id === "devices") {
      const screen = new THREE.Mesh(
        new THREE.BoxGeometry(device.size[0] * 0.72, device.size[1] * 0.72, 0.006),
        new THREE.MeshStandardMaterial({ color: "#9dc2d7", emissive: "#21475a", emissiveIntensity: 0.18 }),
      );
      screen.position.z = device.size[2] / 2 + 0.004;
      group.add(screen);
    }
  }

  group.position.set(...device.position);
  if (device.rotation) group.rotation.set(...device.rotation);
  group.traverse((object) => {
    object.userData.deviceId ??= device.id;
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  return group;
}

export function PolowatSystemModel3D() {
  const hostRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<GrabPointCameraControls | null>(null);
  const [selection, setSelection] = useState<PolowatModelSelection | null>(null);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if(event.key === "Escape") setSelection(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    const tooltip = tooltipRef.current;
    if (!host || !tooltip) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#efe8d8");
    scene.fog = new THREE.Fog("#efe8d8", 8, 18);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 35);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2", { antialias: true });
    const gpu = context ? new THREE.WebGLRenderer({ canvas, context, antialias: true }) : null;
    const software = gpu ? null : new SVGRenderer();
    const renderer = gpu ?? software!;
    const surface = canvas;
    if (gpu) {
      gpu.outputColorSpace = THREE.SRGBColorSpace;
      gpu.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      gpu.shadowMap.enabled = true;
      gpu.shadowMap.type = THREE.PCFSoftShadowMap;
      host.replaceChildren(surface);
    } else {
      surface.style.cssText = "position:absolute;inset:0;width:100%;height:100%;touch-action:none";
      host.replaceChildren(renderer.domElement, surface);
    }
    surface.dataset.renderer = gpu ? "webgl" : "software";

    scene.add(new THREE.HemisphereLight("#fffdf4", "#a89578", 2.2));
    const key = new THREE.DirectionalLight("#fff5df", software ? .85 : 2.5);
    key.position.set(4, 7, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1536, 1536);
    scene.add(key);
    const fill = new THREE.DirectionalLight("#cfecf1", software ? .3 : .8);
    fill.position.set(-4, 3, 3);
    scene.add(fill);

    // Small background faces keep the software painter from covering nearby hardware.
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(6.2, 0.05, 3.3, 24, 1, 16),
      new THREE.MeshStandardMaterial({ color: "#ddcfb6", roughness: 0.96 }),
    );
    floor.position.set(0.15, 0.02, 0.20);
    floor.receiveShadow = true;
    floor.userData.cameraSurface = true;
    scene.add(floor);
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(5.7, 3.7, 0.10, 32, 24, 1),
      new THREE.MeshStandardMaterial({ color: "#d9cfbd", roughness: 0.94 }),
    );
    wall.position.set(0.05, 1.88, -0.16);
    wall.castShadow = true;
    wall.receiveShadow = true;
    wall.userData.cameraSurface = true;
    scene.add(wall);

    const arrayRailMaterial = new THREE.MeshStandardMaterial({ color: "#777d7c", metalness: 0.5, roughness: 0.42 });
    [-2.18, -0.30].forEach((x) => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.035, 1.30, 0.035), arrayRailMaterial);
      rail.position.set(x, 2.86, 0.12);
      rail.rotation.x = -0.22;
      scene.add(rail);
    });

    const interactive: THREE.Object3D[] = [floor, wall];
    const assembly = createPolowatAssembly();
    scene.add(assembly.group);
    interactive.push(...assembly.interactive);
    const deviceObjects = new Map<string, THREE.Object3D>(assembly.devices);
    const detailedIds = new Set(assemblyParts.map(part => part.id));
    [...polowatTopology.devices]
      .toSorted((first, second) => first.kind === "enclosure" ? -1 : second.kind === "enclosure" ? 1 : 0)
      .forEach((device) => {
        if(detailedIds.has(device.id)) return;
        const object = deviceObject(device);
        object.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (mesh.isMesh) interactive.push(mesh);
        });
        deviceObjects.set(device.id, object);
        scene.add(object);
      });

    polowatTopology.connections.forEach((connection) => {
      const from = polowatDeviceById.get(connection.from);
      const to = polowatDeviceById.get(connection.to);
      if (!from || !to) return;
      const route = polowatCableRoutes.routes.find(r => r.id === connection.id)!;
      if (!route.outside.length) return; // Internal segment is rendered by the detailed assembly.
      const points = route.outside;
      const curve = cableCurve(points);
      const radius = route.diameterMm / 2000;
      const wire = new THREE.Mesh(
        new THREE.TubeGeometry(curve, Math.max(18, points.length * 8), radius, 8, false),
        new THREE.MeshStandardMaterial({ color: conductorColors[connection.kind], roughness: 0.58 }),
      );
      wire.userData.connectionId = connection.id;
      wire.userData.label = `${connection.label} · ${connection.gauge}`;
      wire.castShadow = true;
      interactive.push(wire);
      scene.add(wire);
    });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const hitsAt = (clientX: number, clientY: number) => {
      const rect = surface.getBoundingClientRect();
      pointer.set(((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects(interactive, false);
    };

    let hoverOutline: THREE.Box3Helper | null = null;
    let hoveredKey = "";
    const render = () => {
      controlsRef.current?.writeDiagnostics(surface);
      renderer.render(scene, camera);
    };
    const clearHover = () => {
      if (hoverOutline) {
        scene.remove(hoverOutline);
        hoverOutline.geometry.dispose();
        (Array.isArray(hoverOutline.material) ? hoverOutline.material : [hoverOutline.material]).forEach((material) => material.dispose());
        hoverOutline = null;
      }
      hoveredKey = "";
      tooltip.hidden = true;
      tooltip.textContent = "";
    };
    const setHover = (hit?: THREE.Intersection<THREE.Object3D>) => {
      const deviceId = hit?.object.userData.deviceId as string | undefined;
      const connectionId = hit?.object.userData.connectionId as string | undefined;
      const nextKey = hit?.object.userData.info ? hit.object.uuid : deviceId ? `device:${deviceId}` : connectionId ? `connection:${connectionId}` : "";
      if (nextKey === hoveredKey) return;
      clearHover();
      if (!hit || !nextKey) return;
      hoveredKey = nextKey;
      const target = hit.object.userData.info ? hit.object : deviceId ? deviceObjects.get(deviceId) : hit.object;
      if (target) {
        hoverOutline = new THREE.Box3Helper(new THREE.Box3().setFromObject(target), "#fff200");
        (Array.isArray(hoverOutline.material) ? hoverOutline.material : [hoverOutline.material]).forEach((material) => {
          material.depthTest = false;
        });
        hoverOutline.renderOrder = 40;
        scene.add(hoverOutline);
      }
      tooltip.textContent = hit.object.userData.info ? String(hit.object.userData.info).split(".")[0] : deviceId
        ? polowatDeviceById.get(deviceId)?.label ?? deviceId
        : String(hit.object.userData.label ?? connectionId);
      tooltip.hidden = false;
      render();
    };

    const controls = new GrabPointCameraControls({
      camera,
      domElement: surface,
      onChange: render,
      pickSurface: (clientX, clientY) => {
        const hit = hitsAt(clientX, clientY)[0];
        return hit ? { point: hit.point } : null;
      },
    });
    controlsRef.current = controls;
    controls.setPose(new THREE.Vector3(3.4, 3.1, 5.1), new THREE.Vector3(.0, 1.65, .1));

    let down = { x: 0, y: 0, button: 0 };
    const onPointerDown = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY, button: event.button }; };
    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0 || down.button !== 0 || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
      const hit = hitsAt(event.clientX, event.clientY).find(candidate => candidate.object.userData.deviceId || candidate.object.userData.connectionId || candidate.object.userData.info);
      setSelection(hit ? { deviceId: hit.object.userData.deviceId, connectionId: hit.object.userData.connectionId, info: hit.object.userData.info } : null);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.buttons !== 0) return;
      const hit = hitsAt(event.clientX, event.clientY).find((candidate) => (
        candidate.object.userData.connectionId || candidate.object.userData.deviceId || candidate.object.userData.info
      ));
      setHover(hit);
      surface.style.cursor = hit ? "pointer" : "grab";
    };
    const onPointerLeave = () => { clearHover(); render(); };
    surface.addEventListener("pointerdown", onPointerDown);
    surface.addEventListener("pointerup", onPointerUp);
    surface.addEventListener("pointermove", onPointerMove);
    surface.addEventListener("pointerleave", onPointerLeave);

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      if(gpu) gpu.setSize(width, height, false); else software!.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    surface.dataset.system = "inowon-polowat";
    surface.dataset.deviceCount = String(polowatTopology.devices.length);
    surface.dataset.connectionCount = String(polowatTopology.connections.length);
    surface.dataset.modelStatus = "planning-site-inputs-pending";

    return () => {
      observer.disconnect();
      surface.removeEventListener("pointerdown", onPointerDown);
      surface.removeEventListener("pointerup", onPointerUp);
      surface.removeEventListener("pointermove", onPointerMove);
      surface.removeEventListener("pointerleave", onPointerLeave);
      controls.dispose();
      controlsRef.current = null;
      clearHover();
      disposeObject(scene);
      gpu?.dispose();
      surface.remove();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <section className="unified-model polowat-model" data-model="polowat-planning-topology"
      data-device-count={polowatTopology.devices.length} data-connection-count={polowatTopology.connections.length}>
      <div className="unified-model-stage">
        <div className="unified-model-canvas" ref={hostRef} />
        <div ref={tooltipRef} className="model-hover-tooltip" role="tooltip" hidden />
      </div>
      {selection && <div className="inspector-layer"><PolowatModelInspector selection={selection} onClose={() => setSelection(null)} onSelect={setSelection}/></div>}
    </section>
  );
}
