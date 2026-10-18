import { describe, expect, it } from "vitest";
import { hashPassword, passwordChangeProblem, validatePassword, verifyPassword } from "./password";

describe("password rules", () => {
  it("wants at least eight characters", () => {
    expect(validatePassword("short")).toBe("Password must be at least 8 characters");
    expect(validatePassword("long enough")).toBeNull();
  });

  it("needs the current password before changing it", () => {
    expect(passwordChangeProblem("", "a new password")).toBe("Enter your current password.");
  });

  it("refuses a new password that is too short", () => {
    expect(passwordChangeProblem("old password", "short")).toBe("Password must be at least 8 characters");
  });

  it("refuses a new password that is the same as the old one", () => {
    expect(passwordChangeProblem("same password", "same password")).toBe(
      "The new password must be different from the current one."
    );
    expect(passwordChangeProblem("old password", "new password")).toBeNull();
  });

  it("checks a password against its hash", async () => {
    const hash = await hashPassword("correct horse");
    expect(await verifyPassword("correct horse", hash)).toBe(true);
    expect(await verifyPassword("wrong horse", hash)).toBe(false);
  });
});
