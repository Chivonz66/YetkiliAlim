import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEPARTMENTS_DIR = fileURLToPath(new URL("../config/departments/", import.meta.url));

const REQUIRED_KEYS = ["id", "name", "mission", "default_model_tier", "budget", "roles"];
const VALID_TIERS = new Set(["fast", "smart", "code", "vision"]);

const entries = readdirSync(DEPARTMENTS_DIR, { withFileTypes: true });
const fileNames = entries.filter((e) => e.isFile()).map((e) => e.name);

test("exactly 12 department files exist", () => {
  assert.equal(fileNames.length, 12);
  for (const name of fileNames) {
    assert.ok(name.endsWith(".json"), `unexpected non-json file: ${name}`);
  }
});

const loaded = fileNames.map((name) => {
  const raw = readFileSync(new URL(`../config/departments/${name}`, import.meta.url), "utf8");
  try {
    return { name, data: JSON.parse(raw), parseError: null };
  } catch (err) {
    return { name, data: null, parseError: err };
  }
});

test("every department file parses as JSON", () => {
  assert.equal(loaded.length, 12);
  for (const { name, data, parseError } of loaded) {
    assert.equal(parseError, null, `${name} must parse as JSON: ${parseError && parseError.message}`);
    assert.equal(typeof data, "object", `${name} must be a JSON object`);
    assert.notEqual(data, null, `${name} must not be null`);
    assert.ok(!Array.isArray(data), `${name} must be a JSON object`);
  }
});

const parsed = loaded.filter(({ data }) => data !== null);

test("every department has the required keys", () => {
  for (const { name, data } of parsed) {
    for (const key of REQUIRED_KEYS) {
      assert.ok(Object.prototype.hasOwnProperty.call(data, key), `${name} missing key: ${key}`);
    }
    assert.equal(typeof data.id, "string", `${name}: id must be a string`);
    assert.equal(typeof data.name, "string", `${name}: name must be a string`);
    assert.equal(typeof data.mission, "string", `${name}: mission must be a string`);
    assert.equal(typeof data.budget, "object", `${name}: budget must be an object`);
    assert.ok(data.budget !== null && !Array.isArray(data.budget), `${name}: budget must be an object`);
    assert.ok(Array.isArray(data.roles), `${name}: roles must be an array`);
  }
});

test("department ids are unique", () => {
  const ids = parsed.map(({ data }) => data.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate department ids found");
});

test("default_model_tier is valid", () => {
  for (const { name, data } of parsed) {
    assert.ok(VALID_TIERS.has(data.default_model_tier), `${name}: invalid tier ${data.default_model_tier}`);
  }
});

test("budget values are positive integers", () => {
  for (const { name, data } of parsed) {
    const { token_budget: tokenBudget, max_parallel: maxParallel } = data.budget;
    assert.ok(Number.isInteger(tokenBudget), `${name}: token_budget must be an integer`);
    assert.ok(tokenBudget > 0, `${name}: token_budget must be positive`);
    assert.ok(Number.isInteger(maxParallel), `${name}: max_parallel must be an integer`);
    assert.ok(maxParallel > 0, `${name}: max_parallel must be positive`);
  }
});

test("each department has exactly 5 roles", () => {
  for (const { name, data } of parsed) {
    assert.equal(data.roles.length, 5, `${name}: roles must contain exactly 5 entries`);
    for (const role of data.roles) {
      assert.equal(typeof role, "string", `${name}: role ids must be strings`);
    }
  }
});
