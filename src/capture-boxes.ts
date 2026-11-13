import * as THREE from "three";
import type { ChessPiece } from "./domain";

export const CAPTURE_SCENE_WIDTH = 17.2;

const BOX_WIDTH = 2.9;
const BOX_DEPTH = 5.3;
const BOX_FLOOR_Y = 0.18;
const BOX_RIM_Y = 0.49;
const SLOT_SPACING = 0.82;
const SLOT_COLUMNS = [0, -1, 1];
const SLOT_ROWS = [-0.5, 0.5, -1.5, 1.5, -2.5, 2.5];
const CAPTURE_DURATION = 1.65;
const IMPACT_DURATION = 0.28;
const TRAIL_POINTS = 8;

interface CaptureBox {
  group: THREE.Group;
  home: THREE.Vector3;
  rim: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  impactStart: number | null;
}

interface StoredPiece {
  group: THREE.Group;
  box: CaptureBox;
  slot: number;
  rotation: number;
}

interface CaptureAnimation {
  entry: StoredPiece;
  start: number;
  from: THREE.Vector3;
  lift: THREE.Vector3;
  mouth: THREE.Vector3;
  landing: THREE.Vector3;
  curve: THREE.CubicBezierCurve3;
  impactStart: number | null;
  ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  trail: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
}

function roundedRectangle(width: number, depth: number, radius: number): THREE.Shape {
  const x = -width / 2;
  const y = -depth / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + depth - radius);
  shape.quadraticCurveTo(x + width, y + depth, x + width - radius, y + depth);
  shape.lineTo(x + radius, y + depth);
  shape.quadraticCurveTo(x, y + depth, x, y + depth - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}

function smoothStep(value: number): number {
  return value * value * (3 - 2 * value);
}

export class CaptureBoxes {
  private readonly boxes = new Map<number, CaptureBox>();
  private readonly animations = new Set<CaptureAnimation>();
  private readonly stored = new Map<ChessPiece, StoredPiece>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly woodMaterial: THREE.Material,
    sides: { red: number; black: number },
    private readonly disposePiece: (group: THREE.Group) => void,
  ) {
    this.boxes.set(sides.black, this.createBox(-6.35, "#151c19"));
    this.boxes.set(sides.red, this.createBox(6.35, "#bd4534"));
  }

  get isAnimating(): boolean {
    return this.animations.size > 0;
  }

  has(piece: ChessPiece): boolean {
    return this.stored.has(piece);
  }

  forEachPiece(callback: (piece: ChessPiece, group: THREE.Group) => void): void {
    for (const [piece, entry] of this.stored) callback(piece, entry.group);
  }

  faceView(angle: number): void {
    for (const entry of this.stored.values()) {
      if (entry.group.parent === entry.box.group) entry.group.rotation.y = angle;
    }
  }

  reconcile(activePieces: ReadonlySet<ChessPiece>): void {
    for (const [piece, entry] of this.stored) {
      if (activePieces.has(piece)) this.removeStored(piece, entry);
    }
  }

  finish(): void {
    for (const animation of [...this.animations]) this.finishAnimation(animation);
    this.resetFeedback();
  }

  capture(
    group: THREE.Group,
    piece: ChessPiece,
    side: number,
    elapsed: number,
    reducedMotion: boolean,
  ): void {
    const box = this.boxes.get(side);
    if (!box) throw new Error(`Missing capture box for side ${side}`);
    if (this.stored.has(piece)) throw new Error("棋子已在提子盒内");
    const occupied = new Set(
      [...this.stored.values()].filter(entry => entry.box === box).map(entry => entry.slot),
    );
    let slot = 0;
    while (occupied.has(slot)) slot++;
    if (slot >= SLOT_COLUMNS.length * SLOT_ROWS.length) {
      throw new Error("提子盒已满，棋局状态异常");
    }
    const entry = { group, box, slot, rotation: group.rotation.y };
    this.stored.set(piece, entry);
    for (const child of group.children) {
      if (
        child.userData.selectionRing ||
        child.userData.selectionGlow ||
        child.userData.hoverRing ||
        child.userData.turnGlow
      ) {
        child.visible = false;
      }
    }
    if (reducedMotion) {
      this.storeGroup(entry);
      return;
    }

    const from = group.position.clone();
    const lift = from.clone().add(new THREE.Vector3(0, 0.85, 0));
    const landing = box.home.clone().add(this.slotPosition(slot));
    const mouth = landing.clone();
    mouth.y = BOX_RIM_Y + 0.65;
    const firstControl = lift.clone().lerp(mouth, 0.3);
    const secondControl = lift.clone().lerp(mouth, 0.75);
    firstControl.y = Math.max(lift.y, mouth.y) + 0.75;
    secondControl.y = firstControl.y;

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.425, 0.008, 8, 64),
      new THREE.MeshBasicMaterial({
        color: "#f2d9a0",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.13;
    group.add(ring);

    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 3), 3),
    );
    const trail = new THREE.Line(
      trailGeometry,
      new THREE.LineBasicMaterial({
        color: "#edcb88",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    trail.frustumCulled = false;
    trail.visible = false;
    this.scene.add(trail);

    this.animations.add({
      entry,
      start: elapsed,
      from,
      lift,
      mouth,
      landing,
      curve: new THREE.CubicBezierCurve3(lift, firstControl, secondControl, mouth),
      impactStart: null,
      ring,
      trail,
    });
  }

  update(elapsed: number): void {
    for (const animation of [...this.animations]) {
      const progress = THREE.MathUtils.clamp(
        (elapsed - animation.start) / CAPTURE_DURATION,
        0,
        1,
      );
      const { ring, trail } = animation;
      const { group, box, rotation } = animation.entry;
      ring.material.opacity =
        Math.min(1, progress / 0.07) * (1 - smoothStep(progress)) * 0.55;
      group.rotation.y = rotation + smoothStep(progress) * 0.5;

      if (progress < 0.13) {
        group.position.copy(animation.from);
      } else if (progress < 0.32) {
        const liftProgress = smoothStep((progress - 0.13) / 0.19);
        group.position.lerpVectors(animation.from, animation.lift, liftProgress);
      } else if (progress < 0.82) {
        const flight = (progress - 0.32) / 0.5;
        const eased = smoothStep(flight);
        group.position.copy(animation.curve.getPoint(eased));
        group.rotation.x = Math.sin(flight * Math.PI) * 0.06;
        trail.visible = true;
        trail.material.opacity = Math.sin(flight * Math.PI) * 0.22;
        const positions = trail.geometry.getAttribute("position");
        for (let i = 0; i < TRAIL_POINTS; i++) {
          const point = animation.curve.getPoint(Math.max(0, eased - i * 0.007));
          positions.setXYZ(i, point.x, point.y + 0.1, point.z);
        }
        positions.needsUpdate = true;
      } else {
        const drop = (progress - 0.82) / 0.18;
        group.position.lerpVectors(animation.mouth, animation.landing, drop * drop);
        group.rotation.x = Math.sin(drop * Math.PI) * 0.1;
        group.rotation.y = rotation + (1 - smoothStep(drop)) * 0.5;
        trail.visible = false;
      }

      if (progress >= 1) {
        if (animation.impactStart === null) {
          animation.impactStart = elapsed;
          box.impactStart = elapsed;
        }
        if (elapsed - animation.impactStart >= IMPACT_DURATION) {
          this.finishAnimation(animation);
        }
      }
    }

    for (const box of this.boxes.values()) {
      if (box.impactStart === null) continue;
      const progress = Math.min(1, (elapsed - box.impactStart) / IMPACT_DURATION);
      const shake = Math.sin(progress * Math.PI * 4) * (1 - progress);
      box.group.position.copy(box.home);
      box.group.position.x += shake * 0.012;
      box.group.rotation.z = shake * 0.008;
      box.rim.visible = progress < 1;
      box.rim.material.opacity = Math.sin(progress * Math.PI) * 0.24;
      if (progress >= 1) {
        box.group.position.copy(box.home);
        box.group.rotation.z = 0;
        box.impactStart = null;
      }
    }
  }

  reset(): void {
    for (const [piece, entry] of this.stored) this.removeStored(piece, entry);
    this.resetFeedback();
  }

  private resetFeedback(): void {
    for (const box of this.boxes.values()) {
      box.impactStart = null;
      box.group.position.copy(box.home);
      box.group.rotation.set(0, 0, 0);
      box.rim.visible = false;
      box.rim.material.opacity = 0;
    }
  }

  dispose(): void {
    this.reset();
    const materials = new Set<THREE.Material>();
    for (const box of this.boxes.values()) {
      this.scene.remove(box.group);
      box.group.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const meshMaterials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        for (const material of meshMaterials) {
          if (material !== this.woodMaterial) materials.add(material);
        }
      });
    }
    for (const material of materials) material.dispose();
    this.boxes.clear();
  }

  private createBox(x: number, markerColor: string): CaptureBox {
    const group = new THREE.Group();
    group.position.set(x, 0, 0);
    const base = new THREE.Mesh(
      new THREE.ExtrudeGeometry(roundedRectangle(BOX_WIDTH, BOX_DEPTH, 0.18), {
        depth: 0.14,
        bevelEnabled: true,
        bevelThickness: 0.018,
        bevelSize: 0.018,
        bevelSegments: 3,
        curveSegments: 12,
        steps: 1,
      }),
      this.woodMaterial,
    );
    base.rotation.x = -Math.PI / 2;
    base.position.y = 0.018;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    const shellShape = roundedRectangle(BOX_WIDTH, BOX_DEPTH, 0.18);
    shellShape.holes.push(roundedRectangle(BOX_WIDTH - 0.32, BOX_DEPTH - 0.32, 0.12));
    const shell = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shellShape, {
        depth: 0.32,
        bevelEnabled: true,
        bevelThickness: 0.018,
        bevelSize: 0.018,
        bevelSegments: 3,
        curveSegments: 12,
        steps: 1,
      }),
      this.woodMaterial,
    );
    shell.rotation.x = -Math.PI / 2;
    shell.position.y = 0.15;
    shell.castShadow = true;
    shell.receiveShadow = true;
    group.add(shell);

    const markerMaterial = new THREE.MeshStandardMaterial({
      color: markerColor,
      roughness: 0.85,
      metalness: 0,
    });
    for (const direction of [-1, 1]) {
      const marker = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.14, 0.018, 32),
        markerMaterial,
      );
      marker.rotation.x = Math.PI / 2;
      marker.position.set(0, 0.3, direction * (BOX_DEPTH / 2 + 0.02));
      group.add(marker);
    }

    const rimShape = roundedRectangle(BOX_WIDTH + 0.015, BOX_DEPTH + 0.015, 0.18);
    rimShape.holes.push(roundedRectangle(BOX_WIDTH - 0.06, BOX_DEPTH - 0.06, 0.15));
    const rim = new THREE.Mesh(
      new THREE.ShapeGeometry(rimShape, 12),
      new THREE.MeshBasicMaterial({
        color: "#f2d49a",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = BOX_RIM_Y;
    rim.visible = false;
    group.add(rim);
    this.scene.add(group);
    return { group, home: group.position.clone(), rim, impactStart: null };
  }

  private slotPosition(slot: number): THREE.Vector3 {
    return new THREE.Vector3(
      SLOT_COLUMNS[slot % SLOT_COLUMNS.length] * SLOT_SPACING,
      BOX_FLOOR_Y + 0.005,
      SLOT_ROWS[Math.floor(slot / SLOT_COLUMNS.length)] * SLOT_SPACING,
    );
  }

  private storeGroup(entry: StoredPiece): void {
    entry.box.group.add(entry.group);
    entry.group.position.copy(this.slotPosition(entry.slot));
    entry.group.rotation.set(0, entry.rotation, 0);
    entry.group.visible = true;
  }

  private finishAnimation(animation: CaptureAnimation): void {
    this.storeGroup(animation.entry);
    this.clearAnimation(animation);
  }

  private clearAnimation(animation: CaptureAnimation): void {
    animation.entry.group.remove(animation.ring);
    animation.ring.geometry.dispose();
    animation.ring.material.dispose();
    this.scene.remove(animation.trail);
    animation.trail.geometry.dispose();
    animation.trail.material.dispose();
    this.animations.delete(animation);
  }

  private removeStored(piece: ChessPiece, entry: StoredPiece): void {
    for (const animation of [...this.animations]) {
      if (animation.entry === entry) this.clearAnimation(animation);
    }
    entry.group.visible = false;
    entry.group.removeFromParent();
    this.disposePiece(entry.group);
    this.stored.delete(piece);
  }
}
