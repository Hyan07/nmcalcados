import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function harness({ native, code, capabilities = {}, media } = {}) {
  const source = await readFile(
    new URL("../public/js/admin.js", import.meta.url),
    "utf8",
  );
  const nodes = new Map(),
    timers = new Map(),
    reads = [],
    added = [],
    messages = [],
    constraints = [];
  let timerId = 0,
    stopped = 0,
    decodes = 0,
    hints;
  const get = (selector) => {
    if (!nodes.has(selector))
      nodes.set(selector, {
        open: false,
        attributes: {},
        showModal() {
          this.open = true;
        },
        close() {
          this.open = false;
        },
        addEventListener() {},
        async play() {},
        setAttribute(key, value) {
          this.attributes[key] = value;
        },
        getAttribute(key) {
          return this.attributes[key];
        },
      });
    return nodes.get(selector);
  };
  const track = {
    stop() {
      stopped++;
    },
    getCapabilities: () => capabilities,
    getSettings: () => ({ zoom: 1 }),
    async applyConstraints(value) {
      constraints.push(value);
    },
  };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  class NotFoundException extends Error {}
  const ZXing = {
    BarcodeFormat: Object.fromEntries(
      [
        "EAN_13",
        "EAN_8",
        "UPC_A",
        "UPC_E",
        "CODE_128",
        "CODE_39",
        "CODE_93",
        "ITF",
        "CODABAR",
      ].map((x) => [x, x]),
    ),
    DecodeHintType: { POSSIBLE_FORMATS: "formats", TRY_HARDER: "harder" },
    NotFoundException,
    ChecksumException: class extends Error {},
    FormatException: class extends Error {},
    BrowserMultiFormatReader: class {
      constructor(value) {
        hints = value;
      }
      decode() {
        decodes++;
        if (code) return { getText: () => code };
        throw new NotFoundException();
      }
      reset() {}
    },
  };
  const context = vm.createContext({
    $: get,
    window: { ZXing, BarcodeDetector: native },
    ZXing,
    navigator: {
      mediaDevices: {
        getUserMedia: async (value) => {
          constraints.push(value);
          return media ? media(stream) : stream;
        },
      },
    },
    setTimeout(callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    api: async (url) => {
      reads.push(url);
      return { variantId: 1 };
    },
    addPos: (item) => added.push(item),
    toast: (...args) => messages.push(args),
  });
  vm.runInContext(
    source.slice(
      source.indexOf("let cameraStream = null"),
      source.indexOf("async function sales("),
    ),
    context,
  );
  return {
    get,
    reads,
    added,
    messages,
    constraints,
    timers,
    run: (code) => vm.runInContext(code, context),
    stopped: () => stopped,
    decodes: () => decodes,
    hints: () => hints,
    async tick(delay) {
      const entry = [...timers.entries()].find(([, x]) => x.delay === delay);
      assert.ok(entry, `timer ${delay}`);
      timers.delete(entry[0]);
      await entry[1].callback();
    },
  };
}

test("câmera sem leitor nativo decodifica vídeo já iniciado e adiciona apenas uma vez", async () => {
  const h = await harness({ code: "07900190052717" });
  await h.run("openCamera()");
  assert.equal(h.decodes(), 1);
  assert.equal(h.reads[0], "/api/admin/products/barcode/07900190052717");
  assert.equal(h.added.length, 1);
  assert.equal(h.stopped(), 1);
  assert.equal(h.get("#camera-dialog").open, false);
  assert.ok(h.hints().get("formats").includes("CODE_128"));
  assert.equal(h.hints().get("harder"), true);
  await h.run("onCameraCode('07900190052717')");
  assert.equal(h.added.length, 1);
  assert.equal(h.timers.size, 0);
});

test("falha do detector nativo aciona leitor alternativo", async () => {
  class Native {
    static async getSupportedFormats() {
      return ["ean_13"];
    }
    async detect() {
      throw new Error("unsupported camera image");
    }
  }
  const h = await harness({ native: Native });
  await h.run("openCamera()");
  await new Promise(setImmediate);
  assert.equal(h.decodes(), 1);
  assert.equal(h.get("#camera-dialog").open, true);
  await h.tick(150);
  assert.equal(h.decodes(), 2);
  h.run("stopCamera()");
  assert.equal(h.timers.size, 0);
});

test("detector sem resposta não impede fallback e resultado atrasado é ignorado", async () => {
  let resolve;
  class Native {
    static async getSupportedFormats() {
      return ["ean_13"];
    }
    detect() {
      return new Promise((done) => {
        resolve = done;
      });
    }
  }
  const h = await harness({ native: Native });
  await h.run("openCamera()");
  await h.tick(4000);
  assert.equal(h.decodes(), 1);
  resolve([{ rawValue: "OLD" }]);
  await new Promise(setImmediate);
  assert.equal(h.added.length, 0);
});

test("fechar enquanto a permissão da câmera está pendente libera o stream tardio", async () => {
  let resolve, pendingStream;
  const h = await harness({
    media: (stream) => {
      pendingStream = stream;
      return new Promise((done) => {
        resolve = done;
      });
    },
  });
  const opening = h.run("openCamera()");
  h.run("stopCamera()");
  resolve(pendingStream);
  await opening;
  assert.equal(h.stopped(), 1);
  assert.equal(h.decodes(), 0);
  assert.equal(h.get("#camera-video").srcObject, null);
});

test("configura resolução, foco e controles somente quando suportados", async () => {
  const h = await harness({
    capabilities: {
      focusMode: ["continuous"],
      torch: true,
      zoom: { min: 1, max: 8, step: 0.1 },
    },
  });
  await h.run("openCamera()");
  assert.equal(h.constraints[0].video.width.ideal, 1920);
  assert.equal(h.constraints[0].video.facingMode.ideal, "environment");
  assert.equal(h.constraints[1].advanced[0].focusMode, "continuous");
  assert.equal(h.get("#camera-torch").hidden, false);
  await h.get("#camera-torch").onclick();
  assert.equal(h.get("#camera-torch").getAttribute("aria-pressed"), "true");
  assert.equal(h.get("#camera-zoom").max, 4);
  const basic = await harness();
  await basic.run("openCamera()");
  assert.equal(basic.get("#camera-torch").hidden, true);
  assert.equal(basic.get("#camera-zoom-control").hidden, true);
});

test("leitor nativo usa somente formatos suportados e cancela fallback após leitura", async () => {
  let selected;
  class Native {
    static async getSupportedFormats() {
      return ["ean_13", "qr_code"];
    }
    constructor(options) {
      selected = options.formats;
    }
    async detect() {
      return [{ rawValue: "07900190052717" }];
    }
  }
  const h = await harness({ native: Native });
  await h.run("openCamera()");
  await new Promise(setImmediate);
  assert.deepEqual(Array.from(selected), ["ean_13"]);
  assert.equal(h.reads.length, 1);
  assert.equal(h.decodes(), 0);
  assert.equal(h.timers.size, 0);
});
