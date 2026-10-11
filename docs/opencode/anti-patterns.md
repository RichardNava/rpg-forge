# OpenCode Anti-Patterns

This document records execution patterns that have already caused wasted time,
false confidence, or unnecessary implementation churn in this repository.

These rules are mandatory.

The purpose is not to prohibit investigation. The purpose is to prevent an
agent from turning one unresolved issue into an unbounded execution loop.

## 1. Never test until green

Do not repeatedly execute the same unchanged test hoping to obtain a passing
run.

Forbidden pattern:

```text
test fails
→ rerun
→ rerun
→ one pass
→ rerun until two consecutive passes
```

A passing execution after repeated failures does not prove correctness.
It is evidence of nondeterminism.

After the same targeted test fails twice without a relevant implementation or
test change, STOP unless a new run is required by a specific diagnostic
hypothesis.

No new evidence means no new execution.

## 2. A retry is not a diagnosis

Do not use repeated execution to investigate a failure.

Before another run, there must be a concrete hypothesis such as:

- a specific event is not awaited;
- a particular state transition has not completed;
- a locator points at the wrong element;
- a mutation has not reached the authoritative store;
- measured geometry is stale.

The next execution must test that hypothesis.

"Maybe it passes this time" is not a hypothesis.

## 3. Flaky is an observation, not a root cause

A test that sometimes passes and sometimes fails may be described as
nondeterministic.

Do not claim that it is:

- a browser problem;
- a CI problem;
- a test-environment problem;
- a timing problem;
- a production race;

without evidence that distinguishes those causes.

Finding both a pass and a failure does not explain why either occurred.

## 4. Do not game acceptance criteria

Never replace a rejected technique with another construct that preserves the
same bad behavior merely to satisfy wording.

Examples:

```text
waitForTimeout(200)
→ waitForTimeout(50)

waitForTimeout(...)
→ expect.poll(() => true)

fixed sleep
→ unrelated waitForLoadState()

repeat failures
→ keep running until two passes occur
```

These are not fixes.

Satisfy the engineering intent, not the literal shape of the instruction.

## 5. Fixed waits are suspicious, not automatically a crisis

Prefer synchronization against observable application state.

Examples:

- authoritative state changed;
- element reached the expected value;
- save status settled;
- mutation response completed;
- geometry changed;
- UI became enabled/disabled.

However, removing an existing fixed wait is not worth an unbounded
investigation.

If removing it exposes an unresolved synchronization problem:

1. investigate with a bounded effort;
2. make at most the targeted executions justified by concrete hypotheses;
3. if the correct synchronization cannot be established within task scope,
   STOP and report the blocker.

Do not spend hours removing a test-only delay while product work is blocked.

An existing fixed wait may remain temporarily when explicitly accepted by the
user/project reviewer as technical test debt.

## 6. Do not oscillate between implementations

Forbidden pattern:

```text
remove code
→ test fails
→ restore code
→ test
→ remove code again
→ test
→ restore code again
```

Once evidence shows that a decision requires architectural or reviewer input,
preserve the safest known state and escalate.

Do not repeatedly toggle the same implementation while waiting for the same
evidence to change.

## 7. Stop when the task boundary is reached

If the correct fix appears to require work explicitly outside the current
scope, STOP.

Example:

```text
task allows test cleanup only
+
reliable fix appears to require production synchronization changes
=
STOP and report
```

Do not silently expand the task.

Do not spend hours searching for a workaround merely to avoid reporting a
blocker.

## 8. Audit findings are not permission for infinite remediation

When ChatGPT/review identifies a bad practice, OpenCode should make a bounded
attempt to correct it.

If that correction reveals a deeper problem, return evidence to the reviewer.

Responsibility split:

```text
ChatGPT / user
→ architecture, acceptance decisions, exceptions, scope

OpenCode
→ implementation, targeted verification, evidence gathering
```

OpenCode must not reinterpret project policy through repeated experimentation.

## 9. Required blocker report

When stopping because a requested correction cannot be completed safely,
report only the useful evidence:

- requested behavior;
- exact failing assertion or operation;
- last relevant command;
- deterministic or nondeterministic observation;
- concrete hypotheses already tested;
- current safest working state;
- whether production changes appear necessary;
- files currently modified.

Then STOP.

Do not continue testing while waiting for a decision.

## 10. Execution budget

For one unresolved targeted blocker:

```text
first run
→ establish failure

diagnostic change based on evidence
→ second run

still unresolved
→ inspect evidence and STOP / escalate
```

Further executions require a materially new hypothesis.

Never perform an open-ended sequence of "one more run".

## Core rule

```text
Evidence must change before execution repeats.
```

If nothing changed in the hypothesis, implementation, fixture, environment or
observable being tested, do not run the same test again.