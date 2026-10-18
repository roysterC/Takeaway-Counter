"use client";

/**
 * Change your own password. Saving signs out every other device; this tab is
 * signed straight back in with the new password so nobody is thrown out of
 * the page they were on.
 */

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDialogs } from "@/components/providers/dialogs-provider";
import { apiFetch, holdLoginRedirect } from "@/lib/api-fetch";
import { passwordChangeProblem } from "@/lib/password-rules";

const EMPTY = { current: "", next: "", again: "" };

export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { notify } = useDialogs();

  const close = () => {
    setForm(EMPTY);
    setError(null);
    onClose();
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = passwordChangeProblem(form.current, form.next) ?? (form.next !== form.again ? "The new passwords don't match." : null);
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    // From the moment the password is saved until this tab has its new
    // cookie, the board's polls are refused with the old one. That is not a
    // lost session; see holdLoginRedirect.
    holdLoginRedirect(30_000);
    try {
      const res = await apiFetch("/api/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: form.current, newPassword: form.next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        holdLoginRedirect(0);
        return setError(data?.error ?? "Couldn't change the password.");
      }
      const again = await signIn("credentials", { email: data.email, password: form.next, redirect: false });
      if (again?.error) {
        window.location.href = "/login";
        return;
      }
      // A poll sent just before the new cookie arrived can still come back refused.
      holdLoginRedirect(3_000);
      close();
      notify("Password changed. Any other devices have been signed out.");
    } catch {
      holdLoginRedirect(0);
      setError("Couldn't reach the server.");
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof typeof EMPTY, label: string, autoComplete: string) => (
    <label className="grid gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input
        type="password"
        autoComplete={autoComplete}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        disabled={saving}
      />
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && close()}>
      <DialogContent>
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>At least 8 characters. Any other devices signed in as you will be signed out.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {field("current", "Current password", "current-password")}
            {field("next", "New password", "new-password")}
            {field("again", "New password again", "new-password")}
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !form.current || !form.next || !form.again}>
              {saving ? "Saving…" : "Change password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
