export class AuthenticationRequiredError extends Error {
  constructor() {
    super("A valid session is required.");
  }
}

export function requireSessionValue<T>(session: T | null): T {
  if (!session) throw new AuthenticationRequiredError();
  return session;
}
