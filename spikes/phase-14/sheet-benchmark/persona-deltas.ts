import type { SectionPlanOutput } from "@repo/character-sheet-generation";
import type {
  SheetGenerationPort,
  SheetGenerationStage,
} from "@repo/character-sheet-generation";
import {
  extractSectionKey,
  type SheetGenerationCallMetadata,
  type SheetGenerationPortWithMetadata,
} from "./harness.js";
import {
  getPersona,
  type BenchmarkPersona,
  type PersonaDeltaContext,
  type PersonaSlug,
} from "./personas.js";

export function applySystemPromptDelta(
  system: string,
  persona: BenchmarkPersona,
  ctx: PersonaDeltaContext,
): string {
  if (persona.systemPromptDelta === null) {
    return system;
  }
  return persona.systemPromptDelta(system, ctx);
}

export function applyUserPromptDelta(
  user: string,
  persona: BenchmarkPersona,
  ctx: PersonaDeltaContext,
): string {
  if (persona.userPromptDelta === null) {
    return user;
  }
  return persona.userPromptDelta(user, ctx);
}

export function applyReplayFeedbackDelta(
  feedback: string,
  persona: BenchmarkPersona,
  ctx: PersonaDeltaContext,
): string {
  if (persona.replayFeedbackDelta === null) {
    return feedback;
  }
  return persona.replayFeedbackDelta(feedback, ctx);
}

/**
 * Builds the anchor instruction that tells the model to keep the existing
 * section keys and only repair the failing fields. Returns null when the
 * persona does not anchor replays or there is no previous plan.
 */
export function buildAnchorInstruction(
  previousPlan: SectionPlanOutput | null,
  persona: BenchmarkPersona,
): string | null {
  if (!persona.anchorReplay || previousPlan === null) {
    return null;
  }
  const keys = previousPlan.sections.map((section) => section.key).join(", ");
  return (
    `IMPORTANT: The previous section plan had these keys in order: [${keys}]. ` +
    "Keep ALL of these section keys. Do NOT add, remove, or reorder sections. " +
    "Repair only the failing fields or titles."
  );
}

/**
 * Computes a repro metadata footer when the persona requests it.
 */
export function buildReproMetadata(
  persona: BenchmarkPersona,
  ctx: PersonaDeltaContext,
): string | null {
  if (!persona.trackReproMetadata) {
    return null;
  }
  return `[repro: fixture=${ctx.fixtureId} attempt=${ctx.attemptNumber} stage=section-plan]`;
}

/**
 * A port wrapper that applies persona prompt deltas before forwarding to the
 * inner port. Tracks previous plan state for anchored replays and counts
 * repeated violations for bounded abort.
 */
export class PersonaAwarePort implements SheetGenerationPort {
  private previousPlan: SectionPlanOutput | null = null;
  private readonly violationCounts = new Map<string, number>();

  constructor(
    private readonly inner: SheetGenerationPort,
    private readonly persona: BenchmarkPersona,
  ) {}

  setPreviousPlan(plan: SectionPlanOutput | null): void {
    this.previousPlan = plan;
  }

  getViolationCount(slot: string): number {
    return this.violationCounts.get(slot) ?? 0;
  }

  recordViolation(slot: string): number {
    const current = this.violationCounts.get(slot) ?? 0;
    const next = current + 1;
    this.violationCounts.set(slot, next);
    return next;
  }

  resetViolations(slot: string): void {
    this.violationCounts.delete(slot);
  }

  async generate(input: {
    stage: SheetGenerationStage;
    system: string;
    user: string;
  }): Promise<string> {
    let system = input.system;
    let user = input.user;

    const isReplay = user.includes("Validation feedback");
    const attemptNumber = isReplay ? 2 : 1;

    const ctx: PersonaDeltaContext = {
      fixtureId: "",
      language: "en",
      role: "player",
      injection: false,
      previousPlan: this.previousPlan,
      attemptNumber,
    };

    system = applySystemPromptDelta(system, this.persona, ctx);

    if (isReplay && this.persona.anchorReplay) {
      const anchor = buildAnchorInstruction(this.previousPlan, this.persona);
      if (anchor !== null) {
        user = user + "\n\n" + anchor;
      }
    }

    if (isReplay && this.persona.replayFeedbackDelta !== null) {
      user = applyReplayFeedbackDelta(user, this.persona, ctx);
    }

    const repro = buildReproMetadata(this.persona, ctx);
    if (repro !== null) {
      user = user + "\n\n" + repro;
    }

    user = applyUserPromptDelta(user, this.persona, ctx);

    return this.inner.generate({ stage: input.stage, system, user });
  }

  /**
   * Returns the metadata from the inner port if it supports it.
   */
  get lastMetadata(): SheetGenerationCallMetadata | null {
    const inner = this.inner as Partial<SheetGenerationPortWithMetadata>;
    return inner.lastMetadata ?? null;
  }
}

/**
 * When a persona with bounded abort is active, checks whether the repeated
 * violation threshold has been exceeded for the given slot.
 */
export function shouldAbort(
  persona: BenchmarkPersona,
  port: PersonaAwarePort,
  slot: string,
): boolean {
  if (persona.maxRepeatedViolations === null) {
    return false;
  }
  return port.getViolationCount(slot) >= persona.maxRepeatedViolations;
}
