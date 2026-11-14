// Classic worker hosting the Pikafish WASM engine (pthreads + SIMD, one search thread).
// Protocol: main -> {type:"init"} | {type:"search", id, fen, options, go}
//           worker -> {type:"progress", value} | {type:"ready"} | {type:"error", message}
//                     | {type:"bestmove", id, move}
// Emscripten spawns its pthread workers from document.currentScript.src, which does not exist
// inside a worker; point it at the engine script so the pool workers load pikafish.js.
globalThis.document = { currentScript: { src: new URL("pikafish.js", self.location.href).href } };
importScripts("pikafish.js");

let engine = null;
let pending = null;

function handleLine(line) {
  if (pending && line.startsWith("bestmove")) {
    const move = line.split(/\s+/)[1];
    const { id } = pending;
    pending = null;
    self.postMessage({ type: "bestmove", id, move: move && move !== "(none)" ? move : null });
  }
}

async function init() {
  try {
    const module = await Pikafish({
      print: handleLine,
      printErr() {},
      // Emscripten reports preload-file download as "Downloading data... (loaded/total)".
      setStatus(text) {
        const match = /\((\d+)\/(\d+)\)/.exec(text || "");
        if (match && Number(match[2]) > 0) {
          self.postMessage({ type: "progress", value: Number(match[1]) / Number(match[2]) });
        }
      },
    });
    engine = module.cwrap("wasm_uci_execute", null, ["string"]);
    engine("uci");
    engine("setoption name Threads value 1");
    engine("setoption name Hash value 16");
    self.postMessage({ type: "ready" });
  } catch (error) {
    self.postMessage({ type: "error", message: String(error && error.message || error) });
  }
}

self.onmessage = event => {
  const data = event.data;
  if (data.type === "init") {
    init();
  } else if (data.type === "search" && engine) {
    pending = { id: data.id };
    for (const [name, value] of Object.entries(data.options)) {
      engine(`setoption name ${name} value ${value}`);
    }
    engine(`position fen ${data.fen}`);
    // The search runs on a pthread; the result arrives asynchronously via stdout.
    engine(data.go);
  }
};
