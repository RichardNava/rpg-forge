export type AuthEnvironment = {
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

export type AuthConfiguration = {
  secret: string;
  baseURL: string;
  googleClientId: string;
  googleClientSecret: string;
};

export function getAuthConfiguration(env: AuthEnvironment): AuthConfiguration {
  const {
    BETTER_AUTH_SECRET,
    BETTER_AUTH_URL,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
  } = env;

  if (
    !BETTER_AUTH_SECRET ||
    !BETTER_AUTH_URL ||
    !GOOGLE_CLIENT_ID ||
    !GOOGLE_CLIENT_SECRET
  ) {
    throw new Error(
      "Authentication is not configured. Set the required local secrets.",
    );
  }

  return {
    secret: BETTER_AUTH_SECRET,
    baseURL: BETTER_AUTH_URL,
    googleClientId: GOOGLE_CLIENT_ID,
    googleClientSecret: GOOGLE_CLIENT_SECRET,
  };
}
