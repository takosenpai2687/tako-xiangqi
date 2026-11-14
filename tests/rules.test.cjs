const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

const filename = path.join(__dirname, "..", "src", "rules.ts");
const source = fs.readFileSync(filename, "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const rules = {};
vm.runInNewContext(output, { exports: rules }, { filename });
const { Chessboard, constants, getLegalSteps, getLegalMoves, isInCheck } = rules;

function hasMove(moves, row, col) {
  return moves.some(move => move.row === row && move.col === col);
}

test("screenshot: moving the advisor or elephant exposes the general to the cannon", () => {
  const board = new Chessboard();
  const redGeneral = board.state[9][4];
  const advisor = board.state[9][5];
  const elephant = board.state[9][6];
  const blackGeneral = board.state[0][4];
  const cannon = board.state[2][7];
  const soldier = board.state[6][4];
  board.state = Array.from({ length: 10 }, () => Array(9).fill(null));
  for (const piece of [redGeneral, advisor, elephant, blackGeneral, soldier]) board.putChess(piece);
  cannon.row = 9;
  board.putChess(cannon);

  assert.equal(isInCheck(board.state, constants.sides.red), false);
  assert.equal(hasMove(getLegalSteps(advisor, board.state), 8, 4), false);
  assert.equal(hasMove(getLegalSteps(elephant, board.state), 7, 4), false);
  assert.equal(hasMove(getLegalSteps(elephant, board.state), 7, 8), false);

  board.state[9][7] = null;
  assert.equal(hasMove(getLegalSteps(advisor, board.state), 8, 4), true);
  assert.equal(hasMove(getLegalSteps(elephant, board.state), 7, 4), true);
});

for (const [side, row, targetRow] of [
  ["red", 9, 7],
  ["black", 0, 2],
]) {
  test(`${side} elephant cannot move or capture through a blocked eye`, () => {
    const board = new Chessboard();
    const elephant = board.state[row][6];
    const blocker = board.state[row][5];
    const victim = board.state[side === "red" ? 3 : 6][0];
    board.state[row][5] = null;
    blocker.row = (row + targetRow) / 2;
    blocker.col = 5;
    board.putChess(blocker);
    board.state[victim.row][victim.col] = null;
    assert.equal(hasMove(elephant.getNextSteps(board.state), targetRow, 4), false);
    victim.row = targetRow;
    victim.col = 4;
    board.putChess(victim);
    assert.equal(hasMove(elephant.getNextSteps(board.state), targetRow, 4), false);
    board.state[blocker.row][blocker.col] = null;
    assert.equal(hasMove(elephant.getNextSteps(board.state), targetRow, 4), true);
    board.state[targetRow][4] = null;
    victim.row = blocker.row;
    victim.col = blocker.col;
    board.putChess(victim);
    assert.equal(hasMove(elephant.getNextSteps(board.state), targetRow, 4), false);
  });
}

function boardFromFen(fen) {
  const board = new Chessboard();
  const pieces = board.state.flat().filter(Boolean);
  const letters = "kaehrcp";
  board.state = Array.from({ length: 10 }, () => Array(9).fill(null));
  for (const [row, rank] of fen.split("/").entries()) {
    let col = 0;
    for (const char of rank) {
      if (/\d/.test(char)) {
        col += Number(char);
        continue;
      }
      const side = char === char.toUpperCase() ? constants.sides.red : constants.sides.black;
      const type = letters.indexOf(char.toLowerCase());
      const index = pieces.findIndex(piece => piece.side === side && piece.type === type);
      assert.notEqual(index, -1, `No ${char} available for FEN`);
      const [piece] = pieces.splice(index, 1);
      piece.row = row;
      piece.col = col++;
      board.putChess(piece);
    }
    assert.equal(col, 9);
  }
  return board;
}

function perft(board, side, depth) {
  if (depth === 0) return 1;
  let count = 0;
  for (const { piece, to } of getLegalMoves(board.state, side)) {
    const from = { row: piece.row, col: piece.col };
    const captured = board.state[to.row][to.col];
    board.moveChess(piece, to.row, to.col);
    count += perft(board, 1 - side, depth - 1);
    board.moveChess(piece, from.row, from.col);
    board.state[to.row][to.col] = captured;
  }
  return count;
}

// Published legal-move tree counts: https://www.chessprogramming.org/Chinese_Chess_Perft_Results
const perftPositions = [
  ["rheakaehr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RHEAKAEHR", [44, 1920, 79666]],
  ["r1ea1a3/4kh3/2h1e4/pHp1p1p1p/4c4/6P2/P1P2R2P/1CcC5/9/2EAKAE2", [38, 1128, 43929]],
  ["1ceak4/9/h2a5/2p1p3p/5cp2/2h2H3/6PCP/3AE4/2C6/3A1K1H1", [7, 281, 8620]],
  ["5a3/3k5/3aR4/9/5r3/5h3/9/3A1A3/5K3/2EC2E2", [25, 424, 9850]],
  ["CRH1k1e2/3ca4/4ea3/9/2hr5/9/9/4E4/4A4/4KA3", [28, 516, 14808]],
  ["R1H1k1e2/9/3aea3/9/2hr5/2E6/9/4E4/4A4/4KA3", [21, 364, 7626]],
  ["C1hHk4/9/9/9/9/9/h1pp5/E3C4/9/3A1K3", [28, 222, 6241]],
  ["4ka3/4a4/9/9/4H4/p8/9/4C3c/7h1/2EK5", [23, 345, 8124]],
  ["2e1ka3/9/e3H4/4h4/9/9/9/4C4/2p6/2EK5", [21, 195, 3883]],
  ["1C2ka3/9/C1Hae1h2/p3p3p/6p2/9/P3P3P/3AE4/3p2c2/c1EAK4", [30, 830, 22787]],
  ["ChH1k1e2/c3a4/4ea3/9/2hr5/9/9/4C4/4A4/4KA3", [19, 583, 11714]],
];

test("legal move trees match published xiangqi benchmarks", () => {
  for (const [fen, expected] of perftPositions) {
    const board = boardFromFen(fen);
    for (const [index, count] of expected.entries()) {
      assert.equal(perft(board, constants.sides.red, index + 1), count, `${fen}: depth ${index + 1}`);
    }
  }
});

test("elephant eyes block all four directions for both sides, regardless of blocker color", () => {
  for (const side of [constants.sides.red, constants.sides.black]) {
    const row = side === constants.sides.red ? 7 : 2;
    for (const [dr, dc] of [[-2, -2], [-2, 2], [2, -2], [2, 2]]) {
      for (const blockerSide of [side, 1 - side]) {
        const board = new Chessboard();
        const pieces = board.state.flat().filter(Boolean);
        const elephant = pieces.find(piece => piece.side === side && piece.type === constants.types.elephant);
        const blocker = pieces.find(piece => piece.side === blockerSide && piece.type === constants.types.soldier);
        const victim = pieces.find(piece => piece.side !== side && piece.type === constants.types.chariot);
        board.state = Array.from({ length: 10 }, () => Array(9).fill(null));
        Object.assign(elephant, { row, col: 4 });
        Object.assign(blocker, { row: row + dr / 2, col: 4 + dc / 2 });
        Object.assign(victim, { row: row + dr, col: 4 + dc });
        board.putChess(elephant);
        board.putChess(victim);
        assert.equal(hasMove(elephant.getNextSteps(board.state), victim.row, victim.col), true);
        board.putChess(blocker);
        assert.equal(hasMove(elephant.getNextSteps(board.state), victim.row, victim.col), false);
      }
    }
    const board = boardFromFen(side === constants.sides.red
      ? "4k4/9/9/9/9/2E6/9/9/9/3K5"
      : "3k5/9/9/9/2e6/9/9/9/9/5K3");
    const elephant = board.state.flat().find(piece => piece?.type === constants.types.elephant);
    assert.ok(elephant.getNextSteps(board.state).every(move => side === constants.sides.red ? move.row >= 5 : move.row <= 4));
  }
});

test("horse legs block both destinations on the obstructed axis", () => {
  for (const [legRow, legCol, blocked] of [
    [4, 4, [[3, 3], [3, 5]]], [6, 4, [[7, 3], [7, 5]]],
    [5, 3, [[4, 2], [6, 2]]], [5, 5, [[4, 6], [6, 6]]],
  ]) {
    const board = boardFromFen("3k5/9/9/9/9/4H4/9/9/9/5K3");
    const horse = board.state[5][4];
    const blocker = board.state[0][3];
    board.state[0][3] = null;
    Object.assign(blocker, { row: legRow, col: legCol });
    board.putChess(blocker);
    const moves = horse.getNextSteps(board.state);
    assert.equal(moves.length, 6);
    for (const [row, col] of blocked) assert.equal(hasMove(moves, row, col), false);
  }
});

test("cannon captures only over exactly one screen and cannot capture its own piece", () => {
  const board = boardFromFen("3k5/9/9/9/9/C1p1r1P1r/9/9/9/5K3");
  const moves = board.state[5][0].getNextSteps(board.state);
  assert.equal(hasMove(moves, 5, 1), true);
  assert.equal(hasMove(moves, 5, 2), false);
  assert.equal(hasMove(moves, 5, 3), false);
  assert.equal(hasMove(moves, 5, 4), true);
  assert.equal(hasMove(moves, 5, 6), false);
  assert.equal(hasMove(moves, 5, 8), false);
});

test("soldiers move sideways only after crossing the river and never backwards", () => {
  for (const [side, before, after, forward] of [
    [constants.sides.red, 5, 4, -1],
    [constants.sides.black, 4, 5, 1],
  ]) {
    const board = new Chessboard();
    const soldier = board.state.flat().find(piece => piece?.side === side && piece.type === constants.types.soldier);
    board.state = Array.from({ length: 10 }, () => Array(9).fill(null));
    Object.assign(soldier, { row: before, col: 4 });
    board.putChess(soldier);
    let moves = soldier.getNextSteps(board.state);
    assert.equal(moves.length, 1);
    assert.equal(hasMove(moves, before + forward, 4), true);
    board.state[before][4] = null;
    soldier.row = after;
    board.putChess(soldier);
    moves = soldier.getNextSteps(board.state);
    assert.equal(moves.length, 3);
    assert.equal(hasMove(moves, after - forward, 4), false);
  }
});

test("facing generals cannot be exposed by moving their only blocker", () => {
  const board = boardFromFen("4k4/9/9/9/9/4R4/9/9/9/4K4");
  const rook = board.state[5][4];
  assert.equal(isInCheck(board.state, constants.sides.red), false);
  assert.equal(hasMove(getLegalSteps(rook, board.state), 5, 3), false);
  assert.equal(hasMove(getLegalSteps(rook, board.state), 4, 4), true);
});

test("checkmate and stalemate both leave the defending side without legal moves", () => {
  const checkmate = boardFromFen("R3k4/R8/9/9/9/9/9/9/9/3K5");
  assert.equal(isInCheck(checkmate.state, constants.sides.black), true);
  assert.equal(getLegalMoves(checkmate.state, constants.sides.black).length, 0);

  const stalemate = boardFromFen("4k4/R8/2H3H2/9/9/9/9/9/9/3K5");
  assert.equal(isInCheck(stalemate.state, constants.sides.black), false);
  assert.equal(getLegalMoves(stalemate.state, constants.sides.black).length, 0);
});

test("the controller awards both checkmate and stalemate to the opponent", () => {
  const controllerFile = path.join(__dirname, "..", "src", "game-controller.ts");
  const controllerOutput = ts.transpileModule(fs.readFileSync(controllerFile, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const controllerExports = {};
  vm.runInNewContext(controllerOutput, {
    exports: controllerExports,
    require: name => name === "./rules" ? rules : {},
  }, { filename: controllerFile });
  for (const fen of [
    "R3k4/R8/9/9/9/9/9/9/9/3K5",
    "4k4/R8/2H3H2/9/9/9/9/9/9/3K5",
  ]) {
    const game = Object.create(controllerExports.GameController.prototype);
    game.rules = constants;
    game.board = boardFromFen(fen);
    game.turn = constants.sides.black;
    game.evaluationToken = 0;
    let winner = null;
    game.view = { onWinner(value) { winner = value; } };
    game.checkWinner();
    assert.equal(winner, "red");
    assert.equal(game.winRateRed, 100);
  }
});
