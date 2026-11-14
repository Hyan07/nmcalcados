import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { errorHandler } from "../src/middlewares/errors.js";
const valid = {
  ...process.env,
  NODE_ENV: "production",
  APP_ORIGIN: "https://example.com",
  SESSION_SECRET: "a".repeat(64),
  DB_HOST: "localhost",
  DB_NAME: "test",
  DB_USER: "test",
  DB_PASSWORD: "test",
};
function check(overrides) {
  return spawnSync(
    process.execPath,
    ["--input-type=module", "-e", "import './src/config/env.js'"],
    {
      env: { ...valid, ...overrides, DOTENV_CONFIG_PATH: "/dev/null" },
      encoding: "utf8",
    },
  );
}
test("produção exige segredo explícito, HTTPS e números válidos", () => {
  assert.equal(check({}).status, 0);
  for (const overrides of [
    { SESSION_SECRET: "" },
    {
      SESSION_SECRET:
        "replace-with-a-long-random-secret-at-least-32-characters",
    },
    { APP_ORIGIN: "http://example.com" },
    { APP_ORIGIN: "https://example.com/path" },
    { DB_PASSWORD: "" },
    { PORT: "NaN" },
    { TRUST_PROXY: "-1" },
  ])
    assert.notEqual(check(overrides).status, 0);
});
test("erros de JSON respondem 400/413 sem expor corpo", () => {
  for (const [type, status] of [
    ["entity.parse.failed", 400],
    ["entity.too.large", 413],
  ]) {
    let actual, body;
    const res = {
      status(s) {
        actual = s;
        return this;
      },
      json(b) {
        body = b;
      },
    };
    errorHandler({ type, body: "sensitive" }, null, res, () => {});
    assert.equal(actual, status);
    assert.ok(!JSON.stringify(body).includes("sensitive"));
  }
});

// Exercita o require CommonJS utilizado pelo carregador da hospedagem.
// O código 17 confirma que todas as asserções do subprocesso foram executadas.
function requireEntry(script) {
  return spawnSync(process.execPath, ["--input-type=commonjs", "-e", script], {
    env: {
      ...valid,
      DOTENV_CONFIG_PATH: "/dev/null",
      NODE_TEST_CONTEXT: undefined,
    },
    encoding: "utf8",
    timeout: 10000,
  });
}
test("entrada funciona via require e verifica banco antes de escutar", () => {
  const result = requireEntry(`
    const assert = require('node:assert/strict');
    let checked = false, started = false;
    require('mysql2/promise').createPool = () => ({
      on() {}, async query() { checked = true; }, async end() {},
    });
    const { app } = require('./src/app.js');
    app.listen = () => {
      assert.equal(checked, true);
      started = true;
      return { on() {}, close() {}, closeIdleConnections() {} };
    };
    require('./src/server.js');
    setImmediate(() => { assert.equal(started, true); process.exitCode = 17; });
  `);
  assert.equal(result.status, 17, result.stderr);
});
test("falha do banco via require encerra e não expõe mensagem do driver", () => {
  const result = requireEntry(`
    const assert = require('node:assert/strict');
    let closed = false, logged = '';
    console.error = (...args) => { logged += args.join(' '); };
    require('mysql2/promise').createPool = () => ({
      on() {},
      async query() { throw Object.assign(new Error('sensitive'), { code: 'DB_UNAVAILABLE' }); },
      async end() { closed = true; },
    });
    const { app } = require('./src/app.js');
    app.listen = () => { throw new Error('Não deve abrir HTTP sem banco'); };
    require('./src/server.js');
    setImmediate(() => {
      assert.equal(process.exitCode, 1);
      assert.equal(closed, true);
      assert.ok(logged.includes('DB_UNAVAILABLE'));
      assert.ok(!logged.includes('sensitive'));
      process.exitCode = 17;
    });
  `);
  assert.equal(result.status, 17, result.stderr);
});
