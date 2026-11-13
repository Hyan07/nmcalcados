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
