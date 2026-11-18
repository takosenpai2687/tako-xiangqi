const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

function loadModule(name, imports) {
  const filename = path.join(__dirname, "..", "src", `${name}.ts`);
  const source = fs.readFileSync(filename, "utf8")
    .replaceAll("import.meta.env.BASE_URL", '"/"');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, {
    exports,
    require(id) {
      assert.ok(id in imports, `Unexpected import: ${id}`);
      return imports[id];
    },
    console,
    Worker: FakeWorker,
  }, { filename });
  return exports;
}

class FakeWorker {
  static latest;
  messages = [];

  constructor() {
    FakeWorker.latest = this;
  }

  postMessage(message) {
    this.messages.push(message);
  }

  terminate() {}
}

const engineModule = loadModule("ai-engine", {
  "./resource-source": { resourceUrl: value => value },
});
const rules = loadModule("rules", {});
const { GameController } = loadModule("game-controller", {
  "./rules": rules,
  "./ai-engine": engineModule,
  "./game-audio": {
    GameAudio: class {
      play() {}
      playMoveAndCapture() {}
    },
  },
});

function createGame(humanSide = rules.constants.sides.red) {
  let state;
  let hint;
  const renderer = {
    setActionHandler() {},
    setTeaSoundHandler() {},
    setTeaSide() {},
    setViewForTurn() {},
    sync() {},
    setHint(position) { hint = position; },
  };
  const searches = [];
  const engine = {
    resets: 0,
    reset() { this.resets++; },
    search(fen, level, moves) {
      return new Promise(resolve => searches.push({ fen, level, moves, resolve }));
    },
  };
  const game = new GameController(renderer, {
    onStateChange(value) { state = value; },
    onWinner() { assert.fail("Unexpected winner"); },
  });
  game.setAi({ engine, level: "easy", humanSide });
  // Keep these checks focused on hints, without starting evaluation or AI timers.
  game.evaluateWinRate = async () => {};
  game.queueAiMove = () => {};
  game.newGame();
  game.start();
  return { game, engine, searches, state: () => state, hint: () => hint };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
const initialFen = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
const hintResult = { move: { from: { row: 6, col: 0 }, to: { row: 5, col: 0 } }, score: null };

test("changing hint difficulty replaces an active request and uses the new level", async () => {
  const fixture = createGame();
  const { game, engine, searches } = fixture;
  const oldHint = game.requestHint();
  await flush();
  assert.equal(searches[0].level, "normal");
  const previousResets = engine.resets;
  game.setHintLevel("hard");
  assert.equal(engine.resets, previousResets + 1);
  assert.equal(fixture.state().hintLevel, "hard");
  assert.equal(fixture.state().hintThinking, true);
  searches[0].resolve(hintResult);
  await oldHint;
  assert.equal(fixture.state().selected, null);
  await flush();
  assert.equal(searches.length, 2);
  assert.equal(searches[1].level, "hard");
  searches[1].resolve({
    move: { from: { row: 6, col: 2 }, to: { row: 5, col: 2 } },
    score: null,
  });
  await flush();
  assert.equal(fixture.state().selected, game.board.state[6][2]);
  assert.equal(fixture.hint().col, 2);
  assert.equal(fixture.state().hintThinking, false);
  game.setHintLevel("hard");
  await flush();
  assert.equal(searches.length, 2, "unchanged difficulty must not restart the search");
});

test("changing hint difficulty starts a hint without a prior request, but not on the AI turn", async () => {
  const fixture = createGame();
  const { game, searches } = fixture;
  game.setHintLevel("easy");
  await flush();
  assert.equal(searches.length, 1);
  assert.equal(searches[0].level, "easy");
  searches[0].resolve(hintResult);
  await flush();
  assert.equal(fixture.hint().col, 0);
  game.movePiece({ row: 5, col: 0 });
  game.setHintLevel("hard");
  await flush();
  assert.equal(searches.length, 1);
  assert.equal(fixture.state().hintLevel, "hard");
  assert.equal(fixture.state().hintThinking, false);
  assert.equal(fixture.hint(), null);
});

for (const humanSide of [rules.constants.sides.red, rules.constants.sides.black]) {
  test(`only AI moves reset search history when human side is ${humanSide}`, () => {
    const { game, engine } = createGame(humanSide);
    const initialResets = engine.resets;
    game.selected = game.board.state[6][0];
    game.movePiece({ row: 5, col: 0 });
    assert.equal(engine.resets, initialResets + (humanSide === rules.constants.sides.black ? 1 : 0));
    game.selected = game.board.state[3][0];
    game.movePiece({ row: 4, col: 0 });
    assert.equal(engine.resets, initialResets + 1);
  });
}

test("engine resets are deferred until the next search and are consumed once", async () => {
  const engine = new engineModule.AiEngine();
  const ready = engine.load();
  const worker = FakeWorker.latest;
  worker.onmessage({ data: { type: "ready" } });
  await ready;
  const first = engine.analyze(initialFen);
  await flush();
  engine.reset();
  assert.equal(worker.messages.length, 2, "reset must not interrupt an active search");
  worker.onmessage({ data: { type: "bestmove", id: 1, move: "a3a4" } });
  await first;
  const second = engine.analyze(initialFen);
  await flush();
  assert.equal(worker.messages[2].reset, true);
  worker.onmessage({ data: { type: "bestmove", id: 2, move: "a3a4" } });
  await second;
  const third = engine.analyze(initialFen);
  await flush();
  assert.equal(worker.messages[3].reset, false);
  engine.dispose();
  await third;
});

for (const operation of ["undo", "restart"]) {
  test(`${operation} discards an active hint and searches the restored position`, async () => {
    const fixture = createGame();
    const { game, engine, searches } = fixture;
    if (operation === "undo") {
      game.selected = game.board.state[6][0];
      game.movePiece({ row: 5, col: 0 });
      game.selected = game.board.state[3][0];
      game.movePiece({ row: 4, col: 0 });
    }
    const oldHint = game.requestHint();
    await flush();
    assert.equal(searches.length, 1);
    const previousResets = engine.resets;
    if (operation === "undo") game.undo();
    else {
      game.newGame();
      game.start();
    }
    assert.equal(engine.resets, previousResets + 1);
    assert.equal(fixture.hint(), null);
    const newHint = game.requestHint();
    await flush();
    assert.equal(searches.length, 1, "new search must wait for the old search");
    searches[0].resolve(hintResult);
    await oldHint;
    assert.equal(fixture.state().selected, null, "stale hint must not select a piece");
    assert.equal(fixture.hint(), null);
    await flush();
    assert.equal(searches[1].fen, initialFen);
    assert.equal(searches[1].moves.length, 0);
    searches[1].resolve(hintResult);
    await newHint;
    assert.equal(fixture.state().selected, game.board.state[6][0]);
    assert.equal(fixture.hint().row, 5);
    assert.equal(fixture.state().hintError, false);
  });
}

test("worker clears engine history before positioning and searching after a reset", () => {
  const commands = [];
  const self = { location: { href: "https://example.test/engine/pikafish-worker.js" } };
  const filename = path.join(__dirname, "..", "public", "engine", "pikafish-worker.js");
  vm.runInNewContext(
    fs.readFileSync(filename, "utf8") + "\nengine = command => commands.push(command);",
    { self, URL, importScripts() {}, commands },
  );
  self.onmessage({
    data: { type: "search", id: 1, fen: initialFen, moves: ["a3a4", "a6a5"], options: {}, go: "go depth 5", reset: true },
  });
  assert.deepEqual(commands, ["ucinewgame", `position fen ${initialFen} moves a3a4 a6a5`, "go depth 5"]);
});

test("hard hints and easy opponents request different budgets with fresh search caches", async () => {
  const engine = new engineModule.AiEngine();
  const ready = engine.load();
  const worker = FakeWorker.latest;
  worker.onmessage({ data: { type: "ready" } });
  await ready;
  for (const [level, go] of [
    ["hard", "go movetime 900"],
    ["easy", "go depth 1"],
    ["normal", "go depth 5 movetime 400"],
  ]) {
    const result = engine.search(initialFen, level, ["a3a4", "a6a5"]);
    await flush();
    const request = worker.messages.at(-1);
    assert.equal(request.go, go);
    assert.equal(request.reset, true, "previous deeper searches must not leak into an easier search");
    assert.equal(Array.from(request.moves).join(" "), "a3a4 a6a5");
    worker.onmessage({ data: { type: "bestmove", id: request.id, move: "b0c2" } });
    await result;
  }
  engine.dispose();
});

test("hints receive actual repeated moves, and undo keeps only the retained branch", async () => {
  const { game, searches } = createGame();
  const cycle = [
    [9, 1, 7, 2], [0, 1, 2, 2], [7, 2, 9, 1], [2, 2, 0, 1],
  ];
  for (let repeat = 0; repeat < 2; repeat++) {
    for (const [row, col, toRow, toCol] of cycle) {
      const piece = game.board.state[row][col];
      assert.ok(rules.getLegalSteps(piece, game.board.state).some(step => step.row === toRow && step.col === toCol));
      game.selected = piece;
      game.movePiece({ row: toRow, col: toCol });
    }
  }
  const hint = game.requestHint();
  await flush();
  assert.equal(searches[0].fen, initialFen);
  assert.equal(Array.from(searches[0].moves).join(" "), "b0c2 b9c7 c2b0 c7b9 b0c2 b9c7 c2b0 c7b9");
  searches[0].resolve(hintResult);
  await hint;
  game.undo();
  const revised = game.requestHint();
  await flush();
  assert.equal(Array.from(searches[1].moves).join(" "), "b0c2 b9c7 c2b0 c7b9 b0c2 b9c7");
  searches[1].resolve({ move: { from: { row: 7, col: 2 }, to: { row: 9, col: 1 } }, score: null });
  await revised;
});

test("hint rejects opponent moves and leaves no misleading destination", async () => {
  const fixture = createGame();
  const pending = fixture.game.requestHint();
  await flush();
  fixture.searches[0].resolve({ move: { from: { row: 3, col: 0 }, to: { row: 4, col: 0 } }, score: null });
  await pending;
  assert.equal(fixture.hint(), null);
  assert.equal(fixture.state().hintError, true);
});

test("win-rate analysis receives the same base position and actual history as hints", async () => {
  const { game, engine } = createGame();
  game.selected = game.board.state[6][0];
  game.movePiece({ row: 5, col: 0 });
  let analyzed = false;
  engine.analyze = async (fen, time, moves) => {
    analyzed = true;
    assert.equal(fen, initialFen);
    assert.equal(time, 160);
    assert.equal(Array.from(moves).join(" "), "a3a4");
    return null;
  };
  await game.searchPosition(engine, "hard", () => true, true);
  assert.equal(analyzed, true);
});
