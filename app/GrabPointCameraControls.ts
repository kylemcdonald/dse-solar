import * as THREE from "three";

export type GrabPointSource = "surface" | "depth-fallback" | "focus-fallback";

export type SurfaceGrab = {
  point: THREE.Vector3;
};

type GrabPointCameraOptions = {
  camera: THREE.PerspectiveCamera;
  domElement: HTMLCanvasElement;
  onChange?: () => void;
  onInteractionStart?: () => void;
  pickSurface: (clientX: number, clientY: number) => SurfaceGrab | null;
};

type DragMode = "orbit" | "pan" | "touch-transform";

const EPSILON = 1e-8;
const ORBIT_RADIANS_PER_PIXEL = 0.0042;
const MAX_FORWARD_Y = 0.965;

/**
 * An ofxGrabCam-inspired camera for Three.js.
 *
 * https://github.com/elliotwoods/ofxGrabCam
 *
 * Each interaction first picks the XYZ position below the pointer. Orbiting
 * rotates both camera position and orientation around that off-axis world
 * point with world-up yaw/pitch, so the grabbed detail stays at the same screen
 * coordinate while camera roll remains locked out. Zooming moves along the
 * camera-to-grab vector for the same reason. When no surface is
 * under the pointer, the last valid projected depth is reused, matching
 * ofxGrabCam's retained-depth behavior.
 */
export class GrabPointCameraControls {
  readonly focusPoint = new THREE.Vector3();

  private readonly camera: THREE.PerspectiveCamera;
  private readonly domElement: HTMLCanvasElement;
  private readonly onChange?: () => void;
  private readonly onInteractionStart?: () => void;
  private readonly pickSurface: GrabPointCameraOptions["pickSurface"];
  private readonly grabPoint = new THREE.Vector3();
  private grabPointSource: GrabPointSource = "focus-fallback";
  private hasGrabPoint = false;
  private lastProjectedDepth: number | null = null;
  private activePointerId: number | null = null;
  private dragMode: DragMode | null = null;
  private lastPointer = new THREE.Vector2();
  private readonly touchPoints = new Map<number, THREE.Vector2>();
  private readonly lastTouchCentroid = new THREE.Vector2();
  private lastTouchDistance = 0;

  minDistance = 0.055;
  maxDistance = 70;

  constructor(options: GrabPointCameraOptions) {
    this.camera = options.camera;
    this.domElement = options.domElement;
    this.onChange = options.onChange;
    this.onInteractionStart = options.onInteractionStart;
    this.pickSurface = options.pickSurface;

    this.domElement.addEventListener("pointerdown", this.handlePointerDown);
    this.domElement.addEventListener("pointermove", this.handlePointerMove);
    this.domElement.addEventListener("pointerup", this.handlePointerUp);
    this.domElement.addEventListener("pointercancel", this.handlePointerUp);
    this.domElement.addEventListener("lostpointercapture", this.handleLostPointerCapture);
    this.domElement.addEventListener("wheel", this.handleWheel, { passive: false });
  }

  setPose(position: THREE.Vector3, target: THREE.Vector3) {
    this.camera.position.copy(position);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(target);
    this.focusPoint.copy(target);
    this.hasGrabPoint = false;
    this.lastProjectedDepth = this.projectedDepth(target);
    this.onChange?.();
  }

  setFocusPoint(point: THREE.Vector3) {
    this.focusPoint.copy(point);
  }

  syncFallbackDepth() {
    this.lastProjectedDepth = this.projectedDepth(this.focusPoint);
  }

  getCameraDistance() {
    return this.camera.position.distanceTo(this.focusPoint);
  }

  getPanWorldPerPixel() {
    const rect = this.domElement.getBoundingClientRect();
    const reference = this.hasGrabPoint ? this.grabPoint : this.focusPoint;
    const distance = Math.max(this.camera.position.distanceTo(reference), this.minDistance);
    return (2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) /
      Math.max(1, rect.height);
  }

  writeDiagnostics(element: HTMLElement) {
    const rect = this.domElement.getBoundingClientRect();
    const projected = (this.hasGrabPoint ? this.grabPoint : this.focusPoint)
      .clone()
      .project(this.camera);
    const screenX = (projected.x * 0.5 + 0.5) * rect.width;
    const screenY = (-projected.y * 0.5 + 0.5) * rect.height;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    element.dataset.cameraControl = "grab-point-upright-orbit";
    element.dataset.cameraDistance = this.getCameraDistance().toFixed(4);
    element.dataset.cameraPosition = this.camera.position.toArray().map((value) => value.toFixed(4)).join(",");
    element.dataset.cameraQuaternion = this.camera.quaternion.toArray().map((value) => value.toFixed(6)).join(",");
    element.dataset.cameraTarget = this.focusPoint.toArray().map((value) => value.toFixed(4)).join(",");
    element.dataset.grabAnchorSource = this.hasGrabPoint ? this.grabPointSource : "preset";
    element.dataset.grabAnchorWorld = (this.hasGrabPoint ? this.grabPoint : this.focusPoint)
      .toArray()
      .map((value) => value.toFixed(4))
      .join(",");
    element.dataset.grabAnchorScreen = `${screenX.toFixed(2)},${screenY.toFixed(2)}`;
    element.dataset.grabMode = this.dragMode ?? "idle";
    element.dataset.touchGestures = "one-finger-orbit-two-finger-pan-pinch";
    element.dataset.activeTouchPoints = String(this.touchPoints.size);
    element.dataset.panWorldPerPixel = this.getPanWorldPerPixel().toFixed(7);
    element.dataset.cameraUprightError = Math.abs(right.y).toExponential(3);
  }

  dispose() {
    this.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.domElement.removeEventListener("pointermove", this.handlePointerMove);
    this.domElement.removeEventListener("pointerup", this.handlePointerUp);
    this.domElement.removeEventListener("pointercancel", this.handlePointerUp);
    this.domElement.removeEventListener("lostpointercapture", this.handleLostPointerCapture);
    this.domElement.removeEventListener("wheel", this.handleWheel);
  }

  private clientToNdc(clientX: number, clientY: number) {
    const rect = this.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
  }

  private projectedDepth(point: THREE.Vector3) {
    const depth = point.clone().project(this.camera).z;
    return Number.isFinite(depth) && depth > -1 && depth < 1 ? depth : null;
  }

  private grabAt(clientX: number, clientY: number) {
    this.camera.updateMatrixWorld(true);
    const surface = this.pickSurface(clientX, clientY);
    if (surface) {
      this.grabPoint.copy(surface.point);
      this.grabPointSource = "surface";
      this.lastProjectedDepth = this.projectedDepth(this.grabPoint);
      this.hasGrabPoint = true;
      return this.grabPoint;
    }

    const ndc = this.clientToNdc(clientX, clientY);
    if (this.lastProjectedDepth !== null) {
      this.grabPoint.set(ndc.x, ndc.y, this.lastProjectedDepth).unproject(this.camera);
      this.grabPointSource = "depth-fallback";
    } else {
      const direction = new THREE.Vector3(ndc.x, ndc.y, 0.5)
        .unproject(this.camera)
        .sub(this.camera.position)
        .normalize();
      const fallbackDistance = THREE.MathUtils.clamp(
        this.camera.position.distanceTo(this.focusPoint),
        this.minDistance,
        this.maxDistance,
      );
      this.grabPoint.copy(this.camera.position).addScaledVector(direction, fallbackDistance);
      this.grabPointSource = "focus-fallback";
    }
    this.hasGrabPoint = true;
    return this.grabPoint;
  }

  private handlePointerDown = (event: PointerEvent) => {
    if (event.pointerType === "touch") {
      event.preventDefault();
      if (this.touchPoints.size === 0) this.onInteractionStart?.();
      this.touchPoints.set(event.pointerId, new THREE.Vector2(event.clientX, event.clientY));
      try {
        this.domElement.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic test events and older WebKit builds may not expose native
        // pointer capture; document-level touch-action still keeps the gesture.
      }
      this.configureTouchGesture(true);
      this.domElement.style.cursor = "grabbing";
      this.onChange?.();
      return;
    }
    if (!event.isPrimary || event.button > 2 || this.activePointerId !== null) return;
    event.preventDefault();
    this.onInteractionStart?.();
    this.activePointerId = event.pointerId;
    this.dragMode = event.button === 0 && !event.shiftKey ? "orbit" : "pan";
    this.lastPointer.set(event.clientX, event.clientY);
    this.grabAt(event.clientX, event.clientY);
    this.focusPoint.copy(this.grabPoint);
    try {
      this.domElement.setPointerCapture(event.pointerId);
    } catch {
      // See the touch fallback above.
    }
    this.domElement.style.cursor = "grabbing";
    this.onChange?.();
  };

  private handlePointerMove = (event: PointerEvent) => {
    if (event.pointerType === "touch") {
      if (!this.touchPoints.has(event.pointerId)) return;
      event.preventDefault();
      this.touchPoints.set(event.pointerId, new THREE.Vector2(event.clientX, event.clientY));
      if (this.touchPoints.size >= 2) {
        const [first, second] = [...this.touchPoints.values()];
        const centroid = first.clone().add(second).multiplyScalar(0.5);
        const distance = Math.max(1, first.distanceTo(second));
        const deltaX = centroid.x - this.lastTouchCentroid.x;
        const deltaY = centroid.y - this.lastTouchCentroid.y;
        const scale = THREE.MathUtils.clamp(this.lastTouchDistance / distance, 0.72, 1.38);
        if (Number.isFinite(scale) && Math.abs(scale - 1) > 0.0001) this.zoomByScale(scale);
        if (Math.abs(deltaX) + Math.abs(deltaY) > 0.01) this.pan(deltaX, deltaY);
        this.lastTouchCentroid.copy(centroid);
        this.lastTouchDistance = distance;
        return;
      }
      if (this.touchPoints.size === 1 && this.dragMode === "orbit") {
        const current = [...this.touchPoints.values()][0];
        const deltaX = current.x - this.lastPointer.x;
        const deltaY = current.y - this.lastPointer.y;
        this.lastPointer.copy(current);
        if (Math.abs(deltaX) + Math.abs(deltaY) > 0.01) this.orbit(deltaX, deltaY);
      }
      return;
    }
    if (event.pointerId !== this.activePointerId || !this.dragMode) return;
    event.preventDefault();
    const deltaX = event.clientX - this.lastPointer.x;
    const deltaY = event.clientY - this.lastPointer.y;
    this.lastPointer.set(event.clientX, event.clientY);
    if (Math.abs(deltaX) + Math.abs(deltaY) < 0.01) return;
    if (this.dragMode === "orbit") this.orbit(deltaX, deltaY);
    else this.pan(deltaX, deltaY);
  };

  private handlePointerUp = (event: PointerEvent) => {
    if (event.pointerType === "touch") {
      if (!this.touchPoints.has(event.pointerId)) return;
      this.touchPoints.delete(event.pointerId);
      if (this.domElement.hasPointerCapture(event.pointerId)) this.domElement.releasePointerCapture(event.pointerId);
      this.configureTouchGesture(false);
      if (this.touchPoints.size === 0) this.domElement.style.cursor = "grab";
      this.onChange?.();
      return;
    }
    if (event.pointerId !== this.activePointerId) return;
    if (this.domElement.hasPointerCapture(event.pointerId)) {
      this.domElement.releasePointerCapture(event.pointerId);
    }
    this.activePointerId = null;
    this.dragMode = null;
    this.domElement.style.cursor = "grab";
    this.onChange?.();
  };

  private handleLostPointerCapture = (event: PointerEvent) => {
    if (event.pointerType === "touch") {
      if (!this.touchPoints.has(event.pointerId)) return;
      this.touchPoints.delete(event.pointerId);
      this.configureTouchGesture(false);
      if (this.touchPoints.size === 0) this.domElement.style.cursor = "grab";
      this.onChange?.();
      return;
    }
    if (event.pointerId !== this.activePointerId) return;
    this.activePointerId = null;
    this.dragMode = null;
    this.domElement.style.cursor = "grab";
    this.onChange?.();
  };

  private handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    this.onInteractionStart?.();
    const anchor = this.grabAt(event.clientX, event.clientY);
    const deltaPixels = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? event.deltaY * 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? event.deltaY * this.domElement.clientHeight
        : event.deltaY;
    const scale = Math.exp(THREE.MathUtils.clamp(deltaPixels, -240, 240) * 0.0014);
    this.zoomByScale(scale, anchor);
  };

  private configureTouchGesture(repick: boolean) {
    const points = [...this.touchPoints.entries()];
    if (points.length === 0) {
      this.activePointerId = null;
      this.dragMode = null;
      this.lastTouchDistance = 0;
      return;
    }
    if (points.length === 1) {
      const [pointerId, position] = points[0];
      this.activePointerId = pointerId;
      this.dragMode = "orbit";
      this.lastPointer.copy(position);
      if (repick || this.hasGrabPoint) {
        this.grabAt(position.x, position.y);
        this.focusPoint.copy(this.grabPoint);
      }
      return;
    }
    const first = points[0][1];
    const second = points[1][1];
    this.activePointerId = null;
    this.dragMode = "touch-transform";
    this.lastTouchCentroid.copy(first).add(second).multiplyScalar(0.5);
    this.lastTouchDistance = Math.max(1, first.distanceTo(second));
    this.grabAt(this.lastTouchCentroid.x, this.lastTouchCentroid.y);
    this.focusPoint.copy(this.grabPoint);
  }

  private zoomByScale(scale: number, anchor = this.grabPoint) {
    const offset = this.camera.position.clone().sub(anchor);
    const distance = offset.length();
    if (distance < EPSILON) return;
    const nextDistance = THREE.MathUtils.clamp(distance * scale, this.minDistance, this.maxDistance);
    this.camera.position.copy(anchor).addScaledVector(offset, nextDistance / distance);
    this.focusPoint.copy(anchor);
    this.lastProjectedDepth = this.projectedDepth(anchor);
    this.onChange?.();
  }

  private orbit(deltaX: number, deltaY: number) {
    const worldUp = new THREE.Vector3(0, 1, 0);
    const yaw = new THREE.Quaternion().setFromAxisAngle(worldUp, -deltaX * ORBIT_RADIANS_PER_PIXEL);
    const yawedQuaternion = yaw.clone().multiply(this.camera.quaternion).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(yawedQuaternion).normalize();
    const pitch = new THREE.Quaternion().setFromAxisAngle(right, -deltaY * ORBIT_RADIANS_PER_PIXEL);
    let rotation = pitch.clone().multiply(yaw);

    const candidateQuaternion = rotation.clone().multiply(this.camera.quaternion).normalize();
    const candidateForward = new THREE.Vector3(0, 0, -1).applyQuaternion(candidateQuaternion);
    if (Math.abs(candidateForward.y) > MAX_FORWARD_Y) rotation = yaw;

    const offset = this.camera.position.clone().sub(this.grabPoint).applyQuaternion(rotation);
    this.camera.position.copy(this.grabPoint).add(offset);
    const forward = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(rotation.clone().multiply(this.camera.quaternion).normalize())
      .normalize();
    // Reconstruct with world-up after each orbit. The XYZ grab point still
    // remains stationary on screen, but roll is eliminated by construction.
    this.camera.up.copy(worldUp);
    this.camera.lookAt(this.camera.position.clone().add(forward));
    this.focusPoint.copy(this.grabPoint);
    this.lastProjectedDepth = this.projectedDepth(this.grabPoint);
    this.onChange?.();
  }

  private pan(deltaX: number, deltaY: number) {
    const rect = this.domElement.getBoundingClientRect();
    const distance = Math.max(this.camera.position.distanceTo(this.grabPoint), this.minDistance);
    const verticalSpan = 2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const horizontalSpan = verticalSpan * this.camera.aspect;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const translation = right.multiplyScalar(-deltaX * horizontalSpan / Math.max(1, rect.width))
      .addScaledVector(up, deltaY * verticalSpan / Math.max(1, rect.height));
    this.camera.position.add(translation);
    this.focusPoint.add(translation);
    this.lastProjectedDepth = this.projectedDepth(this.grabPoint);
    this.onChange?.();
  }
}
