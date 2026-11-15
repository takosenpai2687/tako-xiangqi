const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");
const THREE = require("three");

const filename = path.join(__dirname, "..", "src", "capture-boxes.ts");
const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exportsObject = {};
vm.runInNewContext(output, { exports: exportsObject, require }, { filename });
const { CaptureBoxes } = exportsObject;
const sides = { red: 1, black: 0 };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

const boardFile = path.join(__dirname, "..", "src", "board-renderer.ts");
const boardOutput = ts.transpileModule(fs.readFileSync(boardFile, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const boardExports = {};
vm.runInNewContext(boardOutput, {
  exports: boardExports,
  require: name => name === "three" ? THREE : name === "./rules" ? { constants: { sides } } : {},
}, { filename: boardFile });
const { BoardRenderer } = boardExports;

test("portrait fixed views fit the board and both boxes for either side", () => {
  for (const aspect of [0.45, 0.56, 0.75, 0.9]) {
    const renderer = Object.create(BoardRenderer.prototype);
    renderer.camera = new THREE.PerspectiveCamera(33, aspect, 0.1, 200);
    const portraitDirection = renderer.fixedDirection();
    close(Math.atan2(portraitDirection.z, portraitDirection.y), THREE.MathUtils.degToRad(5));
    for (const side of [sides.red, sides.black]) {
      const target = new THREE.Vector3(0, 0.53, 0);
      renderer.camera.position.copy(target).add(renderer.fixedOffset(side));
      renderer.camera.lookAt(target);
      renderer.camera.updateMatrixWorld(true);
      renderer.camera.updateProjectionMatrix();
      const corners = [];
      let boardWidth = 0;
      for (const x of [-4.78, 4.78]) for (const z of [-5.28, 5.28]) {
        for (const y of [0.53, 1.43]) corners.push(new THREE.Vector3(x, y, z));
      }
      for (const x of [-2.7, 2.7]) for (const z of [-8.32, 8.32]) {
        corners.push(new THREE.Vector3(x, 0.49, z));
      }
      for (const corner of corners) {
        const projected = corner.project(renderer.camera);
        assert.ok(Math.abs(projected.x) <= 0.996 && Math.abs(projected.y) <= 0.961);
        boardWidth = Math.max(boardWidth, Math.abs(projected.x));
      }
      if (aspect <= 0.56) assert.ok(boardWidth >= 0.99, "phone board should fill at least 99% of screen width");
    }
  }
});

test("orientation changes defer the camera while a capture is in progress", () => {
  const renderer = Object.create(BoardRenderer.prototype);
  renderer.viewport = { clientWidth: 390, clientHeight: 844 };
  renderer.renderer = { setSize() {} };
  renderer.composer = { setSize() {} };
  renderer.camera = new THREE.PerspectiveCamera(33, 1.5, 0.1, 200);
  renderer.controls = { target: new THREE.Vector3(0, 0.53, 0), enabled: false };
  renderer.captureBoxes = { isAnimating: true, setPortrait() {} };
  renderer.room = { setPortrait() {} };
  renderer.viewSide = sides.red;
  renderer.pendingViewSide = sides.black;
  renderer.wasPortrait = false;
  renderer.menuMode = false;
  renderer.resize();
  assert.equal(renderer.pendingViewSide, sides.black);
  assert.equal(renderer.controls.enabled, false);
  close(renderer.controls.minPolarAngle, THREE.MathUtils.degToRad(5));
});

test("portrait boxes follow capturing sides and preserve stored pieces through layout changes", () => {
  const scene = new THREE.Scene();
  const boxes = new CaptureBoxes(scene, new THREE.MeshBasicMaterial(), sides, () => {});
  const captured = { side: sides.black };
  const group = new THREE.Group();
  scene.add(group);
  boxes.capture(group, captured, sides.red, 0, true);
  boxes.setPortrait(true);
  const redBox = boxes.boxes.get(sides.red);
  const blackBox = boxes.boxes.get(sides.black);
  close(redBox.group.position.z, 6.85);
  close(blackBox.group.position.z, -6.85);
  close(redBox.group.rotation.y, Math.PI / 2);
  assert.equal(group.parent, redBox.group);
  boxes.faceView(0.7);
  close(group.getWorldQuaternion(new THREE.Quaternion()).y, Math.sin(0.7 / 2));
  boxes.finish();
  close(redBox.group.rotation.y, Math.PI / 2);
  boxes.setPortrait(false);
  close(redBox.group.position.x, 6.35);
  close(blackBox.group.position.x, -6.35);
  close(redBox.group.rotation.y, 0);
  assert.equal(group.parent, redBox.group);
  boxes.dispose();
});

test("capture animation retargets the rotated box on resize", () => {
  const scene = new THREE.Scene();
  const boxes = new CaptureBoxes(scene, new THREE.MeshBasicMaterial(), sides, () => {});
  const group = new THREE.Group();
  scene.add(group);
  boxes.capture(group, { side: sides.red }, sides.black, 0, false);
  boxes.update(0.8);
  boxes.setPortrait(true);
  const animation = [...boxes.animations][0];
  const box = boxes.boxes.get(sides.black);
  box.group.updateMatrixWorld(true);
  const target = box.group.localToWorld(boxes.slotPosition(animation.entry.slot));
  close(animation.landing.x, target.x);
  close(animation.landing.z, target.z);
  boxes.update(1.65);
  boxes.update(2);
  assert.equal(group.parent, box.group);
  close(group.position.x, boxes.slotPosition(0).x);
  close(group.position.z, boxes.slotPosition(0).z);
  boxes.dispose();
});
