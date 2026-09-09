/**
 * Shared failure type for the Workers AI-backed providers. The analysis domain
 * maps any throw from an AI port to RULES_CONTEXT_MODEL_UNAVAILABLE, so this
 * error exists to distinguish "provider down / malformed output" (transient,
 * retryable) from domain-level validation failures.
 */
export class AiProviderUnavailableError extends Error {
  constructor() {
    super("The AI provider is unavailable or returned malformed output.");
    this.name = "AiProviderUnavailableError";
  }
}
