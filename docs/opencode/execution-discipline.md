# Execution Discipline

## Efficient execution and verification discipline

Agents must optimize for evidence, not for repeatedly rerunning expensive commands.

### Development test cadence

Use three levels of verification:

```text
while implementing
→ smallest targeted test that proves the changed behavior

when the feature slice is functionally complete
→ relevant package/app suite

only at final milestone closure
→ full repository quality matrix ONCE
```

Do not repeatedly run the full test/typecheck/lint/build/E2E matrix after each
small correction.

### Diagnose before rerunning

When a test fails:

1. read the complete failure;
2. inspect the relevant implementation;
3. inspect existing Playwright trace/error-context/test artifacts;
4. determine whether the defect is production-side or test-side;
5. only then edit and rerun the smallest relevant test.

Do not classify a failure as "flaky", "timing-related" or "slow CI" merely
because it involves browser interaction.

If the same assertion fails repeatedly in the same way, treat it as a
deterministic defect until evidence proves otherwise.

Do not fix deterministic failures by:
- adding arbitrary sleeps;
- increasing timeouts without evidence;
- weakening assertions;
- replacing a real E2E interaction with direct function calls.

### Verify that targeted commands are actually targeted

After invoking a filtered test command, inspect the runner output.

Example:

```text
Expected:
Running 1 test

Unexpected:
Running 4 tests
```

If the supposedly targeted command executes the entire suite, STOP and correct
the command before rerunning it.

For Playwright in the Web workspace prefer direct execution:

```bash
pnpm --filter web exec playwright test e2e/<file>.spec.ts --grep "<test>" --reporter=line
```

Do not blindly pass options through:

```bash
pnpm --filter web test:e2e -- --grep ...
```

because package-script forwarding may change the resulting CLI arguments.

### Avoid shell pipelines while diagnosing tests

Prefer the runner's own filtering/reporting options.

Avoid commands such as:

```bash
... 2>&1 | grep ...
... 2>&1 | tail ...
```

for long-running Playwright/build diagnostics unless there is a specific
reason.

Pipelines can:
- hide the real failure;
- obscure exit behavior;
- buffer output;
- make tool execution appear stuck.

### Browser/E2E cost awareness

Starting Playwright may rebuild and start Next.js.

Therefore:

- do not use E2E as the inner development loop;
- prove interaction math/domain behavior first with unit/RTL tests;
- run the targeted browser scenario only after the implementation is plausible;
- after a fix, one targeted pass is normally enough;
- for previously flaky/high-risk interaction, two consecutive targeted passes
  are sufficient before the final suite;
- run the complete E2E suite once at final validation.

### Formatting discipline

Functional correctness comes before formatting.

During implementation:

- format only files actually modified by the task;
- never run `prettier --write .`;
- do not repeatedly run repo-wide `format:check`;
- do not format temporary/debug artifacts that will be deleted.

At closure:

1. remove unreferenced debug artifacts;
2. run targeted Prettier on changed production/test/docs files;
3. run the repository format check once;
4. report pre-existing untouched format debt separately.

### Debug artifact discipline

Temporary diagnostics must be clearly temporary.

Examples:

```text
*.html dumps
screenshots
traces
temporary logs
debug-only tests
console instrumentation
```

Before milestone completion:

- prove whether each artifact is referenced;
- delete unreferenced debug artifacts;
- convert useful diagnostic tests into properly named regression tests;
- leave no `TEMPORARY`, `DEBUG` or exploratory tests in the final suite.

Do not spend time formatting files that will be removed.

### Interrupted-session recovery

If OpenCode/tool execution fails with an infrastructure/tool error such as
"invalid parameters":

DO NOT immediately revert or restart the implementation.

First inspect:

```bash
git status --short --untracked-files=all
git diff --stat
git diff --name-status
git diff --cached --stat
git log -1 --oneline
```

If HEAD is correct and staged tree is empty:

- preserve the current worktree;
- start a fresh Build session if necessary;
- inventory existing work before editing;
- continue incrementally.

Never use destructive Git cleanup simply because an agent session failed.

### Preserve existing work

A new/recovered agent session must not rewrite a substantial implementation
from scratch merely because it did not create it.

Required sequence:

```text
inspect current diff
→ understand completed behavior
→ identify exact missing/broken behavior
→ make smallest coherent correction
```

### Final quality gates

Run expensive full gates only after known targeted blockers are resolved.

Recommended final order:

```text
targeted tests green
→ app/package tests
→ typecheck/lint
→ build
→ complete E2E
→ cross-package/root gates
→ format check
→ final Git audit
```

If a late gate reveals one isolated defect, return to the targeted test loop.
Do not automatically repeat every previously-green expensive gate until the
defect is corrected.

### Evidence over test counts

Do not optimize for keeping an arbitrary test count.

A suite with:

```text
4 meaningful acceptance tests
```

is preferable to:

```text
5 tests including one temporary diagnostic test
```

Completion is based on required behavior being proven, not on preserving a
previous numerical test count.
