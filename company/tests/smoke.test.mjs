import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const pkgPath = require.resolve("../package.json");
const pkg = JSON.parse(await readFile(pkgPath, "utf8"));

test("package name is jarvis-company", () => {
  assert.equal(pkg.name, "jarvis-company");
});

test("package type is module", () => {
  assert.equal(pkg.type, "module");
});

test("test script is node --test", () => {
  assert.equal(pkg.scripts.test, "node --test");
});
