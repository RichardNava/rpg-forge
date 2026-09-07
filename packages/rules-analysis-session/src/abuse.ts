export interface VerificationRequestContext {
  clientIp?: string;
}

export type VerificationResult =
  { kind: "success" } | { kind: "failed" } | { kind: "unavailable" };

export interface HumanVerificationPort {
  verify(
    token: string,
    context: VerificationRequestContext,
  ): Promise<VerificationResult>;
}

export type RateLimitResult =
  { kind: "allowed" } | { kind: "denied" } | { kind: "unavailable" };

export interface RateLimitPort {
  consume(key: string): Promise<RateLimitResult>;
}
