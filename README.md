# tako-xiangqi

![Xiangqi gameplay](docs/screenshots/game.webp)

## English

Play Chinese chess with a friend in a quiet Japanese-style tea room, or challenge the computer at three difficulty levels. The game keeps the original chess rules.

**Play now:** [https://tako-xiangqi.netlify.app](https://tako-xiangqi.netlify.app)

### Features

- Choose red (first move) or black (second move) against the computer; the view stays on your side.
- A realistic 3D board, pieces, and tea room with warm lighting, tea cups, and rising steam.
- Traditional 馬 and 車 piece lettering, with distinct 炮 (red) and 砲 (black). River labels 楚河 and 汉界 face the red player and appear upside down from the black side.
- Click or drag pieces to move; legal destinations appear when a piece is selected.
- Rotate and zoom the view, with a smooth camera turn when players switch sides.
- Piece selection, movement, captures, and captured-piece storage have animations.
- Piece lettering gently pulses with light in the main menu.
- Selected pieces' lettering glows through dragging and movement.
- Both pieces' lettering briefly lights up during a capture.
- Distinct red and black move sounds, plus piece pickup, capture, and undo sounds.
- Undo, restart, and a victory screen.
- Chinese and English UI: defaults to Chinese for a Chinese browser language, otherwise English. Choose from the main menu; your choice is saved locally and takes priority on future visits. Piece textures remain unchanged.
- Graphics settings for ambient occlusion, depth of field, anti-aliasing, and volumetric light.
- Online resources are automatically routed to Alibaba Cloud for mainland China and Netlify for other regions. Local development and localhost previews always use local assets.

### Controls

- Select a piece and then a legal destination, or drag the piece to move it.
- Drag from an empty area to rotate the view; use the mouse wheel to zoom.
- 🍵 Your move, your tea break. Click your cup on your turn to take a sip—no rush!
- Use the on-screen controls to undo or restart.

### Credits

- Tech stack: Three.js and TypeScript.
- The 3D scene and models were AI-assisted; textures were AI-assisted and prepared for the game.
- Sound effects were generated with EventLabs.
- The computer opponent is [Pikafish](https://github.com/official-pikafish/Pikafish) (GPLv3, WebAssembly build running locally in the browser; the NNUE weights are for non-commercial use only).

## 中文

**立即游玩：** [https://tako-xiangqi.netlify.app](https://tako-xiangqi.netlify.app)

在静谧的和室棋室中，和朋友来一局中国象棋，或挑战三档难度的电脑对手。沿用原有象棋规则。

### 游戏特色

- 人机对战可选择红方或黑方，视角固定在玩家一侧。
- 写实 3D 棋盘、棋子与和室场景，搭配柔和暖光、茶杯和缓缓升起的热气。
- 棋子采用「馬」「車」，红方为「炮」、黑方为「砲」；河界「楚河」「汉界」固定朝向红方，黑方视角下倒置，不镜像。
- 点击或拖动棋子即可走棋，选中时会显示合法落点。
- 可旋转、缩放棋盘视角，换边时镜头平顺转换。
- 棋子升起、落子、吃子和提子入盒均有动画反馈。
- 主菜单中的棋子字样带有柔和的呼吸发光效果。
- 选中棋子的字样持续微亮，拖动和落子动画期间保持。
- 吃子时，双方棋子的字样会短暂发光。
- 红黑双方使用不同的落子音效，并提供选子、吃子和悔棋音效。
- 支持悔棋、重开与胜局提示。
- 首次访问跟随浏览器语言：中文环境默认中文，其余默认英文。主菜单可切换语言，本机记住选择，下次访问优先使用；棋子贴图不变。
- 可调整环境光遮蔽、景深、抗锯齿与体积光。
- 线上资源按地区自动分流：中国大陆使用阿里云，其他地区使用 Netlify。本地开发及 localhost 预览始终使用本地资源。

### 操作方式

- 点击棋子，再点击合法落点；也可以直接拖动棋子落子。
- 从棋子以外的位置拖动可旋转视角；滚轮可缩放。
- 🍵 棋可以慢慢想，茶可别凉了。轮到你时，点点自己的茶杯，先喝一口～
- 使用界面上的“悔棋”和“重开”进行对应操作。

### 制作信息

- 技术栈：Three.js、TypeScript。
- 3D 场景与模型由 AI 辅助构建，贴图由 AI 辅助生成并整理。
- 音效由 EventLabs 生成。
- 电脑对手使用 [Pikafish](https://github.com/official-pikafish/Pikafish)（GPLv3，WebAssembly 版，在浏览器本地运行；NNUE 权重仅限非商业用途）。
