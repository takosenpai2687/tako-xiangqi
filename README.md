# tako-xiangqi

![中国象棋游戏画面](docs/screenshots/game.webp)

**立即游玩：** [https://tako-xiangqi.netlify.app](https://tako-xiangqi.netlify.app)

在静谧的和室棋室中，和朋友来一局中国象棋，或挑战三档难度的电脑对手。沿用原有象棋规则。

## 游戏特色

- 写实 3D 棋盘、棋子与和室场景，搭配柔和暖光、茶杯和缓缓升起的热气。
- 点击或拖动棋子即可走棋，选中时会显示合法落点。
- 可旋转、缩放棋盘视角，换边时镜头平顺转换。
- 棋子升起、落子、吃子和提子入盒均有动画反馈。
- 红黑双方使用不同的落子音效，并提供选子、吃子和悔棋音效。
- 支持悔棋、重开与胜局提示。

## 操作方式

- 点击棋子，再点击合法落点；也可以直接拖动棋子落子。
- 从棋子以外的位置拖动可旋转视角；滚轮可缩放。
- 使用界面上的“悔棋”和“重开”进行对应操作。

## 制作信息

- 技术栈：Three.js、TypeScript。
- 3D 场景与模型由 AI 辅助构建，贴图由 AI 辅助生成并整理。
- 音效由 EventLabs 生成。
- 电脑对手使用 [Pikafish](https://github.com/official-pikafish/Pikafish)（GPLv3，WebAssembly 版，在浏览器本地运行；NNUE 权重仅限非商业用途）。

## English

Play Chinese chess with a friend in a quiet Japanese-style tea room, or challenge the computer at three difficulty levels. The game keeps the original chess rules.

**Play now:** [https://tako-xiangqi.netlify.app](https://tako-xiangqi.netlify.app)

### Features

- A realistic 3D board, pieces, and tea room with warm lighting, tea cups, and rising steam.
- Click or drag pieces to move; legal destinations appear when a piece is selected.
- Rotate and zoom the view, with a smooth camera turn when players switch sides.
- Piece selection, movement, captures, and captured-piece storage have animations.
- Distinct red and black move sounds, plus piece pickup, capture, and undo sounds.
- Undo, restart, and a victory screen.

### Controls

- Select a piece and then a legal destination, or drag the piece to move it.
- Drag from an empty area to rotate the view; use the mouse wheel to zoom.
- Use the on-screen controls to undo or restart.

### Credits

- Tech stack: Three.js and TypeScript.
- The 3D scene and models were AI-assisted; textures were AI-assisted and prepared for the game.
- Sound effects were generated with EventLabs.
- The computer opponent is [Pikafish](https://github.com/official-pikafish/Pikafish) (GPLv3, WebAssembly build running locally in the browser; the NNUE weights are for non-commercial use only).
