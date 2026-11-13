class Chessboard {
  constructor(l) {
    this.state = [];
    this.l = l;
    this.initChessboard();
  }

  putChess(chess) {
    // put a chess to its current position
    // called when chess position have changed
    this.state[chess.row][chess.col] = chess;
  }

  moveChess(chess, row, col) {
    // move the chess to target position
    // assumption: chess move is already valid
    this.state[chess.row][chess.col] = null;
    chess.row = row;
    chess.col = col;
    this.putChess(chess);
  }

  refreshChessPos() {
    for (let i = 0; i < this.state.length; i++) {
      for (let j = 0; j < this.state[i].length; j++) {
        if (!this.state[i][j]) {
          continue;
        }
        this.state[i][j].row = i;
        this.state[i][j].col = j;
      }
    }
  }

  initChessboard() {
    // init state 2d array
    for (let i = 0; i < 10; i++) {
      let row = [];
      for (let j = 0; j < 9; j++) {
        let c = null;
        row.push(c);
      }
      this.state.push(row);
    }

    // init chess arr
    const initArr = [
      new General(
        constants.sides.red,
        cfg.startPos.red.general[0],
        constants.types.general
      ),
      new General(
        constants.sides.black,
        cfg.startPos.black.general[0],
        constants.types.general
      ),

      new Advisor(
        constants.sides.red,
        cfg.startPos.red.advisor[0],
        constants.types.advisor
      ),
      new Advisor(
        constants.sides.red,
        cfg.startPos.red.advisor[1],
        constants.types.advisor
      ),
      new Advisor(
        constants.sides.black,
        cfg.startPos.black.advisor[0],
        constants.types.advisor
      ),
      new Advisor(
        constants.sides.black,
        cfg.startPos.black.advisor[1],
        constants.types.advisor
      ),

      new Elephant(
        constants.sides.red,
        cfg.startPos.red.elephant[0],
        constants.types.elephant
      ),
      new Elephant(
        constants.sides.red,
        cfg.startPos.red.elephant[1],
        constants.types.elephant
      ),
      new Elephant(
        constants.sides.black,
        cfg.startPos.black.elephant[0],
        constants.types.elephant
      ),
      new Elephant(
        constants.sides.black,
        cfg.startPos.black.elephant[1],
        constants.types.elephant
      ),

      new Horse(
        constants.sides.red,
        cfg.startPos.red.horse[0],
        constants.types.horse
      ),
      new Horse(
        constants.sides.red,
        cfg.startPos.red.horse[1],
        constants.types.horse
      ),
      new Horse(
        constants.sides.black,
        cfg.startPos.black.horse[0],
        constants.types.horse
      ),
      new Horse(
        constants.sides.black,
        cfg.startPos.black.horse[1],
        constants.types.horse
      ),

      new Chariot(
        constants.sides.red,
        cfg.startPos.red.chariot[0],
        constants.types.chariot
      ),
      new Chariot(
        constants.sides.red,
        cfg.startPos.red.chariot[1],
        constants.types.chariot
      ),
      new Chariot(
        constants.sides.black,
        cfg.startPos.black.chariot[0],
        constants.types.chariot
      ),
      new Chariot(
        constants.sides.black,
        cfg.startPos.black.chariot[1],
        constants.types.chariot
      ),

      new Cannon(
        constants.sides.red,
        cfg.startPos.red.cannon[0],
        constants.types.cannon
      ),
      new Cannon(
        constants.sides.red,
        cfg.startPos.red.cannon[1],
        constants.types.cannon
      ),
      new Cannon(
        constants.sides.black,
        cfg.startPos.black.cannon[0],
        constants.types.cannon
      ),
      new Cannon(
        constants.sides.black,
        cfg.startPos.black.cannon[1],
        constants.types.cannon
      ),

      new Soldier(
        constants.sides.red,
        cfg.startPos.red.soldier[0],
        constants.types.soldier
      ),
      new Soldier(
        constants.sides.red,
        cfg.startPos.red.soldier[1],
        constants.types.soldier
      ),
      new Soldier(
        constants.sides.red,
        cfg.startPos.red.soldier[2],
        constants.types.soldier
      ),
      new Soldier(
        constants.sides.red,
        cfg.startPos.red.soldier[3],
        constants.types.soldier
      ),
      new Soldier(
        constants.sides.red,
        cfg.startPos.red.soldier[4],
        constants.types.soldier
      ),

      new Soldier(
        constants.sides.black,
        cfg.startPos.black.soldier[0],
        constants.types.soldier
      ),
      new Soldier(
        constants.sides.black,
        cfg.startPos.black.soldier[1],
        constants.types.soldier
      ),
      new Soldier(
        constants.sides.black,
        cfg.startPos.black.soldier[2],
        constants.types.soldier
      ),
      new Soldier(
        constants.sides.black,
        cfg.startPos.black.soldier[3],
        constants.types.soldier
      ),
      new Soldier(
        constants.sides.black,
        cfg.startPos.black.soldier[4],
        constants.types.soldier
      )
    ];

    // put to state
    initArr.forEach(chess => {
      this.putChess(chess);
    });

  }
}

window.XiangqiRules = { Chessboard, constants };
