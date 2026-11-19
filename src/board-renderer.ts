import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
// CHANGE: textures use FetchTextureLoader (single fetch) instead of THREE.TextureLoader (Range requests).
import { FetchTextureLoader } from "./fetch-texture-loader";
import type {
  BoardAction,
  ChessPiece,
  MoveRecord,
  Position,
} from "./domain";
import { pieceTypeNames } from "./domain";
import { constants } from "./rules";
import { textureManifest } from "./textures";
import { CaptureBoxes, CAPTURE_SCENE_WIDTH } from "./capture-boxes";
import { RoomAtmospherePass } from "./room-atmosphere-pass";
import { FinishPass } from "./finish-pass";
import { DustMotes } from "./dust-motes";
import { loadQuality, type QualitySettings } from "./quality";
import { ChessRoom, type TeaSide, type TeaSound } from "./chess-room";

const BOARD_WIDTH = 8;
// Fixed overview framing: the wooden board body (9.55 x 10.55) plus piece height,
// kept inside this fraction of the viewport (NDC) so the board fills the screen.
const FIXED_FIT_HALF_WIDTH = 4.78;
const FIXED_FIT_HALF_DEPTH = 5.28;
const FIXED_FIT_TOP = 0.9;
const FIXED_FIT_MARGIN = 0.96;
// Camera direction of the fixed overview (red side); steeper means closer to top-down.
const FIXED_VIEW_DIRECTION = new THREE.Vector3(0, 13, 8.2).normalize();
const PORTRAIT_VIEW_DIRECTION = new THREE.Vector3(0, 1, Math.tan(THREE.MathUtils.degToRad(5))).normalize();
const BOARD_DEPTH = 9;
const BOARD_TOP = 0.53;
const PIECE_RADIUS = 0.39;
const PIECE_HEIGHT = 0.25;
const TURN_HALO_REACH = 1.75;
const ATLAS_COLUMNS = 4;
const ATLAS_ROWS = 4;

const PIECE_ATLAS_CELLS: Record<string, [number, number]> = {
  "red-general": [0, 0],
  "red-chariot": [1, 0],
  "red-horse": [2, 0],
  "red-cannon": [3, 0],
  "red-elephant": [0, 1],
  "red-advisor": [1, 1],
  "red-soldier": [2, 1],
  "black-general": [3, 1],
  "black-chariot": [0, 2],
  "black-horse": [1, 2],
  "black-cannon": [2, 2],
  "black-elephant": [3, 2],
  "black-advisor": [0, 3],
  "black-soldier": [1, 3],
};

interface PieceAnimation {
  group: THREE.Group;
  start: number;
  duration: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
}

interface PieceGlyphGlow {
  strength: THREE.Uniform<number>;
  captureStart: number | null;
}

interface CameraTransition {
  start: number;
  duration: number;
  target: THREE.Vector3;
  fromAngle: number;
  angleDelta: number;
  radius: number;
  height: number;
  toRadius: number;
  toHeight: number;
}

interface PointerStart {
  pointerId: number;
  x: number;
  y: number;
  piece: ChessPiece | null;
  dragged: boolean;
}

function createWoodTextures(): { color: THREE.Texture; bump: THREE.Texture } {
  const width = 512;
  const height = 512;
  const colorData = new Uint8Array(width * height * 4);
  const bumpData = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    const v = y / height;
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const broadGrain = Math.sin(u * Math.PI * 22);
      const fineGrain = Math.sin(u * Math.PI * 174 + v * 0.12);
      const pores = Math.sin(u * Math.PI * 386 + v * 0.04);
      const tone = THREE.MathUtils.clamp(
        0.5 + broadGrain * 0.025 + fineGrain * 0.008 + pores * 0.002,
        0,
        1,
      );
      const grainHeight = Math.round(
        THREE.MathUtils.clamp(180 + broadGrain * 3 + fineGrain * 2 + pores, 0, 255),
      );
      const index = (y * width + x) * 4;
      colorData[index] = Math.round(67 + tone * 82);
      colorData[index + 1] = Math.round(39 + tone * 55);
      colorData[index + 2] = Math.round(24 + tone * 34);
      colorData[index + 3] = 255;
      bumpData[index] = grainHeight;
      bumpData[index + 1] = grainHeight;
      bumpData[index + 2] = grainHeight;
      bumpData[index + 3] = 255;
    }
  }

  const color = new THREE.DataTexture(
    colorData,
    width,
    height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  color.colorSpace = THREE.SRGBColorSpace;
  color.wrapS = THREE.RepeatWrapping;
  color.wrapT = THREE.RepeatWrapping;
  color.anisotropy = 8;
  color.generateMipmaps = true;
  color.minFilter = THREE.LinearMipmapLinearFilter;
  color.magFilter = THREE.LinearFilter;
  color.needsUpdate = true;

  const bump = new THREE.DataTexture(
    bumpData,
    width,
    height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  bump.wrapS = THREE.RepeatWrapping;
  bump.wrapT = THREE.RepeatWrapping;
  bump.generateMipmaps = true;
  bump.minFilter = THREE.LinearMipmapLinearFilter;
  bump.magFilter = THREE.LinearFilter;
  bump.needsUpdate = true;
  return { color, bump };
}

export class BoardRenderer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(33, 1, 0.1, 100);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly ssaoPass: SSAOPass;
  private readonly bloomPass: UnrealBloomPass;
  private readonly atmospherePass: RoomAtmospherePass;
  private readonly finishPass = new FinishPass();
  private readonly smaaPass = new SMAAPass();
  private quality: QualitySettings = loadQuality();
  private readonly dust = new DustMotes(new THREE.Vector3(0, 3.2, 0), new THREE.Vector3(12, 5, 10));
  private readonly room: ChessRoom;
  private readonly controls: OrbitControls;
  private readonly captureBoxes: CaptureBoxes;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  private readonly touchDevice = window.matchMedia("(pointer: coarse)");
  private readonly groundPlane = new THREE.Plane(
    new THREE.Vector3(0, 1, 0),
    -BOARD_TOP,
  );
  private readonly pieceMeshes = new Map<ChessPiece, THREE.Group>();
  private readonly pieceAnimations = new Set<PieceAnimation>();
  private readonly woodColorTexture: THREE.Texture;
  private readonly woodBumpTexture: THREE.Texture;
  private readonly moveMarkers = new THREE.Group();
  private readonly hintMarker = new THREE.Group();
  private readonly riverLabels = new THREE.Group();
  private readonly boardSurface = new THREE.Mesh(
    new THREE.PlaneGeometry(BOARD_WIDTH + 0.25, BOARD_DEPTH + 0.25),
    new THREE.MeshStandardMaterial({
      color: "#ffffff",
      roughness: 0.54,
      metalness: 0.01,
    }),
  );
  private readonly resizeObserver: ResizeObserver;
  private readonly now = new THREE.Clock();
  private selectedPiece: ChessPiece | null = null;
  private turnPieces = new Set<ChessPiece>();
  private pointerStart: PointerStart | null = null;
  private cameraTransition: CameraTransition | null = null;
  private wasPortrait = false;
  private pendingViewSide: number | null = null;
  private pieceAtlas: THREE.Texture | null = null;
  private environmentMap!: THREE.Texture;
  private hoveredPiece: ChessPiece | null = null;
  private readonly menuGlyphStrength = new THREE.Uniform(0);
  private readonly pieceGlyphs = new Map<THREE.Group, PieceGlyphGlow>();
  private viewSide: number | null = null;
  private menuMode = true;
  private frameId = 0;
  private onAction: (action: BoardAction) => void = () => undefined;
  private readonly onPointerDownBound = (event: PointerEvent) =>
    this.onPointerDown(event);
  private readonly onPointerMoveBound = (event: PointerEvent) =>
    this.onPointerMove(event);
  private readonly onPointerUpBound = (event: PointerEvent) =>
    this.onPointerUp(event);

  constructor(private readonly viewport: HTMLElement, canvas: HTMLCanvasElement) {
    this.viewSide = constants.sides.red;
    const woodTextures = createWoodTextures();
    this.woodColorTexture = woodTextures.color;
    this.woodBumpTexture = woodTextures.bump;
    this.scene.background = new THREE.Color("#101213");
    this.scene.fog = new THREE.Fog("#101213", 80, 140);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.09;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.ssaoPass = new SSAOPass(this.scene, this.camera, 1, 1, 24);
    this.ssaoPass.kernelRadius = 0.4;
    this.ssaoPass.minDistance = 0.001;
    this.ssaoPass.maxDistance = 0.012;
    this.ssaoPass.copyMaterial.uniforms.opacity.value = 0.42;
    this.ssaoPass.copyMaterial.blendDst = THREE.OneMinusSrcAlphaFactor;
    this.composer.addPass(this.ssaoPass);

    this.camera.position.set(0, 13, 8.2);
    this.camera.lookAt(0, BOARD_TOP, 0);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, BOARD_TOP, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.enabled = false;
    this.controls.enablePan = false;
    // Zoom (wheel / pinch) always dollies toward the board center, never the cursor or fingers.
    this.controls.zoomToCursor = false;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.controls.minDistance = 9;
    this.controls.maxDistance = 48;
    this.controls.minPolarAngle = Math.PI * 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.43;

    this.buildEnvironment();
    this.buildBoard();
    this.room = new ChessRoom(this.scene, this.boardSurface.material, this.renderer);
    this.environmentMap = this.room.environmentMap;
    const sceneDepth = this.ssaoPass.normalRenderTarget.depthTexture;
    if (!sceneDepth) throw new Error("Room atmosphere requires the scene depth texture.");
    this.atmospherePass = new RoomAtmospherePass(
      this.camera, sceneDepth, this.controls.target, this.room.ceilingLight, this.room.volume,
    );
    this.composer.addPass(this.atmospherePass);
    // Only the brightest highlights (lamp, glaze, selection halos) bloom.
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.28, 0.7, 0.92);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.smaaPass);
    this.composer.addPass(this.finishPass);
    this.scene.add(this.dust.points);
    this.setQuality(loadQuality());
    this.captureBoxes = new CaptureBoxes(
      this.scene,
      this.boardSurface.material,
      constants.sides,
      group => this.disposeGroup(group),
    );
    this.loadPieceAtlas();
    this.scene.add(this.moveMarkers);
    this.scene.add(this.hintMarker);

    // Capture phase: a press that lands on a piece is consumed before OrbitControls
    // (listening on the same canvas) can start rotating the camera.
    canvas.addEventListener("pointerdown", this.onPointerDownBound, { capture: true });
    canvas.addEventListener("pointermove", this.onPointerMoveBound);
    canvas.addEventListener("pointerup", this.onPointerUpBound);
    canvas.addEventListener("pointercancel", this.onPointerUpBound);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(viewport);
    this.resize();
    this.animate();
  }

  setActionHandler(handler: (action: BoardAction) => void): void {
    this.onAction = handler;
  }

  setHint(position: Position | null): void {
    this.clearGroup(this.hintMarker);
    if (!position) return;
    const occupied = this.getPieceAt(position.row, position.col) !== null;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(occupied ? PIECE_RADIUS * 1.5 : 0.38, 0.055, 12, 64),
      new THREE.MeshStandardMaterial({
        color: "#d90015",
        emissive: "#ff0026",
        emissiveIntensity: 3,
        transparent: true,
        opacity: 0.9,
        roughness: 0.5,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
        fog: false,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.renderOrder = 12;
    ring.name = "hint-destination";
    this.hintMarker.position.set(this.worldX(position.col), BOARD_TOP + 0.025, this.worldZ(position.row));
    this.hintMarker.add(ring);
  }

  setTeaSide(side: TeaSide | null): void {
    this.room.setActiveSide(side);
  }

  setTeaSoundHandler(handler: (sound: TeaSound) => void): void {
    this.room.onTeaSound = handler;
  }

  setMenuMode(active: boolean): void {
    this.menuMode = active;
    if (!active) this.menuGlyphStrength.value = 0;
    this.controls.enabled = !active && !this.cameraTransition && !this.captureBoxes.isAnimating;
    if (active) {
      this.setViewForTurn(constants.sides.red);
    }
  }

  sync(
    state: Array<Array<ChessPiece | null>>,
    selected: ChessPiece | null,
    moves: Position[],
    move?: MoveRecord,
    turnPieces: readonly ChessPiece[] = [],
  ): void {
    const capturedGroup = move?.captured ? this.pieceMeshes.get(move.captured) : undefined;
    const activePieces = new Set<ChessPiece>();
    for (const row of state) {
      for (const piece of row) {
        if (piece) activePieces.add(piece);
      }
    }

    const freshBoard = [...activePieces].some(
      piece => !this.pieceMeshes.has(piece) && !this.captureBoxes.has(piece),
    );
    if (freshBoard) this.captureBoxes.reset();
    else this.captureBoxes.reconcile(activePieces);
    if (!move) {
      for (const glow of this.pieceGlyphs.values()) {
        glow.captureStart = null;
        glow.strength.value = 0;
      }
      this.captureBoxes.finish();
      this.pendingViewSide = null;
      // Selecting a piece re-syncs mid-drag; the camera stays locked while one is held.
      this.controls.enabled =
        !this.menuMode && !this.cameraTransition && !this.pointerStart?.piece;
    }

    for (const [piece, group] of this.pieceMeshes) {
      if (activePieces.has(piece)) continue;
      this.pieceMeshes.delete(piece);
      this.cancelPieceAnimation(group);
      if (move?.captured === piece) {
        this.captureBoxes.capture(
          group,
          piece,
          move.piece.side,
          this.now.elapsedTime,
          this.reducedMotion.matches,
        );
        if (this.captureBoxes.isAnimating) this.controls.enabled = false;
      } else {
        this.scene.remove(group);
        this.disposeGroup(group);
      }
    }

    for (const piece of activePieces) {
      let group = this.pieceMeshes.get(piece);
      if (!group) {
        group = this.createPiece(piece);
        this.pieceMeshes.set(piece, group);
        this.scene.add(group);
      }
      if (move?.piece === piece) {
        this.animatePiece(group, group.position, this.positionFor(piece.row, piece.col));
      } else if (this.pointerStart?.piece !== piece) {
        this.cancelPieceAnimation(group);
        group.position.set(
          this.worldX(piece.col),
          this.pieceBaseY(),
          this.worldZ(piece.row),
        );
      }
    }

    if (move?.captured && !this.reducedMotion.matches) {
      for (const group of [this.pieceMeshes.get(move.piece), capturedGroup]) {
        const glow = group && this.pieceGlyphs.get(group);
        if (glow) glow.captureStart = this.now.elapsedTime;
      }
    }

    this.selectedPiece = selected;
    this.turnPieces = new Set(turnPieces);
    this.drawMoveMarkers(moves);
  }

  rotateView(): void {
    const { red, black } = constants.sides;
    this.setViewForTurn((this.pendingViewSide ?? this.viewSide) === red ? black : red);
  }

  setViewForTurn(side: number, force = false): void {
    const red = constants.sides.red;
    const targetSide = side === red ? red : constants.sides.black;
    if (this.captureBoxes.isAnimating) {
      this.pendingViewSide = targetSide;
      return;
    }
    // `force` re-snaps to the fixed camera even when the user has dragged away from it.
    if (this.viewSide === targetSide && !force) return;
    this.viewSide = targetSide;
    this.beginCameraTransition(this.fixedOffset(targetSide));
  }

  // Fixed oblique overview for each side. The distance is solved from the real projection:
  // Keep the board in view, together with the capture boxes in portrait.
  private fixedOffset(side: number): THREE.Vector3 {
    const base = this.fixedDirection().clone().multiplyScalar(this.fitDistance());
    if (side !== constants.sides.red) base.z = -base.z;
    return base;
  }

  private fixedDirection(): THREE.Vector3 {
    return this.camera.aspect < 1 ? PORTRAIT_VIEW_DIRECTION : FIXED_VIEW_DIRECTION;
  }

  private fitDistance(): number {
    const probe = new THREE.PerspectiveCamera(this.camera.fov, this.camera.aspect, 0.1, 200);
    const target = new THREE.Vector3(0, BOARD_TOP, 0);
    const corners: THREE.Vector3[] = [];
    for (const x of [-FIXED_FIT_HALF_WIDTH, FIXED_FIT_HALF_WIDTH]) {
      for (const z of [-FIXED_FIT_HALF_DEPTH, FIXED_FIT_HALF_DEPTH]) {
        for (const y of [0, FIXED_FIT_TOP]) corners.push(new THREE.Vector3(x, BOARD_TOP + y, z));
      }
    }
    if (this.camera.aspect < 1) {
      for (const x of [-2.7, 2.7]) {
        for (const z of [-8.32, 8.32]) {
          corners.push(new THREE.Vector3(x, 0.49, z));
        }
      }
    }
    const fits = (distance: number): boolean => {
      probe.position.copy(target).addScaledVector(this.fixedDirection(), distance);
      probe.lookAt(target);
      probe.updateMatrixWorld(true);
      probe.updateProjectionMatrix();
      return corners.every(corner => {
        const ndc = corner.clone().project(probe);
        const horizontalMargin = this.camera.aspect < 1 ? 0.995 : FIXED_FIT_MARGIN;
        return Math.abs(ndc.x) <= horizontalMargin && Math.abs(ndc.y) <= FIXED_FIT_MARGIN;
      });
    };
    let near = 4;
    let far = 120;
    for (let i = 0; i < 24; i++) {
      const mid = (near + far) / 2;
      if (fits(mid)) far = mid;
      else near = mid;
    }
    return far;
  }

  dispose(): void {
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.captureBoxes.dispose();
    this.room.dispose();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.onPointerDownBound, { capture: true });
    canvas.removeEventListener("pointermove", this.onPointerMoveBound);
    canvas.removeEventListener("pointerup", this.onPointerUpBound);
    canvas.removeEventListener("pointercancel", this.onPointerUpBound);
    this.renderer.dispose();
    this.ssaoPass.dispose();
    this.bloomPass.dispose();
    this.contactMap?.dispose();
    this.atmospherePass.dispose();
    this.dust.dispose();
    this.composer.dispose();
    this.woodColorTexture.dispose();
    this.woodBumpTexture.dispose();
    this.pieceAtlas?.dispose();
    this.clearGroup(this.hintMarker);
    for (const label of this.riverLabels.children) {
      if (label instanceof THREE.Mesh && label.material instanceof THREE.MeshBasicMaterial) {
        label.material.map?.dispose();
      }
    }
    this.disposeGroup(this.riverLabels);
    const boardMaterial = this.boardSurface.material as THREE.MeshPhysicalMaterial;
    for (const texture of [
      boardMaterial.map,
      boardMaterial.normalMap,
      boardMaterial.roughnessMap,
      boardMaterial.aoMap,
      boardMaterial.bumpMap,
    ]) {
      texture?.dispose();
    }
    boardMaterial.dispose();
    for (const group of this.pieceMeshes.values()) {
      this.disposeGroup(group);
    }
    for (const animation of this.pieceAnimations) {
      this.disposeGroup(animation.group);
    }
    this.pieceMeshes.clear();
    this.pieceAnimations.clear();
  }

  private buildEnvironment(): void {
    // Low diffuse fill only; the room's 3200K ceiling lamp is the key light.
    // Phone screens are small and often viewed in bright surroundings: lift the fill there.
    const fillScale = this.touchDevice.matches ? 1.35 : 1;
    const ambient = new THREE.HemisphereLight("#f1e2cd", "#6b5f52", 0.6 * fillScale);
    this.scene.add(ambient, new THREE.AmbientLight("#d6cdbf", 0.06));

    const keyLight = new THREE.DirectionalLight("#ffe6c6", 0.36);
    keyLight.position.set(-8, 12, -6);
    keyLight.castShadow = false;
    keyLight.shadow.intensity = 0.72;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.left = -10;
    keyLight.shadow.camera.right = 10;
    keyLight.shadow.camera.top = 10;
    keyLight.shadow.camera.bottom = -10;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 32;
    keyLight.shadow.bias = -0.00005;
    keyLight.shadow.normalBias = 0.006;
    keyLight.shadow.radius = 2.4;
    keyLight.shadow.camera.updateProjectionMatrix();
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight("#dfe0dc", 0.26 * fillScale);
    fillLight.position.set(6, 9, 7);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight("#f8e5c9", 0.24);
    rimLight.position.set(-5, 5, -9);
    this.scene.add(rimLight);
  }

  private buildBoard(): void {
    this.boardSurface.material = this.createWoodMaterial(0.86, 0.01, [1, 1]);
    const plinthMaterial = this.boardSurface.material;
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(9.55, 0.52, 10.55),
      plinthMaterial,
    );
    plinth.position.y = 0.26;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    this.scene.add(plinth);

    const apron = new THREE.Mesh(
      new THREE.BoxGeometry(9.25, 0.12, 10.25),
      plinthMaterial,
    );
    apron.position.y = 0.46;
    apron.castShadow = true;
    this.scene.add(apron);

    this.boardSurface.rotation.x = -Math.PI / 2;
    this.boardSurface.position.y = BOARD_TOP;
    this.boardSurface.receiveShadow = true;
    this.boardSurface.geometry.setAttribute(
      "uv2",
      this.boardSurface.geometry.getAttribute("uv"),
    );
    this.scene.add(this.boardSurface);

    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(9.05, 0.035, 10.05),
      new THREE.MeshStandardMaterial({
        color: "#c3995e",
        roughness: 0.42,
        metalness: 0.24,
      }),
    );
    edge.position.y = BOARD_TOP - 0.035;
    this.scene.add(edge);

    this.loadBoardTextures();
    this.buildGrid();
    this.buildStarPoints();
    this.buildRiverLabels();
  }

  private buildRiverLabels(): void {
    const url = textureManifest.riverLabels;
    if (!url) return;
    this.scene.add(this.riverLabels);
    new FetchTextureLoader().load(
      url,
      texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 8;
        for (let index = 0; index < 2; index++) {
          const map = index === 0 ? texture : texture.clone();
          map.repeat.set(0.5, 1);
          map.offset.set(index * 0.5, 0);
          map.needsUpdate = true;
          const label = new THREE.Mesh(
            new THREE.PlaneGeometry(1.6, 0.8),
            new THREE.MeshBasicMaterial({
              map,
              transparent: true,
              opacity: 0.6,
              depthWrite: false,
              toneMapped: false,
              polygonOffset: true,
              polygonOffsetFactor: -1,
              polygonOffsetUnits: -1,
            }),
          );
          label.name = index === 0 ? "river-chu-he" : "river-han-jie";
          // Plane top points toward black, so the lettering reads from red's seat.
          label.rotation.x = -Math.PI / 2;
          label.position.set(index === 0 ? -2 : 2, BOARD_TOP + 0.008, 0);
          this.riverLabels.add(label);
        }
      },
      undefined,
      error => console.error(`无法载入河界文字贴图 ${url}:`, error),
    );
  }

  private loadBoardTextures(): void {
    const material = this.boardSurface.material as THREE.MeshPhysicalMaterial;
    const loader = new FetchTextureLoader();
    const loadTexture = (
      url: string | undefined,
      colorSpace: THREE.ColorSpace,
      apply: (texture: THREE.Texture) => void,
    ) => {
      if (!url) return;
      loader.load(
        url,
        texture => {
          texture.colorSpace = colorSpace;
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.repeat.set(1, 1);
          texture.anisotropy = 8;
          apply(texture);
          material.needsUpdate = true;
          this.room?.syncWoodTextures();
        },
        undefined,
        error => console.error(`无法载入棋盘 PBR 贴图 ${url}:`, error),
      );
    };

    loadTexture(textureManifest.board, THREE.SRGBColorSpace, texture => {
      material.map?.dispose();
      material.map = texture;
    });
    loadTexture(textureManifest.boardNormal, THREE.NoColorSpace, texture => {
      material.bumpMap?.dispose();
      material.bumpMap = null;
      material.bumpScale = 0;
      material.normalMap = texture;
      material.normalScale.set(0.08, 0.08);
    });
    loadTexture(textureManifest.boardRoughness, THREE.NoColorSpace, texture => {
      material.roughnessMap = texture;
      material.roughness = 1;
    });
    loadTexture(textureManifest.boardAO, THREE.NoColorSpace, texture => {
      material.aoMap = texture;
      material.aoMapIntensity = 0.4;
    });
  }

  private createWoodMaterial(
    roughness: number,
    bumpScale: number,
    repeat: [number, number],
  ): THREE.MeshPhysicalMaterial {
    const color = this.woodColorTexture.clone();
    color.repeat.set(repeat[0], repeat[1]);
    color.needsUpdate = true;
    const bump = this.woodBumpTexture.clone();
    bump.repeat.set(repeat[0], repeat[1]);
    bump.needsUpdate = true;
    return new THREE.MeshPhysicalMaterial({
      map: color,
      bumpMap: bump,
      bumpScale,
      roughness: Math.max(roughness, 0.86),
      metalness: 0,
      clearcoat: 0.03,
      clearcoatRoughness: 0.82,
    });
  }

  private loadPieceAtlas(): void {
    const atlasUrl = textureManifest.pieceAtlas;
    if (!atlasUrl) return;
    new FetchTextureLoader().load(
      atlasUrl,
      texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 8;
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        this.pieceAtlas = texture;
        for (const [piece, group] of this.pieceMeshes) {
          this.applyPieceTexture(piece, group);
        }
        this.captureBoxes.forEachPiece((piece, group) => this.applyPieceTexture(piece, group));
      },
      undefined,
      error => console.error(`无法载入棋子雪碧图 ${atlasUrl}:`, error),
    );
  }

  private applyPieceTexture(piece: ChessPiece, group: THREE.Group): void {
    const face = group.children.find(child => child.userData.pieceFace);
    if (!(face instanceof THREE.Mesh)) return;
    const material = face.material as THREE.MeshStandardMaterial;
    const isRed = piece.side === constants.sides.red;
    const side = isRed ? "red" : "black";
    const typeName = pieceTypeNames[piece.type] ?? "soldier";
    const key = `${side}-${typeName}`;
    const individualTexture = textureManifest.pieces[
      key as keyof typeof textureManifest.pieces
    ];

    if (individualTexture) {
      new FetchTextureLoader().load(
        individualTexture,
        texture => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = 8;
          material.map?.dispose();
          material.map = texture;
          material.needsUpdate = true;
        },
        undefined,
        error => console.error(`无法载入棋子贴图 ${individualTexture}:`, error),
      );
      return;
    }

    const cell = PIECE_ATLAS_CELLS[key];
    if (!cell || !this.pieceAtlas) return;
    material.map?.dispose();
    const tile = this.pieceAtlas.clone();
    tile.wrapS = THREE.ClampToEdgeWrapping;
    tile.wrapT = THREE.ClampToEdgeWrapping;
    tile.repeat.set(1 / ATLAS_COLUMNS, 1 / ATLAS_ROWS);
    tile.offset.set(
      cell[0] / ATLAS_COLUMNS,
      1 - (cell[1] + 1) / ATLAS_ROWS,
    );
    tile.needsUpdate = true;
    material.map = tile;
    material.needsUpdate = true;
  }

  private buildGrid(): void {
    const material = new THREE.MeshBasicMaterial({
      color: "#3b2416",
      toneMapped: false,
    });
    const grid = new THREE.Group();
    const addLine = (startCol: number, startRow: number, endCol: number, endRow: number) => {
      const startX = this.worldX(startCol);
      const startZ = this.worldZ(startRow);
      const endX = this.worldX(endCol);
      const endZ = this.worldZ(endRow);
      const dx = endX - startX;
      const dz = endZ - startZ;
      const length = Math.hypot(dx, dz);
      const line = new THREE.Mesh(
        new THREE.BoxGeometry(length, 0.016, 0.035),
        material,
      );
      line.position.set(
        (startX + endX) / 2,
        BOARD_TOP + 0.006,
        (startZ + endZ) / 2,
      );
      line.rotation.y = Math.atan2(-dz, dx);
      line.renderOrder = 1;
      grid.add(line);
    };

    for (let row = 0; row <= 9; row++) {
      addLine(0, row, 8, row);
    }
    for (let col = 0; col <= 8; col++) {
      if (col === 0 || col === 8) {
        addLine(col, 0, col, 9);
      } else {
        addLine(col, 0, col, 4);
        addLine(col, 5, col, 9);
      }
    }

    addLine(3, 0, 5, 2);
    addLine(3, 2, 5, 0);
    addLine(3, 7, 5, 9);
    addLine(3, 9, 5, 7);
    this.scene.add(grid);
  }

  private buildStarPoints(): void {
    const material = new THREE.MeshBasicMaterial({
      color: "#000000",
      toneMapped: false,
      transparent: true,
      opacity: 0.55,
    });
    const gap = 0.08;
    const arm = 0.17;
    const thickness = 0.026;
    const horizontal = new THREE.BoxGeometry(arm, 0.006, thickness);
    const vertical = new THREE.BoxGeometry(thickness, 0.006, arm);
    const points = [
      [1, 2],
      [7, 2],
      [0, 3],
      [2, 3],
      [4, 3],
      [6, 3],
      [8, 3],
      [0, 6],
      [2, 6],
      [4, 6],
      [6, 6],
      [8, 6],
      [1, 7],
      [7, 7],
    ];
    for (const [col, row] of points) {
      const cx = this.worldX(col);
      const cz = this.worldZ(row);
      for (const sx of [-1, 1]) {
        if ((col === 0 && sx < 0) || (col === 8 && sx > 0)) continue;
        for (const sz of [-1, 1]) {
          const h = new THREE.Mesh(horizontal, material);
          h.position.set(cx + sx * (gap + arm / 2), BOARD_TOP + 0.008, cz + sz * gap);
          const v = new THREE.Mesh(vertical, material);
          v.position.set(cx + sx * gap, BOARD_TOP + 0.008, cz + sz * (gap + arm / 2));
          h.renderOrder = v.renderOrder = 1;
          this.scene.add(h, v);
        }
      }
    }
  }

  private createPiece(piece: ChessPiece): THREE.Group {
    const isRed = piece.side === constants.sides.red;
    const side = isRed ? "red" : "black";
    const typeName = pieceTypeNames[piece.type] ?? "soldier";
    const group = new THREE.Group();
    group.position.set(this.worldX(piece.col), this.pieceBaseY(), this.worldZ(piece.row));
    // Each side's characters read upright from its own player's seat.
    if (!isRed) group.rotation.y = Math.PI;
    group.userData.piece = piece;

    const bodyMaterial = new THREE.MeshPhysicalMaterial({
      color: isRed ? "#7f241d" : "#28241e",
      roughness: 0.52,
      metalness: 0.02,
      clearcoat: 0.12,
      clearcoatRoughness: 0.5,
      envMap: this.environmentMap,
      envMapIntensity: 0.22,
    });
    bodyMaterial.onBeforeCompile = shader => {
      shader.vertexShader = `varying vec3 vPieceSurfacePosition;\n${shader.vertexShader}`.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvPieceSurfacePosition = transformed;",
      );
      shader.fragmentShader = `varying vec3 vPieceSurfacePosition;\n${shader.fragmentShader}`.replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
float pieceSurfaceGrain = sin(vPieceSurfacePosition.x * 31.0 + sin(vPieceSurfacePosition.y * 17.0))
  * sin(vPieceSurfacePosition.z * 27.0 + vPieceSurfacePosition.y * 9.0);
roughnessFactor = clamp(roughnessFactor + pieceSurfaceGrain * 0.012, 0.0, 1.0);`,
      );
    };
    bodyMaterial.customProgramCacheKey = () => "piece-body-surface-grain";
    const body = new THREE.Mesh(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0, 0),
          new THREE.Vector2(PIECE_RADIUS * 0.82, 0),
          new THREE.Vector2(PIECE_RADIUS * 0.94, 0.018),
          new THREE.Vector2(PIECE_RADIUS, 0.052),
          new THREE.Vector2(PIECE_RADIUS * 0.99, 0.155),
          new THREE.Vector2(PIECE_RADIUS * 0.95, 0.19),
          new THREE.Vector2(PIECE_RADIUS * 0.86, 0.22),
          new THREE.Vector2(PIECE_RADIUS * 0.78, PIECE_HEIGHT),
          new THREE.Vector2(0, PIECE_HEIGHT),
        ],
        64,
      ),
      bodyMaterial,
    );
    body.castShadow = true;
    body.receiveShadow = true;
    body.userData.piece = piece;
    group.add(body);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(PIECE_RADIUS * 0.96, 0.012, 8, 64),
      new THREE.MeshPhysicalMaterial({
        color: "#9b7948",
        roughness: 0.4,
        metalness: 0.28,
        clearcoat: 0.18,
        envMap: this.environmentMap,
        envMapIntensity: 0.32,
      }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.18;
    rim.castShadow = true;
    group.add(rim);

    const faceMaterial = new THREE.MeshStandardMaterial({
      color: "#ffffff",
      roughness: 0.76,
      metalness: 0,
    });
    const glyphGlow: PieceGlyphGlow = {
      strength: new THREE.Uniform(0),
      captureStart: null,
    };
    this.pieceGlyphs.set(group, glyphGlow);
    faceMaterial.onBeforeCompile = shader => {
      shader.uniforms.uMenuGlyphStrength = this.menuGlyphStrength;
      shader.uniforms.uPieceGlyphStrength = glyphGlow.strength;
      shader.uniforms.uGlyphColor = new THREE.Uniform(
        new THREE.Color(isRed ? "#ff3624" : "#9da8ad").multiplyScalar(isRed ? 1 : 0.65),
      );
      shader.fragmentShader = `
uniform float uMenuGlyphStrength;
uniform float uPieceGlyphStrength;
uniform vec3 uGlyphColor;
${shader.fragmentShader}`.replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
#ifdef USE_MAP
  // Isolate the existing ink from the wood without another texture or draw call.
  float inkMask = ${isRed
    ? "smoothstep(0.72, 0.88, (diffuseColor.r - max(diffuseColor.g, diffuseColor.b)) / max(diffuseColor.r, 0.001))"
    : "1.0 - smoothstep(0.006, 0.025, max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)))"};
  totalEmissiveRadiance += uGlyphColor * inkMask * max(uMenuGlyphStrength, uPieceGlyphStrength);
#endif`,
      );
    };
    faceMaterial.customProgramCacheKey = () => `piece-glyph-${side}`;
    const face = new THREE.Mesh(
      new THREE.CircleGeometry(PIECE_RADIUS * 0.77, 64),
      faceMaterial,
    );
    face.rotation.x = -Math.PI / 2;
    face.position.y = PIECE_HEIGHT + 0.002;
    face.castShadow = false;
    face.userData.piece = piece;
    face.userData.pieceFace = true;
    group.add(face);
    this.applyPieceTexture(piece, group);

    const selectionRing = new THREE.Mesh(
      new THREE.TorusGeometry(PIECE_RADIUS * 1.1, 0.013, 8, 64),
      new THREE.MeshBasicMaterial({
        color: isRed ? "#ffcf79" : "#d7d8c6",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    selectionRing.rotation.x = Math.PI / 2;
    selectionRing.position.y = 0.038;
    selectionRing.userData.selectionRing = true;
    selectionRing.visible = false;
    group.add(selectionRing);

    const glow = new THREE.Mesh(
      new THREE.TorusGeometry(PIECE_RADIUS * 1.22, 0.035, 12, 64),
      new THREE.MeshBasicMaterial({
        color: isRed ? "#ffc760" : "#c2ddb8",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    glow.rotation.x = Math.PI / 2;
    glow.position.y = 0.045;
    glow.userData.selectionGlow = true;
    glow.visible = false;
    group.add(glow);

    const hoverRing = new THREE.Mesh(
      new THREE.TorusGeometry(PIECE_RADIUS * 1.16, 0.012, 8, 64),
      new THREE.MeshBasicMaterial({
        color: isRed ? "#f7b95d" : "#c6d1bc",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    hoverRing.rotation.x = Math.PI / 2;
    hoverRing.position.y = 0.026;
    hoverRing.userData.hoverRing = true;
    hoverRing.visible = false;
    group.add(hoverRing);

    // Soft contact shadow on the board; follows the board while the piece lifts.
    const contact = new THREE.Mesh(
      new THREE.CircleGeometry(PIECE_RADIUS * 1.45, 32),
      new THREE.MeshBasicMaterial({
        color: "#000000",
        map: this.contactTexture(),
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = 0.004;
    contact.renderOrder = -1;
    contact.userData.contact = true;
    group.add(contact);
    // Soft light pooling under the base of every piece the side to move can play.
    const turnGlow = new THREE.Mesh(
      new THREE.CircleGeometry(PIECE_RADIUS * TURN_HALO_REACH, 48),
      new THREE.ShaderMaterial({
        name: "TurnHalo",
        uniforms: {
          uStrength: new THREE.Uniform(0),
          uReach: new THREE.Uniform(TURN_HALO_REACH),
        },
        vertexShader: `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
        fragmentShader: `
uniform float uStrength;
uniform float uReach;
varying vec2 vUv;
void main() {
  float radius = length(vUv - 0.5) * 2.0 * uReach;
  float falloff = 1.0 - smoothstep(0.9, uReach, radius);
  gl_FragColor = vec4(vec3(1.0, 0.78, 0.42), falloff * falloff * uStrength);
}`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    turnGlow.rotation.x = -Math.PI / 2;
    turnGlow.position.y = 0.008;
    turnGlow.userData.turnGlow = true;
    turnGlow.visible = false;
    group.add(turnGlow);

    return group;
  }

  private drawMoveMarkers(moves: Position[]): void {
    this.clearGroup(this.moveMarkers);
    for (const move of moves) {
      const target = this.getPieceAt(move.row, move.col);
      const occupied = Boolean(
        target && this.selectedPiece?.side !== target.side,
      );
      const color = occupied ? "#ff8268" : "#fff0b8";
      const marker = new THREE.Group();
      marker.position.set(this.worldX(move.col), BOARD_TOP + 0.012, this.worldZ(move.row));

      if (!occupied) {
        const center = new THREE.Mesh(
          new THREE.CircleGeometry(0.12, 32),
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.82,
            depthWrite: false,
            depthTest: false,
            toneMapped: false,
            fog: false,
          }),
        );
        center.rotation.x = -Math.PI / 2;
        center.renderOrder = 8;
        marker.add(center);
      }

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(
          occupied ? PIECE_RADIUS * 1.22 : 0.25,
          occupied ? 0.032 : 0.04,
          8,
          48,
        ),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.96,
          depthWrite: false,
          depthTest: false,
          toneMapped: false,
          fog: false,
        }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.006;
      ring.renderOrder = 9;
      marker.add(ring);
      this.moveMarkers.add(marker);
    }
  }

  private getPieceAt(row: number, col: number): ChessPiece | null {
    for (const piece of this.pieceMeshes.keys()) {
      if (piece.row === row && piece.col === col) return piece;
    }
    return null;
  }

  private clearGroup(group: THREE.Group): void {
    for (const child of [...group.children]) {
      group.remove(child);
      if (child instanceof THREE.Group) this.disposeGroup(child);
      else if (child instanceof THREE.Mesh) this.disposeMesh(child);
    }
  }

  private disposeMesh(mesh: THREE.Mesh): void {
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial) material.map?.dispose();
      material.dispose();
    }
  }

  private animatePiece(
    group: THREE.Group,
    from: THREE.Vector3,
    to: THREE.Vector3,
  ): void {
    this.cancelPieceAnimation(group);
    this.pieceAnimations.add({
      group,
      start: this.now.elapsedTime,
      duration: 0.62,
      from: from.clone(),
      to: to.clone(),
    });
  }

  private cancelPieceAnimation(group: THREE.Group): void {
    for (const animation of this.pieceAnimations) {
      if (animation.group === group) this.pieceAnimations.delete(animation);
    }
  }

  private beginCameraTransition(offset: THREE.Vector3): void {
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = damping;
    const target = this.controls.target.clone();
    const currentOffset = this.camera.position.clone().sub(target);
    const fromAngle = Math.atan2(currentOffset.x, currentOffset.z);
    const toAngle = Math.atan2(offset.x, offset.z);
    const angleDelta = THREE.MathUtils.euclideanModulo(toAngle - fromAngle + Math.PI, Math.PI * 2) - Math.PI;
    if (this.reducedMotion.matches) {
      this.camera.position.copy(target).add(offset);
      this.camera.lookAt(target);
      this.cameraTransition = null;
      this.controls.enabled = !this.menuMode;
      return;
    }
    this.controls.enabled = false;
    this.cameraTransition = {
      start: this.now.elapsedTime,
      duration: 1.35 / 1.2,
      target,
      fromAngle,
      angleDelta,
      radius: Math.hypot(currentOffset.x, currentOffset.z),
      height: currentOffset.y,
      toRadius: Math.hypot(offset.x, offset.z),
      toHeight: offset.y,
    };
  }

  setQuality(quality: QualitySettings): void {
    this.quality = quality;
    // The room passes read the SSAO pass depth buffer, so it keeps rendering (invisibly) while they need it.
    const needsDepth = quality.dof || quality.volumetric;
    this.ssaoPass.enabled = quality.ssao > 0 || needsDepth;
    const strong = quality.ssao === 2;
    this.ssaoPass.kernelRadius = strong ? 1.1 : 0.4;
    this.ssaoPass.maxDistance = strong ? 0.035 : 0.012;
    this.ssaoPass.copyMaterial.uniforms.opacity.value = quality.ssao === 0 ? 0 : strong ? 0.9 : 0.42;
    this.atmospherePass.setEffects(quality.dof, quality.volumetric);
    this.smaaPass.enabled = quality.antialias;
    this.dust.points.visible = quality.volumetric;
  }

  getQuality(): QualitySettings {
    return this.quality;
  }

  private animate = (): void => {
    this.frameId = requestAnimationFrame(this.animate);
    const elapsed = this.now.getElapsedTime();
    this.atmospherePass.update(this.reducedMotion.matches ? 0 : elapsed);
    this.dust.update(this.reducedMotion.matches ? 0 : elapsed);
    this.finishPass.update(elapsed);
    this.updatePieces(elapsed);
    this.captureBoxes.update(elapsed);
    if (this.pendingViewSide !== null && !this.captureBoxes.isAnimating) {
      const side = this.pendingViewSide;
      this.pendingViewSide = null;
      this.setViewForTurn(side, true);
    }
    this.updateCamera(elapsed);
    this.updateSelection(elapsed);
    if (!this.cameraTransition && !this.captureBoxes.isAnimating) {
      // Keep the orbit target pinned to the board center so zooming can never drift off it.
      this.controls.target.set(0, BOARD_TOP, 0);
      this.controls.update();
    }
    this.updateMenuCamera(elapsed);
    this.captureBoxes.faceView(Math.atan2(
      this.camera.position.x - this.controls.target.x,
      this.camera.position.z - this.controls.target.z,
    ));
    this.room.update(
      this.camera,
      this.renderer,
      elapsed,
      this.reducedMotion.matches ? 0.65 : 1,
    );
    this.composer.render();
  };

  private updateMenuCamera(elapsed: number): void {
    if (!this.menuMode || this.cameraTransition) return;
    const target = this.controls.target;
    const frameWidth = CAPTURE_SCENE_WIDTH;
    const minDistance =
      frameWidth /
      (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect);
    const horizontalDistance = Math.max(14, minDistance * Math.SQRT1_2);
    const angle = this.reducedMotion.matches
      ? 0
      : Math.sin(elapsed * 0.12) * 0.12;
    this.camera.position.set(
      target.x + Math.sin(angle) * horizontalDistance,
      target.y + horizontalDistance,
      target.z + Math.cos(angle) * horizontalDistance,
    );
    this.camera.lookAt(target);
  }

  private contactMap: THREE.CanvasTexture | null = null;

  private contactTexture(): THREE.CanvasTexture {
    if (this.contactMap) return this.contactMap;
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d") as CanvasRenderingContext2D;
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.55, "rgba(255,255,255,0.55)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    this.contactMap = new THREE.CanvasTexture(canvas);
    return this.contactMap;
  }

  private updatePieces(elapsed: number): void {
    for (const animation of [...this.pieceAnimations]) {
      const progress = Math.min(1, (elapsed - animation.start) / animation.duration);
      const eased = progress < 0.76
        ? 1 - (1 - progress / 0.76) ** 3
        : 1 + Math.sin(((progress - 0.76) / 0.24) * Math.PI) * 0.11;
      animation.group.position.lerpVectors(animation.from, animation.to, eased);
      animation.group.position.y += Math.sin(Math.PI * progress) * 0.28;
      if (progress >= 1) {
        animation.group.position.copy(animation.to);
        animation.group.scale.setScalar(1);
        this.pieceAnimations.delete(animation);
      }
    }
  }

  private updateCamera(elapsed: number): void {
    const transition = this.cameraTransition;
    if (!transition) return;
    const progress = Math.min(1, (elapsed - transition.start) / transition.duration);
    const eased = progress * progress * (3 - 2 * progress);
    const angle = transition.fromAngle + transition.angleDelta * eased;
    const radius = THREE.MathUtils.lerp(transition.radius, transition.toRadius, eased);
    const height = THREE.MathUtils.lerp(transition.height, transition.toHeight, eased);
    this.camera.position.set(
      transition.target.x + Math.sin(angle) * radius,
      transition.target.y + height,
      transition.target.z + Math.cos(angle) * radius,
    );
    this.camera.lookAt(transition.target);
    if (progress >= 1) {
      this.cameraTransition = null;
      this.controls.enabled = !this.menuMode && !this.captureBoxes.isAnimating;
    }
  }

  private updateSelection(elapsed: number): void {
    const hintPulse = this.reducedMotion.matches ? 0.5 : 0.5 + 0.5 * Math.sin(elapsed * 3);
    this.hintMarker.scale.setScalar(1 + hintPulse * 0.08);
    for (const ring of this.hintMarker.children) {
      if (ring instanceof THREE.Mesh && ring.material instanceof THREE.MeshStandardMaterial) {
        ring.material.emissiveIntensity = 1.5 + hintPulse * 3;
        ring.material.opacity = 0.7 + hintPulse * 0.3;
      }
    }
    const menuBreath = 0.5 - 0.5 * Math.cos(elapsed * Math.PI / 3);
    this.menuGlyphStrength.value = this.menuMode && !this.reducedMotion.matches
      ? 4.5 * menuBreath * menuBreath
      : 0;
    for (const glow of this.pieceGlyphs.values()) {
      glow.strength.value = 0;
      if (glow.captureStart === null) continue;
      const progress = THREE.MathUtils.clamp(elapsed - glow.captureStart, 0, 1);
      if (this.reducedMotion.matches || progress >= 1) {
        glow.captureStart = null;
        glow.strength.value = 0;
      } else {
        glow.strength.value = 4.5 * Math.sin(progress * Math.PI) ** 2;
      }
    }
    const float = 0.075 + Math.sin(elapsed * 2.4) * 0.025;
    const pulse = 0.55 + Math.sin(elapsed * 3.2) * 0.22;
    for (const [piece, group] of this.pieceMeshes) {
      const isSelected = piece === this.selectedPiece;
      const isHovered = piece === this.hoveredPiece && !isSelected;
      const pointerStart = this.pointerStart;
      const isDragged = Boolean(
        pointerStart && pointerStart.piece === piece && pointerStart.dragged,
      );
      const animating = [...this.pieceAnimations].some(item => item.group === group);
      const glyphGlow = this.pieceGlyphs.get(group);
      if (glyphGlow && !this.menuMode && (isSelected || isDragged || animating)) {
        glyphGlow.strength.value = Math.max(glyphGlow.strength.value, 2.8);
      }
      if (!animating && !isDragged) {
        group.position.y = this.pieceBaseY() + (isSelected ? float : 0);
      }
      for (const child of group.children) {
        if (!(child instanceof THREE.Mesh)) continue;
        if (child.userData.contact) {
          const lift = Math.max(0, group.position.y - this.pieceBaseY());
          child.position.y = 0.004 - lift;
          (child.material as THREE.MeshBasicMaterial).opacity = 0.5 * Math.exp(-lift * 5);
          child.scale.setScalar(1 + lift * 1.6);
        }
        if (child.userData.selectionRing) {
          child.visible = isSelected;
          (child.material as THREE.MeshBasicMaterial).opacity = isSelected ? 0.86 : 0;
        }
        if (child.userData.selectionGlow) {
          child.visible = isSelected;
          (child.material as THREE.MeshBasicMaterial).opacity = isSelected ? pulse : 0;
        }
        if (child.userData.hoverRing) {
          child.visible = isHovered;
          (child.material as THREE.MeshBasicMaterial).opacity = isHovered ? 0.58 : 0;
        }
        if (child.userData.turnGlow) {
          child.visible = this.turnPieces.has(piece) && !isSelected;
          const strengthScale = this.touchDevice.matches ? 0.5 : 1;
          // Halve the spill outside the piece, not the radius hidden beneath it.
          const reach = 1 + (TURN_HALO_REACH - 1) * strengthScale;
          child.scale.setScalar(reach / TURN_HALO_REACH);
          (child.material as THREE.ShaderMaterial).uniforms.uReach.value = reach;
          // Slow breathing that drifts across the board; steady when motion is reduced.
          const breath = this.reducedMotion.matches
            ? 0.5
            : 0.5 + 0.5 * Math.sin(elapsed * 2.2 - (piece.col + piece.row) * 0.4);
          (child.material as THREE.ShaderMaterial).uniforms.uStrength.value =
            (0.09 + 0.25 * breath) * strengthScale;
        }
      }
    }
  }

  private disposeGroup(group: THREE.Group): void {
    this.pieceGlyphs.delete(group);
    group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      this.disposeMesh(object);
    });
  }

  private onPointerDown(event: PointerEvent): void {
    if (this.menuMode || this.cameraTransition || this.captureBoxes.isAnimating) return;
    if (event.button !== 0 && event.pointerType !== "touch") return;
    // The board stays locked while the cup is in motion.
    if (this.room.isDrinking) return;
    const cup = this.hitCup(event);
    if (cup) {
      event.stopImmediatePropagation();
      this.room.startDrink(cup);
      return;
    }
    const piece = this.hitPiece(event);
    const point = this.boardPoint(event);
    this.pointerStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      piece,
      dragged: false,
    };
    if (piece) {
      event.stopImmediatePropagation();
      this.controls.enabled = false;
      this.renderer.domElement.setPointerCapture(event.pointerId);
      this.renderer.domElement.style.cursor = "grabbing";
    } else if (point) {
      this.renderer.domElement.style.cursor = "grabbing";
    }
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.menuMode || this.cameraTransition || this.captureBoxes.isAnimating) return;
    const start = this.pointerStart;
    if (!start) {
      const cup = this.hitCup(event);
      this.room.setHover(cup);
      this.hoveredPiece = cup ? null : this.hitPiece(event);
      this.renderer.domElement.style.cursor = cup || this.hoveredPiece ? "pointer" : "";
      return;
    }
    if (start.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (distance > 5 && !start.dragged) {
      start.dragged = true;
      if (start.piece) {
        this.onAction({
          position: { row: start.piece.row, col: start.piece.col },
          piece: start.piece,
          dragged: true,
        });
      }
    }
    if (!start.piece || !start.dragged) return;

    const point = this.boardPoint(event);
    const group = this.pieceMeshes.get(start.piece);
    if (!point || !group) return;
    group.position.set(point.x, this.pieceBaseY() + PIECE_HEIGHT * 1.5, point.z);
  }

  private onPointerUp(event: PointerEvent): void {
    const start = this.pointerStart;
    if (!start || start.pointerId !== event.pointerId) return;
    const piece = start.piece;
    const dragged = start.dragged;
    if (!piece && dragged) {
      this.pointerStart = null;
      this.renderer.domElement.style.cursor = "";
      return;
    }
    const position = dragged
      ? this.positionFromPointer(event)
      : piece
        ? { row: piece.row, col: piece.col }
        : this.positionFromPointer(event);

    this.pointerStart = null;
    this.controls.enabled = true;
    this.renderer.domElement.style.cursor = this.hoveredPiece ? "pointer" : "";

    if (piece && dragged && position) {
      this.onAction({ position, piece, dragged: true });
      return;
    }

    if (piece && dragged) {
      const group = this.pieceMeshes.get(piece);
      if (group) group.position.copy(this.positionFor(piece.row, piece.col));
      return;
    }

    if (piece && !dragged) {
      this.onAction({ position, piece, dragged: false });
      return;
    }

    this.onAction({
      position,
      piece: this.hitPiece(event),
      dragged: false,
    });
  }

  private hitCup(event: PointerEvent): TeaSide | null {
    this.setPointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.room.pickCup(this.raycaster);
  }

  private hitPiece(event: PointerEvent): ChessPiece | null {
    this.setPointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const groups = [...this.pieceMeshes.values()];
    const hits = this.raycaster.intersectObjects(groups, true);
    for (const hit of hits) {
      let object: THREE.Object3D | null = hit.object;
      while (object) {
        const piece = object.userData.piece as ChessPiece | undefined;
        if (piece) return piece;
        object = object.parent;
      }
    }
    return null;
  }

  private boardPoint(event: PointerEvent): THREE.Vector3 | null {
    this.setPointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.ray.intersectPlane(this.groundPlane, new THREE.Vector3());
  }

  private positionFromPointer(event: PointerEvent): Position | null {
    const point = this.boardPoint(event);
    if (!point) return null;
    const col = Math.round(point.x + BOARD_WIDTH / 2);
    const row = Math.round(point.z + BOARD_DEPTH / 2);
    if (col < 0 || col > 8 || row < 0 || row > 9) return null;
    if (
      Math.abs(point.x - this.worldX(col)) > 0.48 ||
      Math.abs(point.z - this.worldZ(row)) > 0.48
    ) {
      return null;
    }
    return { row, col };
  }

  private setPointer(event: PointerEvent): void {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
  }

  private resize(): void {
    const width = Math.max(1, this.viewport.clientWidth);
    const height = Math.max(1, this.viewport.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(width, height);
    const fit = this.fitDistance();
    const minDistance = fit * 0.6;
    this.controls.maxDistance = Math.max(48, fit * 1.6);
    const portrait = this.camera.aspect < 1;
    this.controls.minPolarAngle = portrait ? THREE.MathUtils.degToRad(5) : Math.PI * 0.12;
    this.captureBoxes.setPortrait(portrait);
    this.room.setPortrait(portrait);
    const orientationChanged = portrait !== this.wasPortrait;
    this.wasPortrait = portrait;
    if (orientationChanged && !this.menuMode) {
      // Switching portrait/landscape glides back to the fixed overview for the new layout.
      this.setViewForTurn(this.pendingViewSide ?? this.viewSide ?? constants.sides.red, true);
      return;
    }
    const offset = this.camera.position.clone().sub(this.controls.target);
    if (offset.length() < minDistance) {
      this.camera.position
        .copy(this.controls.target)
        .add(offset.normalize().multiplyScalar(minDistance));
    }
  }

  private positionFor(row: number, col: number): THREE.Vector3 {
    return new THREE.Vector3(this.worldX(col), this.pieceBaseY(), this.worldZ(row));
  }

  private worldX(col: number): number {
    return col - BOARD_WIDTH / 2;
  }

  private worldZ(row: number): number {
    return row - BOARD_DEPTH / 2;
  }

  private pieceBaseY(): number {
    return BOARD_TOP + 0.012;
  }
}
