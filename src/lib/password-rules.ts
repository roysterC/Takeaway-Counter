/**
 * What makes a password acceptable. Kept apart from password.ts so the
 * change-password dialog can check as you type without bundling bcrypt into
 * the browser.
 */

export function validatePassword(plain: string): string | null {
  if (!plain || plain.length < 8) {
    return "Password must be at least 8 characters";
  }
  return null;
}

/** Why a change from `current` to `next` can't go ahead, or null when it can. */
export function passwordChangeProblem(current: string, next: string): string | null {
  if (!current) return "Enter your current password.";
  const weak = validatePassword(next);
  if (weak) return weak;
  if (current === next) return "The new password must be different from the current one.";
  return null;
}
