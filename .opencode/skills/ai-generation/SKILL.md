---
name: ai-generation
description: Implement or modify text/image generation features through the project's provider-agnostic AI ports, structured schemas, editable outputs, anti-abuse boundaries, and fake-provider tests.
compatibility: opencode
metadata:
  project: rpg-project
  scope: ai-feature-workflow
---

# AI Generation

Use for adventure, NPC, scenario, character-sheet, map, or future generation behavior.

Do not use this skill to introduce RAG, lore ingestion, embeddings, or campaign context unless the current phase explicitly authorizes them.

## 1. Identify the generated domain object

Do not begin with a provider response format.

Begin with the product result.

Examples:

```text
AdventureDraft
NpcDraft
CharacterSheetDraft
GeneratedMap
```

For structured text, define the minimum stable application shape needed for:

- editing;
- preview;
- Markdown/PDF export;
- future persistence without requiring it now.

Avoid storing one opaque HTML document.

## 2. Define input validation

Create/reuse a Zod schema for user-controlled generation parameters.

Validate at the server boundary even if the browser already validated the form.

Set explicit constraints for:

- lengths;
- arrays;
- enums;
- free-text prompt additions;
- numeric ranges.

Do not pass unlimited user text to the provider.

## 3. Depend on a project-owned port

Feature/application code depends on:

```text
TextGenerationPort
ImageGenerationPort
```

or the existing equivalent.

It must not import the Workers AI SDK/binding directly.

Correct:

```text
feature use case
→ TextGenerationPort
→ Cloudflare adapter
→ Workers AI
```

Incorrect:

```text
feature use case
→ env.AI.run(...)
```

## 4. Keep model selection out of the feature

Provider/model belongs to configuration/infrastructure.

Use configured model identifiers.

Changing the text or image model should not require editing the adventure/NPC/map feature.

## 5. Prompt construction

Prompts belong to the feature.

A good prompt separates:

```text
stable role/task instruction
output contract
product constraints
user parameters
optional free text
```

Do not interpolate unvalidated user content into instructions that alter system-level behavior.

Treat user-supplied text as data/content.

For one-shots, preserve the project meaning:

> a short adventure designed to begin and end in one play session.

## 6. Structured text results

Prefer structured output compatible with the domain object.

Validate provider output before accepting it.

If parsing/validation fails:

1. translate the failure into an application-level generation error;
2. optionally perform a bounded repair/retry if the approved provider pattern supports it;
3. never silently pass malformed data into the UI.

Do not expose raw provider exceptions to users.

## 7. Image generation

For generated maps:

- the feature requests an image through `ImageGenerationPort`;
- the adapter handles Workers AI details;
- MVP output is returned to the browser for preview/download;
- generation alone does not create a permanent R2 resource.

Using a generated map in The Table later is an explicit temporary-storage operation, not automatic library persistence.

## 8. Editability

Generation is not the final artifact.

Text generation flow:

```text
generate
→ validate
→ show structured editable draft
→ user edits
→ export
```

Do not require a second AI call for ordinary manual editing.

## 9. Error vocabulary

Translate provider failures into application errors such as the project equivalents of:

```text
ValidationError
RateLimitError
GenerationUnavailableError
GenerationQuotaExceededError
```

UI should not need knowledge of Cloudflare-specific exception shapes.

## 10. Abuse and quota boundary

Public/free AI is a scarce resource.

Before calling the provider, ensure the relevant implementation includes or is designed to include:

```text
schema validation
request size limits
bot protection / Turnstile where appropriate
rate/quota enforcement
timeout/cancellation
clean quota-exhaustion behavior
```

Do not log full guest prompts or generated content by default merely for observability.

## 11. Testing

Unit/application tests use fake providers.

Example behavior to prove:

```text
valid input invokes port once
structured response becomes editable draft
malformed provider output is rejected
provider quota error maps to application error
feature does not persist output automatically
```

Do not call real Workers AI in normal CI.

Real-model evaluation belongs to an explicit manual/integration workflow.

## 12. Security review triggers

Request `@security` review when changing:

- public generation endpoints;
- Turnstile/rate limiting;
- prompt/user-text handling;
- upload/context handling;
- provider secrets;
- persistence/logging of prompts or outputs.

## 13. Completion report

Report:

1. domain result shape;
2. schema/input constraints;
3. port/adapter used;
4. model/config changes;
5. error handling;
6. fake-provider tests;
7. abuse/security implications;
8. confirmation that persistence was not added implicitly.
