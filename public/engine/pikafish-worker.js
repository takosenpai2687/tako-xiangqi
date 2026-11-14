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

const DATA_URL = new URL("pikafish.data", self.location.href).href;
// Bump when pikafish.data changes so stale copies in Cache Storage are discarded.
const DATA_CACHE = "pikafish-data-v1";
const DATA_SIZE = 50706378;

// Returns pikafish.data as an ArrayBuffer, downloading it only once: later visits read it from
// Cache Storage (which survives refreshes) instead of the HTTP cache, which may refuse 50 MB.
async function loadData() {
  let cache = null;
  try {
    cache = await caches.open(DATA_CACHE);
    const hit = await cache.match(DATA_URL);
    if (hit) {
      const buffer = await hit.arrayBuffer();
      if (buffer.byteLength === DATA_SIZE) {
        self.postMessage({ type: "progress", value: 1 });
        return buffer;
      }
      await cache.delete(DATA_URL);
    }
  } catch {
    cache = null;
  }

  const response = await fetch(DATA_URL);
  if (!response.ok || !response.body) throw new Error("Failed to download engine data");
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    self.postMessage({ type: "progress", value: Math.min(1, loaded / DATA_SIZE) });
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (cache && loaded === DATA_SIZE) {
    try {
      await cache.put(DATA_URL, new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } }));
    } catch {
      // Storage may be full or unavailable; the engine still works without the cache.
    }
  }
  return bytes.buffer;
}

async function init() {
  try {
    const data = await loadData();
    const module = await Pikafish({
      print: handleLine,
      printErr() {},
      // Hand Emscripten the already-downloaded data instead of letting it fetch it again.
      getPreloadedPackage: () => data,
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
