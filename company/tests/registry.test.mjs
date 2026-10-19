import { test } from "node:test";
import assert from "node:assert/strict";

import { MODEL_TIERS, PERMISSION_PROFILES } from "../src/types.mjs";
import {
  EXPECTED_DEPARTMENTS,
  EXPECTED_ROLES,
  validateDepartment,
  validateRegistry,
  validateRole,
} from "../src/registry.mjs";

/** Build a valid synthetic registry: EXPECTED_DEPARTMENTS x 5 roles. */
function buildRegistry() {
  const departments = [];
  const roles = [];
  for (let d = 1; d <= EXPECTED_DEPARTMENTS; d += 1) {
    const deptId = `dept-${d}`;
    const deptRoleIds = [];
    for (let r = 1; r <= 5; r += 1) {
      const roleId = `${deptId}.role-${r}`;
      deptRoleIds.push(roleId);
      roles.push({
        id: roleId,
        department: deptId,
        title: `Role ${r} of ${deptId}`,
        persona_ref: `prompts/roles/${roleId}.md`,
        model_tier: MODEL_TIERS[(d + r) % MODEL_TIERS.length],
        tools: ["read", "grep", "glob"],
        permission_profile: PERMISSION_PROFILES[(d + r) % PERMISSION_PROFILES.length],
        max_parallel: 2,
        token_budget: 10_000,
        approval_required_for: ["bash"],
        inputs: ["task brief"],
        outputs: ["status report"],
      });
    }
    departments.push({
      id: deptId,
      name: `Department ${d}`,
      mission: `Mission statement for department ${d}.`,
      default_model_tier: MODEL_TIERS[d % MODEL_TIERS.length],
      budget: { token_budget: 100_000, max_parallel: 8 },
      roles: deptRoleIds,
    });
  }
  return { departments, roles };
}

const clone = (value) => structuredClone(value);

test("fixture sanity: 12 departments and 60 roles", () => {
  const registry = buildRegistry();
  assert.equal(registry.departments.length, EXPECTED_DEPARTMENTS);
  assert.equal(registry.roles.length, EXPECTED_ROLES);
});

test("valid synthetic registry passes with zero errors", () => {
  assert.deepEqual(validateRegistry(buildRegistry()), []);
});

test("validateDepartment accepts a valid department", () => {
  const registry = buildRegistry();
  assert.deepEqual(validateDepartment(registry.departments[0]), []);
});

test("validateRole accepts a valid role", () => {
  const registry = buildRegistry();
  assert.deepEqual(validateRole(registry.roles[0]), []);
});

test("missing required field reports an error", () => {
  const registry = buildRegistry();
  delete registry.roles[0].title;
  const errors = validateRegistry(registry);
  assert.ok(errors.length > 0, "expected at least one error");
  assert.ok(
    errors.some((e) => e.includes('"title"')),
    `expected an error mentioning "title", got: ${errors.join(" | ")}`,
  );
});

test("bad model_tier reports an error", () => {
  const registry = buildRegistry();
  registry.roles[0].model_tier = "quantum";
  const errors = validateRegistry(registry);
  assert.ok(
    errors.some((e) => e.includes("model_tier") && e.includes("quantum")),
    `expected a model_tier error, got: ${errors.join(" | ")}`,
  );
});

test("duplicate role id reports an error", () => {
  const registry = buildRegistry();
  registry.roles[1].id = registry.roles[0].id;
  const errors = validateRegistry(registry);
  assert.ok(
    errors.some((e) => e.includes("duplicate role id")),
    `expected a duplicate role id error, got: ${errors.join(" | ")}`,
  );
});

test("duplicate department id reports an error", () => {
  const registry = buildRegistry();
  registry.departments[1].id = registry.departments[0].id;
  const errors = validateRegistry(registry);
  assert.ok(
    errors.some((e) => e.includes("duplicate department id")),
    `expected a duplicate department id error, got: ${errors.join(" | ")}`,
  );
});

test("role.department with no matching department reports an error", () => {
  const registry = buildRegistry();
  registry.roles[0].department = "ghost-dept";
  const errors = validateRegistry(registry);
  assert.ok(
    errors.some((e) => e.includes('"ghost-dept"') && e.includes("does not match")),
    `expected an unknown department error, got: ${errors.join(" | ")}`,
  );
});

test("department listing a role owned by another department reports an error", () => {
  const registry = buildRegistry();
  // dept-2 lists dept-1's first role instead of its own.
  registry.departments[1].roles[0] = registry.departments[0].roles[0];
  const errors = validateRegistry(registry);
  assert.ok(
    errors.some((e) => e.includes("belongs to")),
    `expected a cross-department listing error, got: ${errors.join(" | ")}`,
  );
});

test("role not listed by any department reports an error", () => {
  const registry = buildRegistry();
  const orphanId = registry.departments[0].roles[0];
  registry.departments[0].roles[0] = registry.departments[0].roles[1];
  const errors = validateRegistry(registry);
  assert.ok(
    errors.some((e) => e.includes(orphanId) && e.includes("not listed")),
    `expected a not-listed error for ${orphanId}, got: ${errors.join(" | ")}`,
  );
});

test("wrong department count reports an error", () => {
  const registry = buildRegistry();
  registry.departments.pop();
  const errors = validateRegistry(registry);
  assert.ok(
    errors.some(
      (e) =>
        e.includes(`expected exactly ${EXPECTED_DEPARTMENTS} departments`) &&
        e.includes(`got ${EXPECTED_DEPARTMENTS - 1}`),
    ),
    `expected a department count error, got: ${errors.join(" | ")}`,
  );
});

test("wrong role count reports an error", () => {
  const registry = buildRegistry();
  registry.roles.pop();
  const errors = validateRegistry(registry);
  assert.ok(
    errors.some(
      (e) =>
        e.includes(`expected exactly ${EXPECTED_ROLES} roles`) &&
        e.includes(`got ${EXPECTED_ROLES - 1}`),
    ),
    `expected a role count error, got: ${errors.join(" | ")}`,
  );
});

test("department listing the wrong number of roles reports an error", () => {
  const registry = buildRegistry();
  registry.departments[0].roles.pop();
  const errors = validateRegistry(registry);
  assert.ok(
    errors.some((e) => e.includes("exactly 5 roles")),
    `expected an exact-5 roles error, got: ${errors.join(" | ")}`,
  );
});

test("persona_ref mismatch with id reports an error", () => {
  const registry = buildRegistry();
  registry.roles[0].persona_ref = "prompts/roles/someone-else.md";
  const errors = validateRegistry(registry);
  assert.ok(
    errors.some((e) => e.includes("persona_ref") && e.includes("someone-else.md")),
    `expected a persona_ref error, got: ${errors.join(" | ")}`,
  );
});

test("invalid budget and tool values report errors", () => {
  const registry = buildRegistry();
  registry.departments[0].budget.token_budget = 0;
  registry.roles[0].tools = ["read", "rm-rf"];
  const errors = validateRegistry(registry);
  assert.ok(
    errors.some((e) => e.includes("token_budget")),
    `expected a budget error, got: ${errors.join(" | ")}`,
  );
  assert.ok(
    errors.some((e) => e.includes("rm-rf")),
    `expected a tools error, got: ${errors.join(" | ")}`,
  );
});

test("clone of a valid registry stays valid (mutation isolation)", () => {
  const registry = buildRegistry();
  const copy = clone(registry);
  registry.roles[0].model_tier = "not-a-tier";
  assert.deepEqual(validateRegistry(copy), []);
  assert.ok(validateRegistry(registry).length > 0);
});
