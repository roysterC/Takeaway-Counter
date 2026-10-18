/**
 * Change your own password: POST { currentPassword, newPassword }.
 *
 * Open to everyone signed in, counter staff included. The current password
 * must be right, and wrong guesses count against the same limit as the login
 * page, so a laptop left signed in at the counter can't be used to guess it.
 *
 * Saving raises the login's sessionVersion, which signs out every other
 * device on its next request (requireTenant compares the cookie's version
 * with the database). The dialog then signs this tab back in with the new
 * password, so the person changing it stays where they are.
 *
 * A wrong current password is a 400, not a 401: apiFetch treats every 401 as
 * "your session has gone" and sends the page to /login.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { hashPassword, passwordChangeProblem, verifyPassword } from "@/lib/password";
import { clientIp, loginThrottle } from "@/lib/login-throttle";

export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;
  if (ctx.userId === "dev-user") {
    return NextResponse.json({ error: "The dev login has no password to change." }, { status: 400 });
  }

  const body = ((await req.json().catch(() => null)) ?? {}) as { currentPassword?: unknown; newPassword?: unknown };
  const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const next = typeof body.newPassword === "string" ? body.newPassword : "";
  const problem = passwordChangeProblem(current, next);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { email: true, passwordHash: true },
  });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ip = clientIp(req.headers);
  if (!loginThrottle.allowed(user.email, ip)) {
    return NextResponse.json({ error: "Too many wrong passwords. Wait 15 minutes, then try again." }, { status: 429 });
  }
  const ok = Boolean(user.passwordHash) && (await verifyPassword(current, user.passwordHash!));
  if (!ok) {
    loginThrottle.fail(user.email, ip);
    return NextResponse.json({ error: "Your current password isn't right." }, { status: 400 });
  }
  loginThrottle.succeed(user.email);

  await prisma.user.update({
    where: { id: ctx.userId },
    data: { passwordHash: await hashPassword(next), sessionVersion: { increment: 1 } },
  });
  return NextResponse.json({ ok: true, email: user.email });
}
