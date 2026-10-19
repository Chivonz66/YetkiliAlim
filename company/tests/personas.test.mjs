import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const rolesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "prompts", "roles");

// Bu test bilinçli olarak src/registry.mjs veya config/roles okumaz;
// beklenen 60 rol kimliği doğrudan gömülüdür (veri testi).
const expectedIds = [
  "management.product-owner",
  "management.program-manager",
  "management.business-analyst",
  "management.requirements-engineer",
  "management.stakeholder-liaison",
  "architecture.chief-architect",
  "architecture.systems-architect",
  "architecture.software-architect",
  "architecture.data-architect",
  "architecture.integration-architect",
  "analysis.functional-analyst",
  "analysis.technical-analyst",
  "analysis.ux-researcher",
  "analysis.ui-designer",
  "analysis.systems-analyst",
  "backend.senior-backend",
  "backend.backend-engineer",
  "backend.api-engineer",
  "backend.service-engineer",
  "backend.performance-engineer",
  "frontend.senior-frontend",
  "frontend.frontend-engineer",
  "frontend.ui-engineer",
  "frontend.accessibility-specialist",
  "frontend.design-system-engineer",
  "data.data-engineer",
  "data.dba",
  "data.data-modeler",
  "data.etl-engineer",
  "data.data-quality-analyst",
  "ai.ml-engineer",
  "ai.prompt-engineer",
  "ai.data-scientist",
  "ai.model-evaluator",
  "ai.retrieval-engineer",
  "devops.devops-engineer",
  "devops.ci-cd-engineer",
  "devops.release-engineer",
  "devops.infrastructure-engineer",
  "devops.container-engineer",
  "qa.qa-lead",
  "qa.test-automation-engineer",
  "qa.manual-tester",
  "qa.performance-tester",
  "qa.regression-analyst",
  "security.security-architect",
  "security.appsec-engineer",
  "security.compliance-officer",
  "security.secrets-manager",
  "security.threat-modeler",
  "docs.technical-writer",
  "docs.api-docs-specialist",
  "docs.integration-engineer",
  "docs.developer-advocate",
  "docs.kb-editor",
  "ops.sre",
  "ops.observability-engineer",
  "ops.incident-manager",
  "ops.support-engineer",
  "ops.continuous-improvement-analyst",
];

test("exactly 60 persona .md files exist", () => {
  const files = readdirSync(rolesDir).filter((f) => f.endsWith(".md"));
  assert.equal(files.length, 60);
  assert.equal(expectedIds.length, 60);
});

test("filename stems exactly match the 60 expected ids", () => {
  const stems = readdirSync(rolesDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3))
    .sort();
  assert.deepEqual(stems, [...expectedIds].sort());
});

test("every persona file is non-empty (>120 bytes)", () => {
  for (const id of expectedIds) {
    const size = statSync(join(rolesDir, `${id}.md`)).size;
    assert.ok(size > 120, `${id}.md is only ${size} bytes`);
  }
});

test("every persona has an H1 title and contains its role id", () => {
  for (const id of expectedIds) {
    const content = readFileSync(join(rolesDir, `${id}.md`), "utf8");
    const lines = content.split(/\r?\n/);
    assert.ok(
      lines.some((line) => line.startsWith("# ")),
      `${id}.md has no '# ' heading line`
    );
    assert.ok(
      lines.some((line) => line.includes(id)),
      `${id}.md does not mention its role id`
    );
  }
});

test("every persona has a '## Çalışma kuralları' section", () => {
  for (const id of expectedIds) {
    const content = readFileSync(join(rolesDir, `${id}.md`), "utf8");
    assert.ok(
      content.includes("## Çalışma kuralları"),
      `${id}.md lacks '## Çalışma kuralları' section`
    );
  }
});
