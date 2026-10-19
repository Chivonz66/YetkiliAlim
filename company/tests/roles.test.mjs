// Self-contained data test for company/config/roles (task t4).
// Does NOT import src/registry.mjs — only node:test, node:assert/strict, node:fs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROLES_DIR = fileURLToPath(new URL("../config/roles", import.meta.url));

const ALLOWED_MODEL_TIERS = new Set(["fast", "smart", "code", "vision"]);
const ALLOWED_TOOLS = new Set(["read", "grep", "glob", "edit", "bash", "webfetch"]);
const ALLOWED_PERMISSION_PROFILES = new Set([
  "read-only",
  "reviewer",
  "engineer",
  "ops",
  "security",
]);
const REQUIRED_KEYS = [
  "id",
  "department",
  "title",
  "persona_ref",
  "model_tier",
  "tools",
  "permission_profile",
  "max_parallel",
  "token_budget",
  "approval_required_for",
  "inputs",
  "outputs",
];

const entries = readdirSync(ROLES_DIR, { withFileTypes: true });
const fileNames = entries.filter((e) => e.isFile()).map((e) => e.name);
const jsonNames = fileNames.filter((n) => n.endsWith(".json"));

const parsed = jsonNames.map((name) => {
  const raw = readFileSync(join(ROLES_DIR, name), "utf8");
  return { name, stem: name.slice(0, -".json".length), data: JSON.parse(raw) };
});

test("roles directory contains exactly 60 files", () => {
  assert.equal(entries.length, 60, `expected 60 directory entries, got ${entries.length}`);
  assert.equal(fileNames.length, 60, `expected 60 files, got ${fileNames.length}`);
  assert.equal(jsonNames.length, 60, `expected 60 .json files, got ${jsonNames.length}`);
});

test("every role file parses as JSON and is an object", () => {
  assert.equal(parsed.length, 60);
  for (const { name, data } of parsed) {
    assert.equal(typeof data, "object", `${name} is not an object`);
    assert.notEqual(data, null, `${name} parsed to null`);
    assert.equal(Array.isArray(data), false, `${name} is an array`);
  }
});

test("every role file has all required keys", () => {
  for (const { name, data } of parsed) {
    for (const key of REQUIRED_KEYS) {
      assert.ok(Object.prototype.hasOwnProperty.call(data, key), `${name} missing key "${key}"`);
    }
  }
});

test("id equals filename stem and department equals id prefix", () => {
  for (const { stem, data } of parsed) {
    assert.equal(data.id, stem, `id mismatch in ${stem}.json`);
    const prefix = String(data.id).split(".")[0];
    assert.equal(data.department, prefix, `department mismatch in ${stem}.json`);
  }
});

test("persona_ref points at prompts/roles/<id>.md", () => {
  for (const { data } of parsed) {
    assert.equal(data.persona_ref, `prompts/roles/${data.id}.md`);
  }
});

test("model_tier is in the allowed set", () => {
  for (const { name, data } of parsed) {
    assert.ok(
      ALLOWED_MODEL_TIERS.has(data.model_tier),
      `${name} has invalid model_tier "${data.model_tier}"`,
    );
  }
});

test("tools is a non-empty subset of the allowed tool set", () => {
  for (const { name, data } of parsed) {
    assert.ok(Array.isArray(data.tools), `${name} tools is not an array`);
    assert.ok(data.tools.length > 0, `${name} tools is empty`);
    for (const tool of data.tools) {
      assert.ok(ALLOWED_TOOLS.has(tool), `${name} has invalid tool "${tool}"`);
    }
    assert.equal(new Set(data.tools).size, data.tools.length, `${name} has duplicate tools`);
  }
});

test("permission_profile is in the allowed set", () => {
  for (const { name, data } of parsed) {
    assert.ok(
      ALLOWED_PERMISSION_PROFILES.has(data.permission_profile),
      `${name} has invalid permission_profile "${data.permission_profile}"`,
    );
  }
});

test("max_parallel and token_budget are positive integers", () => {
  for (const { name, data } of parsed) {
    assert.ok(
      Number.isInteger(data.max_parallel) && data.max_parallel > 0,
      `${name} max_parallel must be a positive integer`,
    );
    assert.ok(
      Number.isInteger(data.token_budget) && data.token_budget > 0,
      `${name} token_budget must be a positive integer`,
    );
    assert.ok(
      data.token_budget >= 60000 && data.token_budget <= 200000,
      `${name} token_budget must be between 60000 and 200000`,
    );
  }
});

test("approval_required_for, inputs and outputs are arrays", () => {
  for (const { name, data } of parsed) {
    assert.ok(Array.isArray(data.approval_required_for), `${name} approval_required_for not an array`);
    assert.ok(Array.isArray(data.inputs), `${name} inputs not an array`);
    assert.ok(Array.isArray(data.outputs), `${name} outputs not an array`);
    assert.ok(data.inputs.length >= 1 && data.inputs.length <= 3, `${name} inputs must have 1-3 items`);
    assert.ok(data.outputs.length >= 1 && data.outputs.length <= 3, `${name} outputs must have 1-3 items`);
    for (const list of [data.approval_required_for, data.inputs, data.outputs]) {
      for (const item of list) assert.equal(typeof item, "string", `${name} list item must be a string`);
    }
  }
});

test("all 60 expected role ids are present exactly once", () => {
  const departments = [
    "management",
    "architecture",
    "analysis",
    "backend",
    "frontend",
    "data",
    "ai",
    "devops",
    "qa",
    "security",
    "docs",
    "ops",
  ];
  const roleNames = {
    management: ["product-owner", "program-manager", "business-analyst", "requirements-engineer", "stakeholder-liaison"],
    architecture: ["chief-architect", "systems-architect", "software-architect", "data-architect", "integration-architect"],
    analysis: ["functional-analyst", "technical-analyst", "ux-researcher", "ui-designer", "systems-analyst"],
    backend: ["senior-backend", "backend-engineer", "api-engineer", "service-engineer", "performance-engineer"],
    frontend: ["senior-frontend", "frontend-engineer", "ui-engineer", "accessibility-specialist", "design-system-engineer"],
    data: ["data-engineer", "dba", "data-modeler", "etl-engineer", "data-quality-analyst"],
    ai: ["ml-engineer", "prompt-engineer", "data-scientist", "model-evaluator", "retrieval-engineer"],
    devops: ["devops-engineer", "ci-cd-engineer", "release-engineer", "infrastructure-engineer", "container-engineer"],
    qa: ["qa-lead", "test-automation-engineer", "manual-tester", "performance-tester", "regression-analyst"],
    security: ["security-architect", "appsec-engineer", "compliance-officer", "secrets-manager", "threat-modeler"],
    docs: ["technical-writer", "api-docs-specialist", "integration-engineer", "developer-advocate", "kb-editor"],
    ops: ["sre", "observability-engineer", "incident-manager", "support-engineer", "continuous-improvement-analyst"],
  };
  const expected = departments.flatMap((dept) => roleNames[dept].map((role) => `${dept}.${role}`));
  assert.equal(expected.length, 60);
  const actual = parsed.map((p) => p.stem).sort();
  assert.deepEqual(actual, [...expected].sort());
});
