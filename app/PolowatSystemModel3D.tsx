"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GrabPointCameraControls } from "./GrabPointCameraControls";
import {
  polowatDeviceById,
  polowatTopology,
  type PolowatConductorKind,
  type PolowatDevice,
} from "./polowatTopology";

type Preset = "whole" | "array" | "equipment" | "batteries";
type Pose = { position: readonly [number, number, number]; target: readonly [number, number, number] };

const presets: readonly { id: Preset; label: string }[] = [
  { id: "whole", label: "Whole system" },
  { id: "array", label: "3-panel array" },
  { id: "equipment", label: "Equipment" },
  { id: "batteries", label: "Battery pair" },
];

const poses: Record<Preset, Pose> = {
  whole: { position: [4.15, 3.65, 5.65], target: [0.20, 1.55, 0.10] },
  array: { position: [-0.35, 3.15, 4.35], target: [-1.24, 2.84, 0.25] },
  equipment: { position: [1.50, 2.10, 2.15], target: [0.43, 1.62, 0.10] },
  batteries: { position: [1.80, 0.92, 2.25], target: [0.16, 0.48, 0.16] },
};

const kindColors: Record<PolowatDevice["kind"], string> = {
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
    const [width, height, depth] = device.size;
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, 0.018),
      new THREE.MeshStandardMaterial({ color: kindColors.enclosure, roughness: 0.82, transparent: true, opacity: 0.70 }),
    );
    back.position.z = -depth / 2;
    group.add(back);
    const frameMaterial = new THREE.MeshStandardMaterial({ color: "#8f8a80", roughness: 0.66 });
    const border = 0.022;
    const horizontal = new THREE.BoxGeometry(width + border, border, depth);
    const vertical = new THREE.BoxGeometry(border, height, depth);
    const top = new THREE.Mesh(horizontal, frameMaterial);
    const bottom = new THREE.Mesh(horizontal, frameMaterial);
    const left = new THREE.Mesh(vertical, frameMaterial);
    const right = new THREE.Mesh(vertical, frameMaterial);
    top.position.y = height / 2;
    bottom.position.y = -height / 2;
    left.position.x = -width / 2;
    right.position.x = width / 2;
    group.add(top, bottom, left, right);
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

function routePoints(from: PolowatDevice, to: PolowatDevice, routeLift: number) {
  const start = new THREE.Vector3(
    from.position[0],
    from.position[1],
    from.position[2] + from.size[2] / 2 + 0.012,
  );
  const end = new THREE.Vector3(
    to.position[0],
    to.position[1],
    to.position[2] + to.size[2] / 2 + 0.012,
  );
  const front = Math.max(start.z, end.z, routeLift);
  const middleX = (start.x + end.x) / 2;
  return [
    start,
    new THREE.Vector3(start.x, start.y, front),
    new THREE.Vector3(middleX, start.y, front),
    new THREE.Vector3(middleX, end.y, front),
    new THREE.Vector3(end.x, end.y, front),
    end,
  ];
}

export function PolowatSystemModel3D() {
  const hostRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<GrabPointCameraControls | null>(null);
  const [preset, setPreset] = useState<Preset>("whole");
  const [selectedId, setSelectedId] = useState("mppt");

  useEffect(() => {
    const host = hostRef.current;
    const tooltip = tooltipRef.current;
    if (!host || !tooltip) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#efe8d8");
    scene.fog = new THREE.Fog("#efe8d8", 8, 18);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 35);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.replaceChildren(renderer.domElement);

    scene.add(new THREE.HemisphereLight("#fffdf4", "#a89578", 2.2));
    const key = new THREE.DirectionalLight("#fff5df", 2.5);
    key.position.set(4, 7, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1536, 1536);
    scene.add(key);
    const fill = new THREE.DirectionalLight("#cfecf1", 0.8);
    fill.position.set(-4, 3, 3);
    scene.add(fill);

    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(6.2, 0.05, 3.3),
      new THREE.MeshStandardMaterial({ color: "#ddcfb6", roughness: 0.96 }),
    );
    floor.position.set(0.15, 0.02, 0.20);
    floor.receiveShadow = true;
    floor.userData.cameraSurface = true;
    scene.add(floor);
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(5.7, 3.7, 0.10),
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
    const deviceObjects = new Map<string, THREE.Object3D>();
    [...polowatTopology.devices]
      .toSorted((first, second) => first.kind === "enclosure" ? -1 : second.kind === "enclosure" ? 1 : 0)
      .forEach((device) => {
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
      const points = routePoints(from, to, connection.routeLift ?? 0.35);
      const curve = new THREE.CatmullRomCurve3(points, false, "centripetal", 0.12);
      const radius = connection.kind === "usb" ? 0.0032 : 0.0046;
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
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects(interactive, false);
    };

    let hoverOutline: THREE.Box3Helper | null = null;
    let hoveredKey = "";
    const render = () => {
      controlsRef.current?.writeDiagnostics(renderer.domElement);
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
      const nextKey = deviceId ? `device:${deviceId}` : connectionId ? `connection:${connectionId}` : "";
      if (nextKey === hoveredKey) return;
      clearHover();
      if (!hit || !nextKey) return;
      hoveredKey = nextKey;
      const target = deviceId ? deviceObjects.get(deviceId) : hit.object;
      if (target) {
        hoverOutline = new THREE.Box3Helper(new THREE.Box3().setFromObject(target), "#fff200");
        (Array.isArray(hoverOutline.material) ? hoverOutline.material : [hoverOutline.material]).forEach((material) => {
          material.depthTest = false;
        });
        hoverOutline.renderOrder = 40;
        scene.add(hoverOutline);
      }
      tooltip.textContent = deviceId
        ? polowatDeviceById.get(deviceId)?.label ?? deviceId
        : String(hit.object.userData.label ?? connectionId);
      tooltip.hidden = false;
      render();
    };

    const controls = new GrabPointCameraControls({
      camera,
      domElement: renderer.domElement,
      onChange: render,
      pickSurface: (clientX, clientY) => {
        const hit = hitsAt(clientX, clientY)[0];
        return hit ? { point: hit.point } : null;
      },
    });
    controlsRef.current = controls;
    const initial = poses.whole;
    controls.setPose(new THREE.Vector3(...initial.position), new THREE.Vector3(...initial.target));

    let down = { x: 0, y: 0, button: 0 };
    const onPointerDown = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY, button: event.button }; };
    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0 || down.button !== 0 || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
      const hit = hitsAt(event.clientX, event.clientY).find((candidate) => candidate.object.userData.deviceId);
      const deviceId = hit?.object.userData.deviceId as string | undefined;
      if (deviceId) setSelectedId(deviceId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.buttons !== 0) return;
      const hit = hitsAt(event.clientX, event.clientY).find((candidate) => (
        candidate.object.userData.connectionId || candidate.object.userData.deviceId
      ));
      setHover(hit);
      renderer.domElement.style.cursor = hit ? "pointer" : "grab";
    };
    const onPointerLeave = () => { clearHover(); render(); };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    renderer.domElement.dataset.system = "inowon-polowat";
    renderer.domElement.dataset.deviceCount = String(polowatTopology.devices.length);
    renderer.domElement.dataset.connectionCount = String(polowatTopology.connections.length);
    renderer.domElement.dataset.modelStatus = "planning-site-inputs-pending";

    return () => {
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      controls.dispose();
      controlsRef.current = null;
      clearHover();
      disposeObject(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  const choosePreset = (id: Preset) => {
    setPreset(id);
    const pose = poses[id];
    controlsRef.current?.setPose(new THREE.Vector3(...pose.position), new THREE.Vector3(...pose.target));
  };
  const selected = polowatDeviceById.get(selectedId) ?? polowatTopology.devices[0];

  return (
    <section className="unified-model polowat-model" data-model="polowat-planning-topology"
      data-device-count={polowatTopology.devices.length} data-connection-count={polowatTopology.connections.length}>
      <div className="model-toolbar" aria-label="Polowat 3D model controls">
        <div className="model-preset-buttons">{presets.map(({ id, label }) => (
          <button key={id} type="button" className={preset === id ? "active" : ""} onClick={() => choosePreset(id)}>{label}</button>
        ))}</div>
        <span className="polowat-model-rating">300 W PV · 12 V / 300 Ah · 150 W peak design load</span>
        <span className="route-runtime">Planning geometry · site dimensions pending</span>
      </div>
      <div className="unified-model-stage">
        <div className="unified-model-canvas" ref={hostRef} />
        <div ref={tooltipRef} className="model-hover-tooltip" role="tooltip" hidden />
        <div className="model-wire-legend polowat-model-legend" aria-label="3D conductor legend">
          <span><i className="wire-red" />Positive</span><span><i className="wire-black" />Negative</span>
          <span><i className="wire-blue" />Regulated / USB</span>
        </div>
        <article className="polowat-model-selection" aria-live="polite">
          <small>{selected.kind}</small><strong>{selected.label}</strong><span>{selected.subtitle}</span>
        </article>
      </div>
    </section>
  );
}
