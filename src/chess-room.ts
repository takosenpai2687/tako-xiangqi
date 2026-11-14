import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
// CHANGE: textures use FetchTextureLoader (single fetch) instead of THREE.TextureLoader (Range requests).
import { FetchTextureLoader } from "./fetch-texture-loader";
import { roomTextureManifest, type PbrTextureSet } from "./textures";

const FLOOR_Y = -2.6;
// A real washitsu, about 5 m x 4 m with a 2.6 m ceiling at the scale of the low table.
const ROOM_HALF_X = 18;
const ROOM_HALF_Z = 15;
const CEILING_Y = 17;
const LINTEL_Y = 13.2;
const MAT_WIDTH = 6;
const MAT_GAP = 0.12;
const MAT_THICKNESS = 0.3;
const TATAMI_TILE = 4;
const WOOD_TILE = 6;
const TABLE_WIDTH = 17.8;
const TABLE_DEPTH = 12.4;
const LAMP_Y = 8.3;
// Each player's left-hand side. The saucer footprints are baked into
// table-contact-ao.webp by tools/generate-room-textures.py.
const CUP_POSITIONS = [
  new THREE.Vector3(-7.55, 0, 3.6),
  new THREE.Vector3(7.55, 0, -3.6),
];

interface TeaCup {
  side: TeaSide;
  group: THREE.Group;
  vessel: THREE.Group;
  tea: THREE.Mesh;
  staticTea: THREE.BufferGeometry;
  liquid: THREE.BufferGeometry;
  material: THREE.MeshPhysicalMaterial;
  steam: THREE.Points;
  origin: THREE.Vector3;
  hovered: boolean;
}

interface DrinkState {
  cup: TeaCup;
  start: number | null;
  lifted: boolean;
  sipped: boolean;
  placed: boolean;
}

export type TeaSide = "red" | "black";
export type TeaSound = "lift" | "sip" | "place";

const DRINK_DURATION = 3.2;
const GLOW_PERIOD = 1.8;
const GLOW_MIN = 0.1;
const GLOW_MAX = 0.3;
const HOLD_SCREEN_FRACTION = 0.42;
const HOLD_EXTENT = 1.4;
const HOLD_TILT = 1.15;
const CUP_BASE = 0.045;
const CUP_CENTER = new THREE.Vector3(0, 0.45, 0);
const LIQUID_DROP = 0.2;

const easeOutCubic = (value: number): number => 1 - (1 - THREE.MathUtils.clamp(value, 0, 1)) ** 3;
const segment = (time: number, from: number, to: number): number => easeOutCubic((time - from) / (to - from));

interface RoomWall {
  group: THREE.Group;
  outward: THREE.Vector3;
  distance: number;
}

function vectors(points: number[][]): THREE.Vector2[] {
  return points.map(([x, y]) => new THREE.Vector2(x, y));
}

function curve(points: number[][]): THREE.Vector2[] {
  return new THREE.SplineCurve(vectors(points)).getPoints(points.length * 5);
}

/** Surface of revolution; texture V is chosen per profile point instead of by index. */
function revolve(
  profile: THREE.Vector2[],
  v: (radius: number, height: number) => number,
): THREE.LatheGeometry {
  const geometry = new THREE.LatheGeometry(profile, 72);
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) {
    const height = position.getY(i);
    uv.setY(i, v(Math.hypot(position.getX(i), position.getZ(i)), height));
  }
  return geometry;
}

/** Vertex shading by distance from the axis, for baked occlusion and depth tints. */
function shadeByRadius(
  geometry: THREE.BufferGeometry,
  shade: (radius: number, height: number) => THREE.Color,
): void {
  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const height = position.getY(i);
    shade(Math.hypot(position.getX(i), position.getZ(i)), height).toArray(colors, i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

function tabletopShape(width: number, depth: number, radius: number): THREE.Shape {
  const x = -width / 2;
  const z = -depth / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + radius, z);
  shape.lineTo(-x - radius, z);
  shape.quadraticCurveTo(-x, z, -x, z + radius);
  shape.lineTo(-x, -z - radius);
  shape.quadraticCurveTo(-x, -z, -x - radius, -z);
  shape.lineTo(x + radius, -z);
  shape.quadraticCurveTo(x, -z, x, -z - radius);
  shape.lineTo(x, z + radius);
  shape.quadraticCurveTo(x, z, x + radius, z);
  return shape;
}

/** Rounded timber with world-scale UVs; the grain (texture V) follows the longest edge. */
function timberGeometry(
  width: number,
  height: number,
  depth: number,
  radius: number,
  offset: number,
): THREE.BufferGeometry {
  const geometry = new RoundedBoxGeometry(width, height, depth, 3, radius);
  const size = [width, height, depth];
  const grain = size.indexOf(Math.max(...size));
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) {
    const point = [position.getX(i), position.getY(i), position.getZ(i)];
    const facing = [normal.getX(i), normal.getY(i), normal.getZ(i)].map(Math.abs);
    const face = facing.indexOf(Math.max(...facing));
    const across = [0, 1, 2].find(axis => axis !== grain && axis !== face) ?? 0;
    const along = face === grain
      ? [0, 1, 2].find(axis => axis !== grain && axis !== across) ?? 0
      : grain;
    uv.setXY(i, point[across] / WOOD_TILE + offset, point[along] / WOOD_TILE + offset * 1.7);
  }
  return geometry;
}

/** Vertex shading that darkens a surface toward a recessed seam or joint. */
function shadeByHeight(
  geometry: THREE.BufferGeometry,
  low: number,
  high: number,
  lowShade: number,
  highShade: number,
): void {
  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const amount = THREE.MathUtils.smoothstep(position.getY(i), low, high);
    colors.fill(THREE.MathUtils.lerp(lowShade, highShade, amount), i * 3, i * 3 + 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

const TEA_DEEP = new THREE.Color("#a7ba4b");
const TEA_SHALLOW = new THREE.Color("#e3e69f");
const TEA_RIM = new THREE.Color("#fffde0");

function teaShade(radius: number): THREE.Color {
  return TEA_DEEP.clone()
    .lerp(TEA_SHALLOW, THREE.MathUtils.smoothstep(radius, 0.12, 0.47))
    .lerp(TEA_RIM, THREE.MathUtils.smoothstep(radius, 0.485, 0.53));
}

// Inside of the cup as (height, radius), used to cut the liquid surface to the glaze.
const CUP_INSIDE = [
  [0.112, 0], [0.118, 0.18], [0.15, 0.34], [0.225, 0.44], [0.34, 0.494], [0.47, 0.513],
  [0.6, 0.518], [0.72, 0.53], [0.81, 0.548], [0.885, 0.564], [0.9, 0.568],
];
const CUP_MOUTH = 0.89;
const CUP_RIM_RADIUS = 0.585;
const LIQUID_INSET = 0.012;
const LIQUID_RINGS = [0.4, 0.75, 0.92, 1];
const LIQUID_SEGMENTS = 72;

function insideRadius(height: number): number {
  if (height < CUP_INSIDE[0][0] || height > CUP_MOUTH) return -1;
  for (let i = 1; i < CUP_INSIDE.length; i++) {
    const [h1, r1] = CUP_INSIDE[i];
    if (height <= h1) {
      const [h0, r0] = CUP_INSIDE[i - 1];
      return r0 + ((r1 - r0) * (height - h0)) / (h1 - h0) - LIQUID_INSET;
    }
  }
  return -1;
}

function createLiquidGeometry(): THREE.BufferGeometry {
  const count = 1 + LIQUID_RINGS.length * LIQUID_SEGMENTS;
  const geometry = new THREE.BufferGeometry();
  for (const [name, size] of [["position", 3], ["normal", 3], ["color", 3], ["uv", 2], ["teaRadius", 1]] as const) {
    geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(count * size), size));
  }
  const color = teaShade(0);
  color.toArray(geometry.getAttribute("color").array as Float32Array, 0);
  const index: number[] = [];
  for (let s = 0; s < LIQUID_SEGMENTS; s++) {
    const next = (s + 1) % LIQUID_SEGMENTS;
    index.push(0, 1 + next, 1 + s);
    for (let ring = 1; ring < LIQUID_RINGS.length; ring++) {
      const a = 1 + (ring - 1) * LIQUID_SEGMENTS;
      const b = 1 + ring * LIQUID_SEGMENTS;
      index.push(a + s, a + next, b + s, a + next, b + next, b + s);
    }
  }
  geometry.setIndex(index);
  for (let ring = 0; ring < LIQUID_RINGS.length; ring++) {
    const shade = teaShade(LIQUID_RINGS[ring] * 0.53);
    for (let s = 0; s < LIQUID_SEGMENTS; s++) {
      const i = 1 + ring * LIQUID_SEGMENTS + s;
      shade.toArray(geometry.getAttribute("color").array as Float32Array, i * 3);
      (geometry.getAttribute("teaRadius").array as Float32Array)[i] = LIQUID_RINGS[ring] * 0.53;
    }
  }
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 1.2);
  return geometry;
}

/**
 * Cuts the liquid surface, a plane that stays level in the world, to the inside of the
 * cup. `normal` is world-up in cup space; `offset` is the surface height above the cup
 * center along it. The liquid never rises above the lowest point of the lip.
 */
function shapeLiquid(geometry: THREE.BufferGeometry, normal: THREE.Vector3, offset: number): void {
  const rimLow = (CUP_MOUTH - CUP_CENTER.y) * normal.y
    - CUP_RIM_RADIUS * Math.sqrt(Math.max(0, 1 - normal.y * normal.y)) - 0.02;
  const ny = Math.max(normal.y, 0.2);
  const d = normal.y * CUP_CENTER.y + Math.min(offset, rimLow);
  const axisY = THREE.MathUtils.clamp(d / ny, CUP_INSIDE[0][0] + 0.02, CUP_MOUTH - 0.02);
  const plane = axisY * ny;
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const normals = geometry.getAttribute("normal") as THREE.BufferAttribute;
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
  position.setXYZ(0, 0, axisY, 0);
  normals.setXYZ(0, normal.x, normal.y, normal.z);
  uv.setXY(0, 0.5, 0.5);
  const surfaceY = (r: number, cos: number, sin: number): number =>
    (plane - r * (normal.x * cos + normal.z * sin)) / ny;
  for (let s = 0; s < LIQUID_SEGMENTS; s++) {
    const angle = (s / LIQUID_SEGMENTS) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const fits = (r: number): boolean => {
      const wall = insideRadius(surfaceY(r, cos, sin));
      return wall >= r;
    };
    let low = 0;
    let high = 0.2;
    while (fits(high) && high < 0.9) {
      low = high;
      high += 0.04;
    }
    for (let i = 0; i < 9; i++) {
      const mid = (low + high) / 2;
      if (fits(mid)) low = mid;
      else high = mid;
    }
    for (let ring = 0; ring < LIQUID_RINGS.length; ring++) {
      const i = 1 + ring * LIQUID_SEGMENTS + s;
      const r = low * LIQUID_RINGS[ring];
      position.setXYZ(i, r * cos, surfaceY(r, cos, sin), r * sin);
      normals.setXYZ(i, normal.x, normal.y, normal.z);
      uv.setXY(i, (r * cos) / 1.2 + 0.5, (r * sin) / 1.2 + 0.5);
    }
  }
  position.needsUpdate = normals.needsUpdate = uv.needsUpdate = true;
}

function planarUv(geometry: THREE.BufferGeometry, tile: number, vertical: "y" | "z"): void {
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(
      i,
      position.getX(i) / tile,
      (vertical === "y" ? position.getY(i) : position.getZ(i)) / tile,
    );
  }
}

/**
 * Reflection probe of the room: softly glowing shoji walls at the sides, dim plaster
 * at the ends, a lit floor and a dark ceiling. It is kept free of fine structure so
 * glaze and tea pick up broad, calm reflections.
 */
function roomReflections(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const width = 256;
  const height = 128;
  const data = new Uint16Array(width * height * 4);
  const warm = new THREE.Color("#ffcf9a");
  const step = THREE.MathUtils.smoothstep;
  for (let row = 0; row < height; row++) {
    const elevation = ((row + 0.5) / height - 0.5) * Math.PI;
    const wall = step(elevation, -0.12, 0.05) * (1 - step(elevation, 0.5, 0.95));
    const floor = 0.5 * (1 - step(elevation, -0.25, 0.02));
    for (let column = 0; column < width; column++) {
      const azimuth = ((column + 0.5) / width - 0.5) * Math.PI * 2;
      const side = step(Math.abs(Math.cos(azimuth)), 0.3, 0.9);
      const radiance = 0.03 + floor + wall * (1.5 * side + 0.45 * (1 - side));
      const index = (row * width + column) * 4;
      data[index] = THREE.DataUtils.toHalfFloat(warm.r * radiance);
      data[index + 1] = THREE.DataUtils.toHalfFloat(warm.g * radiance);
      data[index + 2] = THREE.DataUtils.toHalfFloat(warm.b * radiance);
      data[index + 3] = THREE.DataUtils.toHalfFloat(1);
    }
  }
  const panorama = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  panorama.mapping = THREE.EquirectangularReflectionMapping;
  panorama.colorSpace = THREE.LinearSRGBColorSpace;
  panorama.magFilter = panorama.minFilter = THREE.LinearFilter;
  panorama.needsUpdate = true;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromEquirectangular(panorama);
  pmrem.dispose();
  panorama.dispose();
  return target;
}

export class ChessRoom {
  readonly group = new THREE.Group();
  readonly ceilingLight = new THREE.SpotLight("#ffb87b", 195, 44, 0.96, 0.7, 2);
  readonly volume = new THREE.Box3(
    new THREE.Vector3(-ROOM_HALF_X, FLOOR_Y, -ROOM_HALF_Z),
    new THREE.Vector3(ROOM_HALF_X, CEILING_Y, ROOM_HALF_Z),
  );
  private readonly walls: RoomWall[] = [];
  private readonly corners: { post: THREE.Mesh; walls: [RoomWall, RoomWall] }[] = [];
  private readonly ceiling = new THREE.Group();
  private readonly steamTime = new THREE.Uniform(0);
  private readonly steamScale = new THREE.Uniform(1);
  private readonly lampInView = new THREE.Uniform(new THREE.Vector3());
  private readonly loader = new FetchTextureLoader();
  private readonly textures = new Set<THREE.Texture>();
  private readonly environment: THREE.WebGLRenderTarget;
  private readonly teaMaterial: THREE.MeshPhysicalMaterial;
  private readonly cups: TeaCup[] = [];
  private drink: DrinkState | null = null;
  private activeSide: TeaSide | null = null;
  onTeaSound: (sound: TeaSound) => void = () => undefined;
  private timberCount = 0;
  private disposed = false;
  private readonly tableTopMaterial = new THREE.MeshStandardMaterial({
    color: "#b9b0a3",
    roughness: 0.74,
    metalness: 0,
    aoMapIntensity: 0.85,
  });
  private readonly tableBaseMaterial = new THREE.MeshStandardMaterial({
    color: "#b9b0a3",
    roughness: 0.78,
    metalness: 0,
    vertexColors: true,
  });
  private readonly timberMaterial = new THREE.MeshStandardMaterial({
    color: "#a39684",
    roughness: 0.95,
    metalness: 0,
  });
  private readonly saucerMaterial = new THREE.MeshStandardMaterial({
    color: "#d2c6b2",
    roughness: 0.6,
    metalness: 0,
    vertexColors: true,
  });

  constructor(
    private readonly scene: THREE.Scene,
    private readonly sourceWood: THREE.MeshStandardMaterial,
    renderer: THREE.WebGLRenderer,
  ) {
    this.environment = roomReflections(renderer);
    this.teaMaterial = new THREE.MeshPhysicalMaterial({
      color: "#ffffff",
      vertexColors: true,
      roughness: 0.02,
      clearcoat: 1,
      clearcoatRoughness: 0.015,
      specularIntensity: 1,
      transmission: 0.92,
      thickness: 0.45,
      attenuationColor: new THREE.Color("#b6c658"),
      attenuationDistance: 0.55,
      ior: 1.33,
      envMap: this.environment.texture,
      envMapIntensity: 2.2,
      normalScale: new THREE.Vector2(0.04, 0.04),
    });
    // Lamp light refracted through the thin edge of the liquid lands on the glaze
    // as a bright rim just inside the cup wall.
    this.teaMaterial.onBeforeCompile = shader => {
      shader.vertexShader = `attribute float teaRadius;\nvarying float vTeaRadius;\n${shader.vertexShader}`.replace(
        "#include <begin_vertex>", "#include <begin_vertex>\nvTeaRadius = teaRadius;",
      );
      shader.fragmentShader = `varying float vTeaRadius;\n${shader.fragmentShader}`.replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
float teaRim = smoothstep(0.455, 0.525, vTeaRadius);
totalEmissiveRadiance += vec3(0.2, 0.21, 0.09) * teaRim * teaRim;
// Fresnel: the surface turns mirror-like at grazing angles and picks up the warm room.
float teaFresnel = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 4.0);
totalEmissiveRadiance += vec3(0.55, 0.48, 0.36) * teaFresnel * 0.5;`,
      );
    };
    this.load(roomTextureManifest.teaNormal, THREE.NoColorSpace, texture => {
      this.teaMaterial.normalMap = texture;
      this.teaMaterial.needsUpdate = true;
    });
    // Contact occlusion grounds the board, boxes and saucers under the overhead light.
    this.tableTopMaterial.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <aomap_fragment>",
        `#include <aomap_fragment>
#ifdef USE_AOMAP
reflectedLight.directDiffuse *= ambientOcclusion;
reflectedLight.directSpecular *= ambientOcclusion;
#endif`,
      );
    };
    this.load(roomTextureManifest.tableContactAO, THREE.NoColorSpace, texture => {
      texture.channel = 1;
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      this.tableTopMaterial.aoMap = texture;
      this.tableTopMaterial.needsUpdate = true;
    });
    this.group.name = "ChessRoom";
    this.buildFloor();
    this.buildTable();
    this.buildWalls();
    this.buildCeiling();
    this.buildTea();
    this.buildOverheadLighting();
    this.syncWoodTextures();
    this.scene.add(this.group);
  }

  update(
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    time: number,
    motionScale = 1,
  ): void {
    const ambientTime = time * motionScale;
    this.steamTime.value = ambientTime;
    this.teaMaterial.normalMap?.offset.set(ambientTime * 0.006, ambientTime * 0.004);
    this.steamScale.value = renderer.domElement.height * camera.projectionMatrix.elements[5] / 2;
    this.lampInView.value
      .copy(this.ceilingLight.position)
      .applyMatrix4(camera.matrixWorldInverse);
    // A wall is cut away while the camera stands outside it, so the board stays in view.
    for (const wall of this.walls) {
      wall.group.visible = camera.position.dot(wall.outward) < wall.distance - 0.6;
    }
    for (const corner of this.corners) {
      corner.post.visible = corner.walls.every(wall => wall.group.visible);
    }
    // Views from above look down into the room through an open ceiling.
    this.ceiling.visible = camera.position.y < CEILING_Y;
    this.updateCups(time, camera);
    this.syncWoodTextures();
  }

  get isDrinking(): boolean {
    return this.drink !== null;
  }

  setActiveSide(side: TeaSide | null): void {
    this.activeSide = side;
    if (side === null || this.drink?.cup.side !== side) this.clearHover();
  }

  private clearHover(): void {
    for (const cup of this.cups) cup.hovered = false;
  }

  /** The cup under the ray, but only if it belongs to the side to move. */
  pickCup(raycaster: THREE.Raycaster): TeaSide | null {
    if (this.activeSide === null) return null;
    const cup = this.cups.find(item => item.side === this.activeSide);
    if (!cup || raycaster.intersectObject(cup.group, true).length === 0) return null;
    return cup.side;
  }

  setHover(side: TeaSide | null): void {
    for (const cup of this.cups) cup.hovered = cup.side === side && side === this.activeSide;
  }

  startDrink(side: TeaSide): boolean {
    const cup = this.cups.find(item => item.side === side);
    if (!cup || this.drink || side !== this.activeSide) return false;
    this.drink = { cup, start: null, lifted: false, sipped: false, placed: false };
    return true;
  }

  // The camera is the drinker's head: the cup is carried to a spot right in front of it,
  // large on screen, then tipped with its mouth toward the viewer.
  private holdPose(camera: THREE.PerspectiveCamera): { center: THREE.Vector3; tiltAxis: THREE.Vector3 } {
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const visible = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const span = Math.min(1, camera.aspect);
    const distance = HOLD_EXTENT / (HOLD_SCREEN_FRACTION * visible * span);
    const center = camera.position.clone()
      .addScaledVector(forward, distance)
      .addScaledVector(up, -0.06 * visible * distance);
    const toViewer = new THREE.Vector3(-forward.x, 0, -forward.z);
    if (toViewer.lengthSq() < 1e-6) toViewer.set(0, 0, 1);
    toViewer.normalize();
    return { center, tiltAxis: new THREE.Vector3(0, 1, 0).cross(toViewer).normalize() };
  }

  private updateCups(time: number, camera: THREE.PerspectiveCamera): void {
    const breath = 0.5 - 0.5 * Math.cos((time / GLOW_PERIOD) * Math.PI * 2);
    for (const cup of this.cups) {
      cup.material.emissiveIntensity = cup.hovered ? GLOW_MIN + (GLOW_MAX - GLOW_MIN) * breath : 0;
    }
    const drink = this.drink;
    if (!drink) return;
    drink.start ??= time;
    const t = time - drink.start;
    const { cup } = drink;
    const rest = cup.origin.clone().add(new THREE.Vector3(0, CUP_BASE + CUP_CENTER.y, 0));
    const hold = this.holdPose(camera);
    const center = new THREE.Vector3();
    let turn = 0;
    let tilt = 0;
    let level = 0;
    if (t < 0.6) {
      if (!drink.lifted) {
        drink.lifted = true;
        this.onTeaSound("lift");
      }
      const travel = segment(t, 0, 0.6);
      center.lerpVectors(rest, hold.center, travel);
      turn = travel;
    } else if (t < 1.8) {
      center.copy(hold.center);
      turn = 1;
      tilt = segment(t, 0.6, 1.2);
      level = segment(t, 0.6, 1.8);
      if (!drink.sipped) {
        drink.sipped = true;
        this.onTeaSound("sip");
      }
    } else if (t < 2.6) {
      const back = segment(t, 1.8, 2.6);
      center.lerpVectors(hold.center, rest.clone().add(new THREE.Vector3(0, 0.3, 0)), back);
      turn = 1 - back;
      tilt = 1 - segment(t, 1.8, 2.2);
      level = 1;
    } else {
      const down = segment(t, 2.6, DRINK_DURATION);
      center.copy(rest).add(new THREE.Vector3(0, 0.3 * (1 - down), 0));
      level = 1 - down;
      // easeOutCubic settles onto the saucer around 2.95s, where the clip's impact lands.
      if (!drink.placed && t > 2.95) {
        drink.placed = true;
        this.onTeaSound("place");
      }
    }
    const rotation = new THREE.Quaternion()
      .setFromAxisAngle(hold.tiltAxis, HOLD_TILT * tilt)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.6 * turn));
    cup.vessel.quaternion.copy(rotation);
    cup.vessel.position
      .copy(center)
      .sub(cup.group.position)
      .sub(CUP_CENTER.clone().applyQuaternion(rotation));
    cup.steam.visible = tilt === 0 && turn === 0;
    // The surface stays level in the world: it is re-cut to the cup every frame.
    cup.tea.geometry = cup.liquid;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation.clone().invert());
    shapeLiquid(cup.liquid, up, 0.68 - CUP_CENTER.y - LIQUID_DROP * level);
    if (t >= DRINK_DURATION) {
      cup.vessel.position.set(0, CUP_BASE, 0);
      cup.vessel.quaternion.identity();
      cup.tea.geometry = cup.staticTea;
      cup.steam.visible = true;
      this.drink = null;
    }
  }

  syncWoodTextures(): void {
    if (this.disposed) return;
    const source = this.sourceWood;
    const woods = [
      this.tableTopMaterial, this.tableBaseMaterial, this.timberMaterial, this.saucerMaterial,
    ];
    for (const material of woods) {
      const sharesAo = material !== this.tableTopMaterial;
      if (
        material.map === source.map &&
        material.normalMap === source.normalMap &&
        material.roughnessMap === source.roughnessMap &&
        (!sharesAo || material.aoMap === source.aoMap)
      ) continue;
      material.map = source.map;
      material.normalMap = source.normalMap;
      material.roughnessMap = source.roughnessMap;
      material.normalScale.copy(source.normalScale);
      // The small saucer needs its grain relief exaggerated to read at all.
      if (material === this.saucerMaterial) material.normalScale.multiplyScalar(2.5);
      if (sharesAo) {
        material.aoMap = source.aoMap;
        material.aoMapIntensity = source.aoMapIntensity;
      }
      material.needsUpdate = true;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.scene.remove(this.group);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.group.traverse(object => {
      if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Points)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
      }
      if (object instanceof THREE.InstancedMesh) object.dispose();
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.environment.dispose();
    this.ceilingLight.shadow.dispose();
  }

  private load(
    url: string,
    colorSpace: THREE.ColorSpace,
    apply: (texture: THREE.Texture) => void,
    repeat?: [number, number],
  ): void {
    const texture = this.loader.load(
      url,
      loaded => {
        if (this.disposed) return;
        apply(loaded);
      },
      undefined,
      error => console.error("棋室 PBR 贴图加载失败:", url, error),
    );
    texture.colorSpace = colorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 16;
    if (repeat) texture.repeat.set(repeat[0], repeat[1]);
    this.textures.add(texture);
  }

  private applyPbr(
    material: THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[],
    set: PbrTextureSet,
    repeat?: [number, number],
  ): void {
    const materials = Array.isArray(material) ? material : [material];
    const maps = [
      ["map", set.albedo, THREE.SRGBColorSpace],
      ["normalMap", set.normal, THREE.NoColorSpace],
      ["roughnessMap", set.roughness, THREE.NoColorSpace],
      ["aoMap", set.ao, THREE.NoColorSpace],
    ] as const;
    for (const [property, url, colorSpace] of maps) {
      this.load(url, colorSpace, texture => {
        for (const target of materials) {
          target[property] = texture;
          target.needsUpdate = true;
        }
      }, repeat);
    }
  }

  private timber(
    parent: THREE.Object3D,
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    radius = 0.03,
    material: THREE.Material = this.timberMaterial,
  ): THREE.Mesh {
    const geometry = timberGeometry(width, height, depth, radius, this.timberCount++ * 0.37);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private buildFloor(): void {
    const subfloor = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: "#120f0c", roughness: 1 }),
    );
    subfloor.rotation.x = -Math.PI / 2;
    subfloor.position.y = FLOOR_Y - MAT_THICKNESS;

    const rush = new THREE.MeshStandardMaterial({
      color: "#ffffff",
      roughness: 1,
      metalness: 0,
      normalScale: new THREE.Vector2(0.75, 0.75),
      vertexColors: true,
    });
    this.applyPbr(rush, roomTextureManifest.tatami);
    const cloth = new THREE.MeshStandardMaterial({
      color: "#3b3327",
      roughness: 1,
      metalness: 0,
      normalScale: new THREE.Vector2(0.5, 0.5),
    });
    this.applyPbr(cloth, roomTextureManifest.tatami);

    const width = MAT_WIDTH - MAT_GAP;
    const length = MAT_WIDTH * 2 - MAT_GAP;
    const slab = (slabWidth: number, thickness: number, slabLength: number) => {
      const geometry = new RoundedBoxGeometry(slabWidth, thickness, slabLength, 3, 0.045);
      planarUv(geometry, TATAMI_TILE, "z");
      // The rounded edges fall away into the seam between neighbouring mats.
      shadeByHeight(geometry, thickness / 2 - 0.12, thickness / 2 - 0.002, 0.22, 1);
      return geometry;
    };
    // Fifteen mats laid point-symmetrically, so both players face the same floor.
    const layout: [number, number, boolean][] = [
      [-12, -12, true], [0, -12, true], [12, -12, true],
      [-15, -3, false], [-9, -3, false], [0, -6, true], [12, -6, true],
      [0, 0, true],
      [-12, 6, true], [0, 6, true], [9, 3, false], [15, 3, false],
      [-12, 12, true], [0, 12, true], [12, 12, true],
    ];
    const mats = new THREE.InstancedMesh(slab(width, MAT_THICKNESS, length), rush, layout.length * 9);
    const borders = new THREE.InstancedMesh(
      slab(0.26, MAT_THICKNESS + 0.006, length + 0.006), cloth, layout.length * 18,
    );
    const transform = new THREE.Object3D();
    let index = 0;
    // The pattern repeats past the walls, so cut-away views never run out of floor.
    for (let tileX = -1; tileX <= 1; tileX++) {
      for (let tileZ = -1; tileZ <= 1; tileZ++) {
        for (const [x, z, turned] of layout) {
          const centerX = x + tileX * ROOM_HALF_X * 2;
          const centerZ = z + tileZ * ROOM_HALF_Z * 2;
          transform.rotation.y = turned ? Math.PI / 2 : 0;
          transform.position.set(centerX, FLOOR_Y - MAT_THICKNESS / 2, centerZ);
          transform.updateMatrix();
          mats.setMatrixAt(index, transform.matrix);
          for (const [edge, side] of [-1, 1].entries()) {
            const inset = side * (width / 2 - 0.127);
            transform.position.set(
              centerX + (turned ? 0 : inset), FLOOR_Y - MAT_THICKNESS / 2, centerZ + (turned ? inset : 0),
            );
            transform.updateMatrix();
            borders.setMatrixAt(index * 2 + edge, transform.matrix);
          }
          index++;
        }
      }
    }
    for (const mesh of [subfloor, mats, borders]) {
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  private buildTable(): void {
    const bevel = 0.14;
    const depth = 0.36;
    const geometry = new THREE.ExtrudeGeometry(
      tabletopShape(TABLE_WIDTH - bevel * 2, TABLE_DEPTH - bevel * 2, 1),
      {
        depth,
        bevelEnabled: true,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: 6,
        curveSegments: 20,
        steps: 1,
      },
    );
    const position = geometry.getAttribute("position");
    const uv = geometry.getAttribute("uv");
    const contactUv = new Float32Array(uv.count * 2);
    for (let i = 0; i < uv.count; i++) {
      const x = position.getX(i);
      const y = position.getY(i);
      // The grain follows the long edge; the thickness keeps the rounded rim from smearing.
      uv.setXY(i, (y + position.getZ(i)) / 9, x / 9);
      contactUv[i * 2] = x / TABLE_WIDTH + 0.5;
      contactUv[i * 2 + 1] = 0.5 - y / TABLE_DEPTH;
    }
    geometry.setAttribute("uv1", new THREE.BufferAttribute(contactUv, 2));
    const top = new THREE.Mesh(geometry, this.tableTopMaterial);
    top.rotation.x = -Math.PI / 2;
    top.position.y = -(depth + bevel);
    top.castShadow = top.receiveShadow = true;
    this.group.add(top);

    const underside = -(depth + bevel * 2);
    const apronHeight = 0.54;
    const legHeight = underside - FLOOR_Y;
    const base = (width: number, height: number, length: number, x: number, y: number, z: number, radius: number) => {
      const mesh = this.timber(this.group, width, height, length, x, y, z, radius, this.tableBaseMaterial);
      // Darken toward the joint under the tabletop.
      shadeByHeight(mesh.geometry, height / 2 - 0.7, height / 2, 1, 0.42);
      mesh.castShadow = true;
    };
    for (const z of [-4.95, 4.95]) {
      base(15.1, apronHeight, 0.32, 0, underside - apronHeight / 2, z, 0.04);
    }
    for (const x of [-7.55, 7.55]) {
      base(0.32, apronHeight, 9.9, x, underside - apronHeight / 2, 0, 0.04);
      for (const z of [-4.95, 4.95]) {
        base(1.1, legHeight, 1.1, x, underside - legHeight / 2, z, 0.1);
      }
    }
  }

  private buildWalls(): void {
    const paper = new THREE.MeshPhysicalMaterial({
      color: "#ffffff",
      roughness: 1,
      metalness: 0,
      transmission: 0.12,
      thickness: 0.02,
      ior: 1.3,
      emissive: "#d2b07a",
      emissiveIntensity: 0.13,
      normalScale: new THREE.Vector2(0.55, 0.55),
      aoMapIntensity: 0.6,
    });
    this.applyPbr(paper, roomTextureManifest.paper);
    const plaster = new THREE.MeshStandardMaterial({
      color: "#ffffff",
      roughness: 1,
      metalness: 0,
      normalScale: new THREE.Vector2(0.5, 0.5),
      aoMapIntensity: 0.6,
    });
    this.applyPbr(plaster, roomTextureManifest.plaster);

    const height = CEILING_Y - FLOOR_Y;
    const middle = (CEILING_Y + FLOOR_Y) / 2;
    const face = (
      parent: THREE.Object3D,
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      tile: number,
      y: number,
      z: number,
    ) => {
      planarUv(geometry, tile, "y");
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(0, y, z);
      // Planes must face the room so the depth passes (SSAO, haze, focus) include them.
      mesh.rotation.y = Math.PI;
      mesh.receiveShadow = true;
      parent.add(mesh);
    };

    // One sliding shoji door: stiles proud of the rails, a centre muntin and five
    // glazing bars set in front of the paper, giving two columns of six wide panes.
    const sill = 0.16;
    const lintel = 0.6;
    const post = 0.7;
    const cornerPost = 0.8;
    const stile = 0.3;
    const topRail = 0.34;
    const bottomRail = 0.7;
    const doorHeight = LINTEL_Y - FLOOR_Y - sill;
    const paneHeight = doorHeight - topRail - bottomRail;
    const bayStart = post / 2;
    const bayEnd = ROOM_HALF_Z - cornerPost / 2;
    const doorWidth = (bayEnd - bayStart + stile) / 2;
    const paneWidth = doorWidth - stile * 2;
    const door = new THREE.Group();
    for (const side of [-1, 1]) {
      this.timber(door, stile, doorHeight, 0.24, side * (doorWidth - stile) / 2, doorHeight / 2, 0);
    }
    this.timber(door, paneWidth, bottomRail, 0.2, 0, bottomRail / 2, 0, 0.02);
    this.timber(door, paneWidth, topRail, 0.2, 0, doorHeight - topRail / 2, 0, 0.02);
    this.timber(door, 0.12, paneHeight, 0.15, 0, bottomRail + paneHeight / 2, -0.03, 0.02);
    for (let bar = 1; bar < 6; bar++) {
      this.timber(door, paneWidth, 0.12, 0.13, 0, bottomRail + bar * paneHeight / 6, -0.03, 0.02);
    }
    face(door, new THREE.PlaneGeometry(paneWidth, paneHeight), paper, 3, bottomRail + paneHeight / 2, 0.04);

    // Local -Z faces the room. The end walls are plain plaster; only the side walls are shoji.
    for (let side = 0; side < 4; side++) {
      const group = new THREE.Group();
      const angle = side * Math.PI / 2;
      const shoji = side % 2 === 1;
      const distance = shoji ? ROOM_HALF_X : ROOM_HALF_Z;
      const span = (shoji ? ROOM_HALF_Z : ROOM_HALF_X) * 2;
      group.rotation.y = angle;
      group.position.set(Math.sin(angle) * distance, 0, Math.cos(angle) * distance);
      this.walls.push({
        group, distance, outward: new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)),
      });
      this.group.add(group);
      // Ceiling cornice.
      this.timber(group, span, 0.4, 0.5, 0, CEILING_Y - 0.2, -0.25, 0.04);
      if (!shoji) {
        face(group, new THREE.BoxGeometry(span + 1.2, height, 0.6), plaster, 6, middle, 0.3);
        this.timber(group, span, 0.5, 0.14, 0, FLOOR_Y + 0.25, -0.07);
        continue;
      }

      // Sill and head tracks, a structural post, and plaster up to the ceiling.
      this.timber(group, span, sill, 0.6, 0, FLOOR_Y + sill / 2, -0.05);
      this.timber(group, span, lintel, 0.6, 0, LINTEL_Y + lintel / 2, -0.05, 0.05);
      this.timber(group, post, height, post, 0, middle, -0.05, 0.06);
      face(
        group,
        new THREE.BoxGeometry(span, CEILING_Y - LINTEL_Y - lintel, 0.3),
        plaster,
        6,
        (CEILING_Y + LINTEL_Y + lintel) / 2,
        0.15,
      );
      // Two doors per bay on separate tracks, overlapping at their meeting stiles.
      for (const bay of [-1, 1]) {
        const placements = [
          [bayStart + doorWidth / 2, 0.08],
          [bayEnd - doorWidth / 2, -0.18],
        ];
        for (const [x, track] of placements) {
          const leaf = door.clone();
          leaf.position.set(bay * x, FLOOR_Y + sill, track);
          group.add(leaf);
        }
      }
    }

    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const corner = this.timber(
        this.group, cornerPost, height, cornerPost, x * ROOM_HALF_X, middle, z * ROOM_HALF_Z, 0.06,
      );
      this.corners.push({
        post: corner,
        walls: [this.walls[z > 0 ? 0 : 2], this.walls[x > 0 ? 1 : 3]],
      });
    }
  }

  private buildCeiling(): void {
    const boards = new THREE.PlaneGeometry(ROOM_HALF_X * 2, ROOM_HALF_Z * 2);
    planarUv(boards, WOOD_TILE, "y");
    const deck = new THREE.Mesh(boards, this.timberMaterial);
    deck.rotation.x = Math.PI / 2;
    deck.position.y = CEILING_Y;
    this.ceiling.add(deck);
    for (let beam = -2; beam <= 2; beam++) {
      this.timber(this.ceiling, 0.5, 0.45, ROOM_HALF_Z * 2, beam * 6, CEILING_Y - 0.225, 0, 0.04);
    }
    this.group.add(this.ceiling);
  }

  private buildTea(): void {
    const makeCeladon = (): THREE.MeshPhysicalMaterial => {
    const celadon = new THREE.MeshPhysicalMaterial({
      color: "#ffffff",
      // The roughness map sits at 0.18: a broad, soft highlight rather than a hard glint.
      roughness: 1,
      metalness: 0,
      clearcoat: 0.3,
      clearcoatRoughness: 0.18,
      envMap: this.environment.texture,
      envMapIntensity: 0.45,
      normalScale: new THREE.Vector2(1.2, 1.2),
      aoMapIntensity: 1,
      emissive: new THREE.Color("#8fd3b8"),
      emissiveIntensity: 0,
    });
    // Faint subsurface scatter: lamp light wraps past the terminator and glows
    // back through the thin wall, as it does in translucent celadon.
    celadon.onBeforeCompile = shader => {
      shader.uniforms.uLampView = this.lampInView;
      shader.fragmentShader = `uniform vec3 uLampView;\n${shader.fragmentShader}`.replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
vec3 lampDirection = normalize(uLampView + vViewPosition);
float wrap = clamp((dot(normal, lampDirection) + 0.6) / 1.6, 0.0, 1.0);
float through = pow(clamp(dot(normalize(vViewPosition), -normalize(lampDirection + normal * 0.5)), 0.0, 1.0), 2.0);
totalEmissiveRadiance += vec3(0.05, 0.075, 0.065) * diffuseColor.rgb * (0.5 * wrap * wrap + through);`,
      );
    };
    return celadon;
    };
    const celadons = [makeCeladon(), makeCeladon()];
    this.applyPbr(celadons, roomTextureManifest.celadon, [2, 1]);
    // Tall wide-mouthed cup: small foot, rounded belly, near-upright wall, flared thin lip.
    const cupHeight = 0.906;
    const outerGeometry = revolve([
      ...vectors([[0.2, 0], [0.25, 0], [0.258, 0.02], [0.25, 0.07]]),
      ...curve([
        [0.27, 0.085], [0.38, 0.13], [0.47, 0.22], [0.52, 0.34], [0.537, 0.47],
        [0.545, 0.6], [0.56, 0.72], [0.585, 0.82], [0.612, 0.89],
      ]),
      ...vectors([[0.62, 0.896], [0.622, 0.902], [0.616, 0.91], [0.6, cupHeight + 0.008]]),
    ], (_radius, height) => height / cupHeight);
    // The inside samples the thin pale glaze near the rim of the same texture.
    const innerGeometry = revolve([
      ...vectors([[0.6, cupHeight + 0.008], [0.58, cupHeight + 0.006], [0.568, 0.9]]),
      ...curve([
        [0.564, 0.885], [0.548, 0.81], [0.53, 0.72], [0.518, 0.6], [0.509, 0.47],
        [0.494, 0.34], [0.44, 0.225], [0.34, 0.15], [0.18, 0.118], [0, 0.112],
      ]),
    ], (_radius, height) => 0.88 + 0.08 * height / cupHeight);
    // The liquid stops well short of the lip. Its meniscus climbs the glaze, so the
    // surface is gently curved; it is deepest green in the middle and turns into
    // a bright refracted rim where the tea thins against the wall.
    const teaGeometry = new THREE.LatheGeometry(
      curve([[0.537, 0.694], [0.526, 0.685], [0.497, 0.681], [0.3, 0.68], [0, 0.68]]), 72,
    );
    planarUv(teaGeometry, 1.2, "z");
    shadeByRadius(teaGeometry, radius => teaShade(radius));
    teaGeometry.setAttribute("teaRadius", new THREE.BufferAttribute(
      Float32Array.from({ length: teaGeometry.getAttribute("position").count }, (_, i) =>
        Math.hypot(teaGeometry.getAttribute("position").getX(i), teaGeometry.getAttribute("position").getZ(i))),
      1,
    ));
    // Thin walnut saucer: a flat well inside a raised rounded rim.
    const saucerGeometry = new THREE.LatheGeometry(vectors([
      [0, 0], [0.56, 0], [0.66, 0.028], [0.7, 0.07], [0.69, 0.092], [0.665, 0.094],
      [0.63, 0.075], [0.56, 0.052], [0.5, 0.047], [0.44, 0.046], [0.4, 0.045], [0.36, 0.045],
      [0.33, 0.045], [0.3, 0.045], [0.28, 0.045], [0.26, 0.045], [0.24, 0.045], [0, 0.045],
    ]), 72);
    planarUv(saucerGeometry, 3, "z");
    // Baked soft contact occlusion where the foot of the cup meets the well.
    const lit = new THREE.Color();
    shadeByRadius(saucerGeometry, (radius, height) => lit.setScalar(
      height < 0.04 || radius > 0.6 ? 1 : 1 - 0.7 * Math.exp(-Math.max(radius - 0.25, 0) / 0.1),
    ));
    const steamMaterial = this.steamMaterial();
    for (const [index, position] of CUP_POSITIONS.entries()) {
      const celadon = celadons[index];
      const group = new THREE.Group();
      group.name = position.z > 0 ? "RedLeftHandTea" : "BlackLeftHandTea";
      group.position.copy(position);
      this.group.add(group);
      const saucer = new THREE.Mesh(saucerGeometry, this.saucerMaterial);
      const outer = new THREE.Mesh(outerGeometry, celadon);
      const inner = new THREE.Mesh(innerGeometry, celadon);
      const tea = new THREE.Mesh(teaGeometry, this.teaMaterial);
      for (const mesh of [saucer, outer, inner, tea]) {
        if (mesh !== saucer) mesh.position.y = 0.045;
        mesh.castShadow = mesh !== tea;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      // The saucer stays on the table; only cup and tea travel.
      const vessel = new THREE.Group();
      vessel.position.y = 0.045;
      outer.position.y = inner.position.y = tea.position.y = 0;
      group.add(vessel);
      vessel.add(outer, inner, tea);

      // Steam leaves the whole liquid surface, not a single point.
      const count = 40;
      const positions = new Float32Array(count * 3);
      const phases = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const radius = 0.26 * Math.sqrt((i + 0.5) / count);
        positions[i * 3] = Math.cos(i * 2.399963) * radius;
        positions[i * 3 + 2] = Math.sin(i * 2.399963) * radius;
        phases[i] = (i * 0.618034) % 1;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 2.4);
      const steam = new THREE.Points(geometry, steamMaterial);
      steam.name = "TeaSteam";
      steam.raycast = () => undefined;
      vessel.add(steam);
      this.cups.push({
        side: position.z > 0 ? "red" : "black",
        group,
        vessel,
        tea,
        staticTea: teaGeometry,
        liquid: createLiquidGeometry(),
        material: celadon,
        steam,
        origin: position.clone(),
        hovered: false,
      });
    }
  }

  private buildOverheadLighting(): void {
    this.ceilingLight.position.set(0, LAMP_Y - 0.05, 0);
    this.ceilingLight.target.position.set(0, 0.53, 0);
    this.ceilingLight.castShadow = true;
    this.ceilingLight.shadow.mapSize.set(2048, 2048);
    this.ceilingLight.shadow.camera.near = 0.2;
    this.ceilingLight.shadow.camera.far = 44;
    this.ceilingLight.shadow.bias = -0.00005;
    this.ceilingLight.shadow.normalBias = 0.012;
    this.ceilingLight.shadow.radius = 3.5;
    this.ceilingLight.shadow.intensity = 0.72;
    // Keep the fill and light shafts while leaving the overhead fixture invisible.
    const glow = new THREE.PointLight("#ffb87b", 130, 70, 2);
    glow.position.set(0, LAMP_Y + 3, 0);
    this.group.add(this.ceilingLight, this.ceilingLight.target, glow);
  }

  private steamMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      name: "TeaSteam",
      uniforms: { uTime: this.steamTime, uPointScale: this.steamScale },
      vertexShader: `
uniform float uTime;
uniform float uPointScale;
attribute float aPhase;
varying float vFade;
varying float vSeed;
void main() {
  float rise = fract(aPhase + uTime * 0.12);
  float seed = aPhase * 61.0;
  // Rises off the liquid, widening and wandering instead of standing as a column.
  vec3 p = position;
  p.xz *= 1.0 + rise * 1.7;
  p.y = 0.74 + rise * 2.3;
  p.x += (sin(rise * 5.0 + seed + uTime * 0.13) + 0.6 * sin(rise * 11.0 - seed * 1.7 + uTime * 0.07)) * rise * 0.17;
  p.z += (cos(rise * 4.2 - seed * 1.3 + uTime * 0.1) + 0.6 * cos(rise * 9.0 + seed * 2.3)) * rise * 0.14;
  p.x += sin(uTime * 0.05 + rise * 2.4) * rise * rise * 0.3;
  vec4 view = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * view;
  gl_PointSize = clamp(uPointScale * (0.28 + rise * 0.95) / -view.z, 1.0, 200.0);
  // Densest just above the surface, thinning steadily as it climbs.
  float fadeIn = smoothstep(0.0, 0.06, rise);
  float fadeOut = pow(1.0 - rise, 1.8);
  float breath = 0.78 + 0.22 * sin(uTime * 0.45 + seed);
  vFade = fadeIn * fadeOut * breath;
  vSeed = seed;
}`,
      fragmentShader: `
varying float vFade;
varying float vSeed;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float wisp = 0.72 + 0.28 * sin(p.x * 3.4 + vSeed) * sin(p.y * 2.7 - vSeed * 1.3);
  float body = exp(-dot(p, p) * 2.8) * wisp * (1.0 - smoothstep(0.75, 1.0, length(p)));
  gl_FragColor = vec4(vec3(0.84, 0.81, 0.74), body * vFade * 0.15);
}`,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
  }
}
