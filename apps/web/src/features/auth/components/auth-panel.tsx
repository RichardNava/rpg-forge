"use client";

import { authClient } from "@/infrastructure/auth/auth-client";

export function AuthPanel() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) return null;

  if (session) {
    return (
      <form
        action={async () => {
          await authClient.signOut();
        }}
        className="flex items-center gap-3"
      >
        <span className="text-muted-foreground text-sm">
          {session.user.name}
        </span>
        <button className="rounded-md border px-3 py-2 text-sm" type="submit">
          Cerrar sesión
        </button>
      </form>
    );
  }

  return (
    <button
      className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium"
      onClick={() => authClient.signIn.social({ provider: "google" })}
      type="button"
    >
      Continuar con Google
    </button>
  );
}
