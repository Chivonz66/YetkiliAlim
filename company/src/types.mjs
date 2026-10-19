/**
 * @typedef {Object} Department
 * @property {string} id Non-empty kebab-case identifier (e.g. "platform-engineering").
 * @property {string} name Human readable department name.
 * @property {string} mission One sentence mission statement.
 * @property {"fast"|"smart"|"code"|"vision"} default_model_tier Default model tier for department roles.
 * @property {{ token_budget: number, max_parallel: number }} budget Department level budget.
 * @property {string[]} roles Exactly 5 role ids owned by this department.
 */

/**
 * @typedef {Object} Role
 * @property {string} id Formatted as `<department>.<role-name>`.
 * @property {string} department Owning department id.
 * @property {string} title Human readable role title.
 * @property {string} persona_ref Must equal `prompts/roles/<id>.md`.
 * @property {"fast"|"smart"|"code"|"vision"} model_tier Model tier for this role.
 * @property {string[]} tools Subset of allowed tools.
 * @property {"read-only"|"reviewer"|"engineer"|"ops"|"security"} permission_profile Permission profile name.
 * @property {number} max_parallel Positive integer concurrency limit.
 * @property {number} token_budget Positive integer token budget.
 * @property {string[]} approval_required_for Operations requiring human approval.
 * @property {string[]} inputs Named inputs consumed by the role.
 * @property {string[]} outputs Named outputs produced by the role.
 */

/**
 * @typedef {Object} Registry
 * @property {Department[]} departments All company departments.
 * @property {Role[]} roles All company roles.
 */

/**
 * @typedef {Object} ValidationError
 * @property {"department"|"role"|"registry"} scope Where the error was detected.
 * @property {string} [id] Identifier of the offending entity, when known.
 * @property {string} message Human readable description of the problem.
 * @property {string} path JSON-ish path to the offending field (e.g. `departments[0].budget`).
 */

/** Allowed model tiers. */
export const MODEL_TIERS = Object.freeze(["fast", "smart", "code", "vision"]);

/** Allowed permission profiles. */
export const PERMISSION_PROFILES = Object.freeze([
  "read-only",
  "reviewer",
  "engineer",
  "ops",
  "security",
]);
