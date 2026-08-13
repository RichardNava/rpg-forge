import { AuthPanel } from "@/features/auth/components/auth-panel";

export default function SignInPage() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <section className="bg-card w-full max-w-md rounded-xl border p-8 shadow-sm">
        <p className="text-muted-foreground text-sm font-medium">RPG Forge</p>
        <h1 className="mt-2 text-2xl font-semibold">
          Inicia sesión para usar La Mesa
        </h1>
        <p className="text-muted-foreground mt-3 text-sm">
          Los generadores siguen disponibles sin cuenta.
        </p>
        <div className="mt-6">
          <AuthPanel />
        </div>
      </section>
    </main>
  );
}
