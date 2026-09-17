import { describe, expect, it } from "vitest";

import { safeReturnTo } from "@/lib/auth";

/*
 * `returnTo` survives a redirect through the provider, so it is the one piece
 * of sign-in state an attacker can choose. Anything that is not an in-app path
 * must land on the landing screen instead.
 */
describe("safeReturnTo", () => {
  it("keeps an in-app path, query and hash included", () => {
    expect(safeReturnTo("/pvp/ABC123?spectate=1#board")).toBe("/pvp/ABC123?spectate=1#board");
  });

  it("falls back to the landing screen when there is nothing to return to", () => {
    expect(safeReturnTo(null)).toBe("/");
    expect(safeReturnTo("")).toBe("/");
  });

  it("refuses anything that leaves the app", () => {
    // Protocol-relative: the browser reads this as a host, not a path.
    expect(safeReturnTo("//evil.example/pwn")).toBe("/");
    expect(safeReturnTo("https://evil.example")).toBe("/");
    expect(safeReturnTo("javascript:alert(1)")).toBe("/");
  });
});
