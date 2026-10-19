/**
 * Registry loader and validator for the Jarvis company configuration.
 *
 * All validation functions return arrays of human readable error strings and
 * never throw for invalid data. Only the loaders (`loadDepartments` /
 * `loadRoles`) may throw, when a file cannot be read or parsed.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { MODEL_TIERS, PERMISSION_PROFILES } from "./types.mjs";

/** Number of departments the registry must contain. */
export const EXPECTED_DEPARTMENTS = 12;

/** Number of roles the registry must contain. */
export const EXPECTED_ROLES = 60;

/** Roles per department. */
const ROLES_PER_DEPARTMENT = 5;

/** Tools a role may reference. */
const ALLOWED_TOOLS = Object.freeze(["read", "grep", "glob", "edit", "bash", "webfetch"]);

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ROLE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInt(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

function loadJsonDir(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  return files.map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")));
}

/**
 * Read and parse every `*.json` file in `<configDir>/departments/`.
 * @param {string} configDir
 * @returns {import("./types.mjs").Department[]}
 */
export function loadDepartments(configDir) {
  return loadJsonDir(join(configDir, "departments"));
}

/**
 * Read and parse every `*.json` file in `<configDir>/roles/`.
 * @param {string} configDir
 * @returns {import("./types.mjs").Role[]}
 */
export function loadRoles(configDir) {
  return loadJsonDir(join(configDir, "roles"));
}

// ---------------------------------------------------------------------------
// Entity validation
// ---------------------------------------------------------------------------

/**
 * Validate a single department.
 * @param {unknown} dept
 * @returns {string[]} error messages (empty when valid)
 */
export function validateDepartment(dept) {
  const errors = [];
  if (dept === null || typeof dept !== "object" || Array.isArray(dept)) {
    return ["department must be an object"];
  }
  const label = isNonEmptyString(dept.id) ? `department "${dept.id}"` : "department";

  if (!isNonEmptyString(dept.id)) {
    errors.push(`${label}: missing or empty "id"`);
  } else if (!KEBAB.test(dept.id)) {
    errors.push(`${label}: "id" must be a non-empty kebab-case string, got "${dept.id}"`);
  }
  if (!isNonEmptyString(dept.name)) {
    errors.push(`${label}: missing or empty "name"`);
  }
  if (!isNonEmptyString(dept.mission)) {
    errors.push(`${label}: missing or empty "mission"`);
  }
  if (!isNonEmptyString(dept.default_model_tier)) {
    errors.push(`${label}: missing "default_model_tier"`);
  } else if (!MODEL_TIERS.includes(dept.default_model_tier)) {
    errors.push(
      `${label}: invalid "default_model_tier" "${dept.default_model_tier}" ` +
        `(expected one of ${MODEL_TIERS.join(", ")})`,
    );
  }

  const budget = dept.budget;
  if (budget === null || typeof budget !== "object" || Array.isArray(budget)) {
    errors.push(`${label}: "budget" must be an object with token_budget and max_parallel`);
  } else {
    if (!isPositiveInt(budget.token_budget)) {
      errors.push(`${label}: "budget.token_budget" must be a positive integer`);
    }
    if (!isPositiveInt(budget.max_parallel)) {
      errors.push(`${label}: "budget.max_parallel" must be a positive integer`);
    }
  }

  if (!Array.isArray(dept.roles)) {
    errors.push(`${label}: "roles" must be an array of ${ROLES_PER_DEPARTMENT} strings`);
  } else if (dept.roles.length !== ROLES_PER_DEPARTMENT) {
    errors.push(
      `${label}: "roles" must list exactly ${ROLES_PER_DEPARTMENT} roles, got ${dept.roles.length}`,
    );
  } else {
    dept.roles.forEach((roleId, index) => {
      if (!isNonEmptyString(roleId)) {
        errors.push(`${label}: "roles[${index}]" must be a non-empty string`);
      }
    });
  }

  return errors;
}

/**
 * Validate a single role.
 * @param {unknown} role
 * @returns {string[]} error messages (empty when valid)
 */
export function validateRole(role) {
  const errors = [];
  if (role === null || typeof role !== "object" || Array.isArray(role)) {
    return ["role must be an object"];
  }
  const label = isNonEmptyString(role.id) ? `role "${role.id}"` : "role";

  if (!isNonEmptyString(role.id)) {
    errors.push(`${label}: missing or empty "id"`);
  } else if (!ROLE_ID.test(role.id)) {
    errors.push(
      `${label}: "id" must be of the form "<department>.<role-name>", got "${role.id}"`,
    );
  }

  if (!isNonEmptyString(role.department)) {
    errors.push(`${label}: missing or empty "department"`);
  }
  if (!isNonEmptyString(role.title)) {
    errors.push(`${label}: missing or empty "title"`);
  }

  const expectedPersona = isNonEmptyString(role.id) ? `prompts/roles/${role.id}.md` : null;
  if (typeof role.persona_ref !== "string") {
    errors.push(`${label}: missing "persona_ref"`);
  } else if (expectedPersona !== null && role.persona_ref !== expectedPersona) {
    errors.push(
      `${label}: "persona_ref" must be "${expectedPersona}", got "${role.persona_ref}"`,
    );
  }

  if (!isNonEmptyString(role.model_tier)) {
    errors.push(`${label}: missing "model_tier"`);
  } else if (!MODEL_TIERS.includes(role.model_tier)) {
    errors.push(
      `${label}: invalid "model_tier" "${role.model_tier}" ` +
        `(expected one of ${MODEL_TIERS.join(", ")})`,
    );
  }

  if (!Array.isArray(role.tools)) {
    errors.push(`${label}: "tools" must be an array of strings`);
  } else {
    role.tools.forEach((tool, index) => {
      if (typeof tool !== "string") {
        errors.push(`${label}: "tools[${index}]" must be a string`);
      } else if (!ALLOWED_TOOLS.includes(tool)) {
        errors.push(
          `${label}: "tools[${index}]" value "${tool}" is not allowed ` +
            `(allowed: ${ALLOWED_TOOLS.join(", ")})`,
        );
      }
    });
  }

  if (!isNonEmptyString(role.permission_profile)) {
    errors.push(`${label}: missing "permission_profile"`);
  } else if (!PERMISSION_PROFILES.includes(role.permission_profile)) {
    errors.push(
      `${label}: invalid "permission_profile" "${role.permission_profile}" ` +
        `(expected one of ${PERMISSION_PROFILES.join(", ")})`,
    );
  }

  if (!isPositiveInt(role.max_parallel)) {
    errors.push(`${label}: "max_parallel" must be a positive integer`);
  }
  if (!isPositiveInt(role.token_budget)) {
    errors.push(`${label}: "token_budget" must be a positive integer`);
  }

  for (const key of ["approval_required_for", "inputs", "outputs"]) {
    if (!isStringArray(role[key])) {
      errors.push(`${label}: "${key}" must be an array of strings`);
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Registry validation
// ---------------------------------------------------------------------------

function duplicateValues(values) {
  const seen = new Set();
  const dups = new Set();
  for (const value of values) {
    if (seen.has(value)) dups.add(value);
    seen.add(value);
  }
  return [...dups];
}

/**
 * Validate a whole registry, including referential integrity.
 * @param {{ departments?: unknown, roles?: unknown }} registry
 * @param {{ baseDir?: string }} [opts] When `baseDir` is set, every
 *   `role.persona_ref` file must exist under it.
 * @returns {string[]} error messages (empty when valid)
 */
export function validateRegistry(registry, opts = {}) {
  const errors = [];
  const { departments, roles } =
    registry && typeof registry === "object" ? registry : {};

  if (!Array.isArray(departments)) {
    errors.push('"departments" must be an array');
  }
  if (!Array.isArray(roles)) {
    errors.push('"roles" must be an array');
  }
  if (!Array.isArray(departments) || !Array.isArray(roles)) return errors;

  if (departments.length !== EXPECTED_DEPARTMENTS) {
    errors.push(
      `expected exactly ${EXPECTED_DEPARTMENTS} departments, got ${departments.length}`,
    );
  }
  if (roles.length !== EXPECTED_ROLES) {
    errors.push(`expected exactly ${EXPECTED_ROLES} roles, got ${roles.length}`);
  }

  departments.forEach((dept, index) => {
    for (const message of validateDepartment(dept)) {
      errors.push(`departments[${index}]: ${message}`);
    }
  });
  roles.forEach((role, index) => {
    for (const message of validateRole(role)) {
      errors.push(`roles[${index}]: ${message}`);
    }
  });

  const departmentIds = departments
    .filter((dept) => dept && typeof dept === "object" && isNonEmptyString(dept.id))
    .map((dept) => dept.id);
  const roleIds = roles
    .filter((role) => role && typeof role === "object" && isNonEmptyString(role.id))
    .map((role) => role.id);
  const departmentIdSet = new Set(departmentIds);
  const roleIdSet = new Set(roleIds);

  for (const id of duplicateValues(departmentIds)) {
    errors.push(`duplicate department id "${id}"`);
  }
  for (const id of duplicateValues(roleIds)) {
    errors.push(`duplicate role id "${id}"`);
  }

  // Every role belongs to an existing department.
  for (const role of roles) {
    if (!role || typeof role !== "object" || !isNonEmptyString(role.department)) continue;
    if (!departmentIdSet.has(role.department)) {
      errors.push(
        `role "${role.id ?? "?"}": department "${role.department}" does not match any department id`,
      );
    }
  }

  // Department role listings must resolve and point back at the listing department.
  const listings = new Map(); // roleId -> [departmentId, ...]
  for (const dept of departments) {
    if (!dept || typeof dept !== "object" || !Array.isArray(dept.roles)) continue;
    for (const roleId of dept.roles) {
      if (!isNonEmptyString(roleId)) continue;
      if (!roleIdSet.has(roleId)) {
        errors.push(
          `department "${dept.id ?? "?"}": lists unknown role "${roleId}"`,
        );
        continue;
      }
      const role = roles.find((candidate) => candidate && candidate.id === roleId);
      if (role && role.department !== dept.id) {
        errors.push(
          `department "${dept.id ?? "?"}": lists role "${roleId}" but that role belongs to ` +
            `"${role.department}"`,
        );
      }
      if (!listings.has(roleId)) listings.set(roleId, []);
      listings.get(roleId).push(dept.id);
    }
  }

  // Every role must be listed by exactly one department.
  for (const roleId of roleIds) {
    const count = listings.get(roleId)?.length ?? 0;
    if (count === 0) {
      errors.push(`role "${roleId}" is not listed by any department`);
    } else if (count > 1) {
      errors.push(
        `role "${roleId}" is listed by ${count} departments: ${listings.get(roleId).join(", ")}`,
      );
    }
  }

  // Each department lists exactly 5 roles: enforced by validateDepartment
  // above (registry-level rule) plus the "listed by exactly one department"
  // rule, which together guarantee full, non-overlapping coverage.

  if (opts.baseDir) {
    for (const role of roles) {
      if (!role || typeof role !== "object" || typeof role.persona_ref !== "string") continue;
      if (!existsSync(join(opts.baseDir, role.persona_ref))) {
        errors.push(
          `role "${role.id ?? "?"}": persona file "${role.persona_ref}" not found under ${opts.baseDir}`,
        );
      }
    }
  }

  return errors;
}
