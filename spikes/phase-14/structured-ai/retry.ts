import { z } from "zod";

export type StructuredAttemptResult<T> =
  | {
      readonly status: "valid-first-try" | "valid-after-retry";
      readonly attempts: 1 | 2;
      readonly value: T;
    }
  | {
      readonly status: "failed";
      readonly attempts: 2;
      readonly errors: readonly string[];
    };

export async function runWithOneValidationRetry<T>(
  invoke: (prompt: string) => Promise<string>,
  prompt: string,
  schema: z.ZodType<T>,
): Promise<StructuredAttemptResult<T>> {
  const firstRaw = await invoke(prompt);
  const first = parseAndValidate(firstRaw, schema);
  if (first.success) {
    return { status: "valid-first-try", attempts: 1, value: first.value };
  }

  const retryPrompt = [
    prompt,
    "",
    "The previous response failed validation:",
    ...first.errors.map((error) => `- ${error}`),
    "Return only corrected JSON matching the schema.",
  ].join("\n");
  const secondRaw = await invoke(retryPrompt);
  const second = parseAndValidate(secondRaw, schema);
  if (second.success) {
    return { status: "valid-after-retry", attempts: 2, value: second.value };
  }

  return { status: "failed", attempts: 2, errors: second.errors };
}

function parseAndValidate<T>(
  raw: string,
  schema: z.ZodType<T>,
):
  | { readonly success: true; readonly value: T }
  | { readonly success: false; readonly errors: readonly string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { success: false, errors: ["Response is not valid JSON."] };
  }

  const result = schema.safeParse(parsed);
  if (result.success) {
    return { success: true, value: result.data };
  }

  return {
    success: false,
    errors: result.error.issues.map((issue) => {
      const path = issue.path.length === 0 ? "root" : issue.path.join(".");
      return `${path}: ${issue.message}`;
    }),
  };
}
