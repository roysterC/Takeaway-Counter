"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { Bike, ClipboardList, LogIn, PhoneCall } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/dashboard/sidebar";
import { safeCallbackUrl } from "@/lib/safe-redirect";

/**
 * NextAuth puts a code in ?error=. "Something went wrong" for SessionRequired
 * tells someone whose session simply expired that the product is broken.
 */
const ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: "Invalid email or password.",
  SessionRequired: "Your session has expired. Please sign in again.",
  AccessDenied: "That account doesn't have access.",
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = safeCallbackUrl(searchParams.get("callbackUrl"));
  const urlError = searchParams.get("error");
  // The site's root is this page even when signed in, so someone already
  // signed in can carry on without typing their password again.
  const { data: session, status } = useSession();
  const signedInAs = status === "authenticated" ? session.user?.name || session.user?.email : null;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setError(null);
    const res = await signIn("credentials", { email: email.trim(), password, redirect: false });
    if (res?.error) {
      setError(res.code === "too_many_attempts" ? "Too many attempts. Wait 15 minutes, then try again." : "Invalid email or password.");
      setLoading(false);
      return;
    }
    router.push(callbackUrl);
    router.refresh();
  }

  const message = error || (urlError ? ERROR_MESSAGES[urlError] || "Something went wrong. Please try again." : null);

  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[1fr_minmax(0,560px)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <div aria-hidden className="pointer-events-none absolute -right-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-primary/30 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <BrandMark />
          <span className="font-heading text-lg font-semibold tracking-tight">Takeaway Counter</span>
        </div>
        <div className="relative max-w-md">
          <h2 className="font-heading text-4xl font-semibold leading-[1.15]">Every phone order, straight to the counter.</h2>
          <ul className="mt-10 space-y-5 text-sidebar-foreground/85">
            {[
              { icon: PhoneCall, text: "The phone answered and the order taken, every time it rings" },
              { icon: ClipboardList, text: "Orders on one live board, from new to out the door" },
              { icon: Bike, text: "Regulars remembered: name, address and their usual" },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span className="text-[0.95rem]">{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-sidebar-foreground/50">Takeaway Counter</p>
      </aside>

      <main className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3">
            <BrandMark />
            <div className="min-w-0">
              <h1 className="font-heading text-xl font-semibold">Welcome back</h1>
              <p className="text-sm text-muted-foreground">Sign in to see tonight&apos;s orders</p>
            </div>
          </div>
          {signedInAs && (
            <div className="mb-6 rounded-lg border bg-card p-3 text-sm">
              <p className="text-muted-foreground">
                You&apos;re signed in as <span className="font-medium text-foreground">{signedInAs}</span>.
              </p>
              <Button type="button" variant="outline" className="mt-2 w-full" onClick={() => router.push(callbackUrl)}>
                Continue as {signedInAs}
              </Button>
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                disabled={loading}
                aria-invalid={message ? true : undefined}
                className="mt-1.5 h-10"
              />
            </div>
            <div>
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                aria-invalid={message ? true : undefined}
                className="mt-1.5 h-10"
              />
            </div>
            {message && (
              <p role="alert" className="text-xs text-red-600">
                {message}
              </p>
            )}
            <Button type="submit" disabled={loading} className="h-10 w-full">
              <LogIn className="mr-2 h-4 w-4" />
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
