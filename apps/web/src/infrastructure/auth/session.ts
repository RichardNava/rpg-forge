import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "./auth";
import {
  AuthenticationRequiredError,
  requireSessionValue,
} from "./session-guard";

export {
  AuthenticationRequiredError,
  requireSessionValue,
} from "./session-guard";

export async function getSession() {
  return getAuth().api.getSession({ headers: await headers() });
}

export async function requireSession() {
  try {
    return requireSessionValue(await getSession());
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    throw error;
  }
}
