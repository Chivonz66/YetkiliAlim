/**
 * Integration validation over the real data on disk.
 *
 * Unlike registry.test.mjs (which uses synthetic fixtures), this suite loads
 * the actual department/role JSON, the actual persona markdown files and the
 * actual model-tier mapping, then validates them end to end.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  loadDepartments,
  loadRoles,
  validateRegistry,
  EXPECTED_DEPARTMENTS,
  EXPECTED_ROLES,
} from "../src/registry.mjs";

/** The `company/` directory (parent of `tests/`). */
const baseDir = fileURLToPath(new URL("../", import.meta.url));
const configDir = join(baseDir, "config");

const departments = loadDepartments(configDir);
const roles = loadRoles(configDir);

test("real data: loads 12 departments and 60 roles", () => {
  assert.equal(
    departments.length,
    EXPECTED_DEPARTMENTS,
    `expected ${EXPECTED_DEPARTMENTS} departments, got ${departments.length}`,
  );
  assert.equal(
    roles.length,
    EXPECTED_ROLES,
    `expected ${EXPECTED_ROLES} roles, got ${roles.length}`,
  );
});

test("real data: validateRegistry returns no errors", () => {
  const errors = validateRegistry({ departments, roles }, { baseDir });
  assert.deepEqual(
    errors,
    [],
    `validateRegistry reported ${errors.length} error(s):\n${errors.join("\n")}`,
  );
});

test("real data: every role's persona_ref file exists on disk", () => {
  const missing = roles
    .filter((role) => !existsSync(join(baseDir, role.persona_ref)))
    .map((role) => `${role.id} -> ${role.persona_ref}`);
  assert.deepEqual(
    missing,
    [],
    `missing persona file(s):\n${missing.join("\n")}`,
  );
});

test("real data: referential integrity (independent of the validator)", () => {
  const departmentIds = new Set(departments.map((dept) => dept.id));

  // 1. Every role points at a known department.
  const unknownDepartments = roles
    .filter((role) => !departmentIds.has(role.department))
    .map((role) => `${role.id} -> ${role.department}`);
  assert.deepEqual(
    unknownDepartments,
    [],
    `role(s) reference unknown department(s):\n${unknownDepartments.join("\n")}`,
  );

  // 2. Concatenating all department role listings covers every role exactly once.
  const listedRoleIds = departments.flatMap((dept) => dept.roles);
  assert.equal(
    listedRoleIds.length,
    EXPECTED_ROLES,
    `expected ${EXPECTED_ROLES} listed role ids across departments, got ${listedRoleIds.length}`,
  );

  const seen = new Set();
  const duplicates = new Set();
  for (const id of listedRoleIds) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  assert.deepEqual(
    [...duplicates],
    [],
    `duplicate role id(s) in department listings: ${[...duplicates].join(", ")}`,
  );

  // 3. Every role id appears exactly once across all departments.
  const roleIds = new Set(roles.map((role) => role.id));
  const unlisted = roles
    .filter((role) => !seen.has(role.id))
    .map((role) => role.id);
  assert.deepEqual(
    unlisted,
    [],
    `role id(s) never listed by any department: ${unlisted.join(", ")}`,
  );
  const unknownListings = [...seen].filter((id) => !roleIds.has(id));
  assert.deepEqual(
    unknownListings,
    [],
    `department listing(s) reference unknown role id(s): ${unknownListings.join(", ")}`,
  );
});

test("models.json: tier mapping has fast/smart/code/vision with string provider and model", () => {
  const modelsPath = join(configDir, "models.json");
  assert.ok(
    existsSync(modelsPath),
    `expected ${modelsPath} to exist`,
  );
  const models = JSON.parse(readFileSync(modelsPath, "utf8"));

  assert.ok(
    models.tiers && typeof models.tiers === "object" && !Array.isArray(models.tiers),
    "models.json must contain a \"tiers\" object",
  );
  assert.deepEqual(
    Object.keys(models.tiers).sort(),
    ["code", "fast", "smart", "vision"],
    "tiers must contain exactly the keys fast, smart, code, vision",
  );

  for (const [tierName, tier] of Object.entries(models.tiers)) {
    assert.equal(
      typeof tier.provider,
      "string",
      `tier "${tierName}" must have a string "provider" property`,
    );
    assert.equal(
      typeof tier.model,
      "string",
      `tier "${tierName}" must have a string "model" property`,
    );
  }
});
