# 07 — Two-Stage Sheet Generation Reliability (Spike C.4)

**Spike:** Phase 14.0
**Date:** 2026-08-17
**Status:** Complete — pending human sheet model decision
**Decision required:** SHEET_GENERATION_MODEL selection or alternative approach

---

## Executive Summary

Two-stage decomposition (SheetPlan → CharacterSheetSpec) was tested to determine if structural planning improves sheet generation reliability. Both Llama 3.1 8B and Llama 3.3 70B were compared.

**Key findings:**

| Metric                    | Llama 3.1 8B | Llama 3.3 70B |
| ------------------------- | ------------ | ------------- |
| Stage 1 valid (SheetPlan) | 3/4          | **4/4**       |
| Stage 2 valid (final)     | 1/4          | 1/4           |
| **Final valid**           | **1/4**      | **1/4**       |

**Conclusion:** Two-stage decomposition does not meaningfully improve sheet generation reliability. The bottleneck is field generation, not structural planning.

**SHEET_GENERATION_MODEL:** UNSET — requires alternative approach or different model.

---

## 1. Test Configuration

### Models

| Model                                      | Parameters |
| ------------------------------------------ | ---------- |
| `@cf/meta/llama-3.1-8b-instruct-fast`      | 8B         |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | 70B        |

### Two-Stage Pipeline

```text
Stage 1: SheetPlan (structural scaffold)
  Input: User request + ruleset summary
  Output: mode, pages, sections (id + title), theme
  Schema: sheetPlanSchema (Zod 4)
  Constraint: response_format.json_schema

Stage 2: CharacterSheetSpec (complete sheet)
  Input: Validated SheetPlan + user request
  Output: Full CharacterSheetSpec with fields
  Schema: characterSheetSpikeSpecSchema (Zod 4)
  Constraint: response_format.json_schema
  Post-validation: Domain invariants (referential integrity)
```

### Test Cases

| Case             | Category      | Language | Description                            |
| ---------------- | ------------- | -------- | -------------------------------------- |
| player-simple-en | player-simple | EN       | Simple one-page player sheet           |
| player-simple-es | player-simple | ES       | Simple one-page player sheet (Spanish) |
| npc-complex-en   | npc-complex   | EN       | Two-page NPC sheet (shopkeeper)        |
| npc-complex-es   | npc-complex   | ES       | Two-page NPC sheet (Spanish)           |

---

## 2. Results

### Llama 3.1 8B

| Case             | Stage 1                  | Stage 2              | Final | Latency |
| ---------------- | ------------------------ | -------------------- | ----- | ------- |
| player-simple-en | ✓                        | ✓                    | ✓     | 3258ms  |
| player-simple-es | ✗ (duplicate section ID) | —                    | ✗     | 1070ms  |
| npc-complex-en   | ✓                        | ✗ (JSON parse error) | ✗     | 2751ms  |
| npc-complex-es   | ✓                        | ✗ (JSON parse error) | ✗     | 2497ms  |

**Summary:**

- Stage 1 valid: 3/4
- Stage 2 valid: 1/4
- Final valid: 1/4
- Avg latency: 2394ms
- Remote ops: 7

### Llama 3.3 70B

| Case             | Stage 1 | Stage 2              | Final | Latency |
| ---------------- | ------- | -------------------- | ----- | ------- |
| player-simple-en | ✓       | ✓                    | ✓     | 28611ms |
| player-simple-es | ✓       | ✗ (JSON parse error) | ✗     | 16192ms |
| npc-complex-en   | ✓       | ✗ (empty fieldIds)   | ✗     | 51414ms |
| npc-complex-es   | ✓       | ✗ (empty fieldIds)   | ✗     | 34747ms |

**Summary:**

- Stage 1 valid: 4/4
- Stage 2 valid: 1/4
- Final valid: 1/4
- Avg latency: 32741ms
- Remote ops: 8

---

## 3. Comparison with One-Shot

| Model         | One-Shot | Two-Stage | Delta |
| ------------- | -------- | --------- | ----- |
| Llama 3.1 8B  | 0/4      | 1/4       | +1    |
| Llama 3.3 70B | 1/4      | 1/4       | +0    |

**Observation:** Two-stage decomposition improved Llama 3.1 8B from 0/4 to 1/4, but did not improve Llama 3.3 70B (remained 1/4). The improvement is marginal and inconsistent.

---

## 4. Failure Analysis

### Stage 1 Failures

| Model        | Case             | Failure                                    |
| ------------ | ---------------- | ------------------------------------------ |
| Llama 3.1 8B | player-simple-es | Duplicate section ID ("statsCombat" twice) |

Stage 1 was highly reliable: 7/8 total attempts passed (87.5%). The simpler schema (no fields, no field-to-section cross-references) is significantly easier for both models.

### Stage 2 Failures

| Model         | Case             | Failure Type                                 |
| ------------- | ---------------- | -------------------------------------------- |
| Llama 3.1 8B  | npc-complex-en   | JSON parse error (incomplete output)         |
| Llama 3.1 8B  | npc-complex-es   | JSON parse error (incomplete output)         |
| Llama 3.3 70B | player-simple-es | JSON parse error (incomplete output)         |
| Llama 3.3 70B | npc-complex-en   | Empty fieldIds arrays (violates minItems: 1) |
| Llama 3.3 70B | npc-complex-es   | Empty fieldIds arrays (violates minItems: 1) |

**Root cause:** The bottleneck is field generation, not structural planning.

- **Llama 3.1 8B** produces incomplete/malformed JSON for complex sheets (NPC cases).
- **Llama 3.3 70B** produces valid JSON but with empty `fieldIds` arrays, violating the schema constraint.

The structural scaffold from Stage 1 does not help models generate correct fields or populate section→field relationships.

---

## 5. Domain Invariant Analysis

For the single successful case (player-simple-en, both models):

| Invariant                      | Result |
| ------------------------------ | ------ |
| mode valid                     | ✓      |
| pages defined                  | ✓      |
| sections defined               | ✓      |
| fields defined                 | ✓      |
| theme defined                  | ✓      |
| section→field references valid | ✓      |
| page→section references valid  | ✓      |

Both models produced correct domain invariants when Stage 2 succeeded.

---

## 6. Latency Comparison

| Model         | One-Shot Avg | Two-Stage Avg | Overhead                                  |
| ------------- | ------------ | ------------- | ----------------------------------------- |
| Llama 3.1 8B  | 2930ms       | 2394ms        | -18% (faster due to simpler prompts)      |
| Llama 3.3 70B | 18875ms      | 32741ms       | +73% (slower due to two sequential calls) |

**Observation:** Two-stage decomposition adds significant latency for Llama 3.3 70B (73% increase) with no reliability improvement.

---

## 7. Remote Operations

| Model         | One-Shot | Two-Stage | Overhead |
| ------------- | -------- | --------- | -------- |
| Llama 3.1 8B  | 6        | 7         | +1       |
| Llama 3.3 70B | 6        | 8         | +2       |

Two-stage uses more remote operations due to the additional Stage 1 call for each test case.

---

## 8. Conclusion

### Two-stage decomposition does not solve sheet generation reliability

**Evidence:**

1. **Stage 1 is easy; Stage 2 is hard.** Both models achieve high Stage 1 validity (87.5% overall), but Stage 2 remains the bottleneck (25% overall).

2. **Structural scaffold doesn't help field generation.** The validated SheetPlan provides page/section structure, but models still fail to generate correct fields or populate section→field relationships.

3. **Failure modes are different:**
   - 8B: JSON parse errors (incomplete output for complex cases)
   - 70B: Empty fieldIds arrays (valid JSON, invalid schema)

4. **Latency overhead is significant.** Two-stage adds 73% latency for 70B with no reliability gain.

5. **Remote operations increase.** Two-stage uses 33% more operations.

### SHEET_GENERATION_MODEL Decision

**UNSET** — Neither model demonstrates acceptable CharacterSheetSpec reliability with two-stage decomposition.

**Options for human consideration:**

1. **Different model** — A model not yet tested (e.g., Qwen3-30B-a3b-fp8, GLM-4.7-flash) may have better sheet generation capabilities.

2. **Different decomposition** — More stages (e.g., 3-stage: plan → fields → assembly) or different intermediate contracts.

3. **Fewer constraints** — Relax schema constraints (e.g., allow empty fieldIds, reduce field requirements).

4. **Template-based approach** — Pre-defined section/field templates that the model populates rather than generates from scratch.

5. **Leave unset** — Accept that sheet generation requires human authoring or a different AI approach.

---

## 9. Files in This Spike

```
structured-ai/
  sheet-plan-schema.ts                  — SheetPlan Zod 4 schema
  sheet-plan-json-schema.json           — Generated JSON Schema for SheetPlan

scripts/
  generate-sheet-plan-schema.ts         — JSON Schema generation script
  run-two-stage-sheet-benchmark.ts      — This benchmark

07-two-stage-sheet-generation.md       — This report
```

---

SPIKE C.4 COMPLETE — PENDING HUMAN SHEET MODEL DECISION
