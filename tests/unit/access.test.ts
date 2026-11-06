import { describe, expect, it, vi, beforeEach } from "vitest";
import { allowsAccess, type Entitlements } from "../../lib/access/policy";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  subscriptions: vi.fn(),
  grants: vi.fn(),
}));
vi.mock("../../lib/db", () => ({
  getDb: () => ({
    user: { findUnique: mocks.user },
    subscription: { findMany: mocks.subscriptions },
    accessGrant: { findMany: mocks.grants },
  }),
}));
vi.mock("../../lib/settings", () => ({ getSetting: async () => 3 }));
import { hasAccess } from "../../lib/access";
const now = new Date("2026-11-06T12:00:00Z"),
  topic = { subjectId: "dental", isFree: false };
function subscription(changes = {}) {
  return {
    status: "ACTIVE",
    subjectId: "dental",
    currentPeriodStart: new Date("2026-10-06"),
    currentPeriodEnd: new Date("2026-11-07"),
    plan: { kind: "SUBJECT" },
    ...changes,
  };
}
function check(rights: Partial<Entitlements>, isFree = false) {
  return allowsAccess(
    { ...topic, isFree },
    { subscriptions: [], grants: [], ...rights },
    now,
    3,
  );
}
describe("access policy", () => {
  it("opens free lessons and denies paid lessons without rights", () => {
    expect(check({}, true)).toBe(true);
    expect(check({})).toBe(false);
  });
  it("scopes active subscriptions to one subject or all subjects", () => {
    expect(check({ subscriptions: [subscription()] })).toBe(true);
    expect(
      check({ subscriptions: [subscription({ subjectId: "other" })] }),
    ).toBe(false);
    expect(
      check({
        subscriptions: [
          subscription({ subjectId: null, plan: { kind: "ALL_SUBJECTS" } }),
        ],
      }),
    ).toBe(true);
    expect(
      check({ subscriptions: [subscription({ plan: { kind: "FREE" } })] }),
    ).toBe(false);
  });
  it("uses an exclusive period end and rejects future and expired subscriptions", () => {
    expect(
      check({ subscriptions: [subscription({ currentPeriodEnd: now })] }),
    ).toBe(false);
    expect(
      check({ subscriptions: [subscription({ status: "EXPIRED" })] }),
    ).toBe(false);
    expect(
      check({
        subscriptions: [
          subscription({ currentPeriodStart: new Date("2026-11-07") }),
        ],
      }),
    ).toBe(false);
  });
  it("keeps PAST_DUE access for exactly the configured grace period", () => {
    expect(
      check({
        subscriptions: [
          subscription({
            status: "PAST_DUE",
            currentPeriodEnd: new Date(now.getTime() - 3 * 86400000 + 1),
          }),
        ],
      }),
    ).toBe(true);
    expect(
      check({
        subscriptions: [
          subscription({
            status: "PAST_DUE",
            currentPeriodEnd: new Date(now.getTime() - 3 * 86400000),
          }),
        ],
      }),
    ).toBe(false);
    expect(
      check({
        subscriptions: [
          subscription({ status: "PAST_DUE", subjectId: "other" }),
        ],
      }),
    ).toBe(false);
  });
  it("accepts live subject/all grants and rejects wrong scope and expiration", () => {
    const expiresAt = new Date(now.getTime() + 1);
    expect(check({ grants: [{ subjectId: topic.subjectId, expiresAt }] })).toBe(
      true,
    );
    expect(check({ grants: [{ subjectId: null, expiresAt }] })).toBe(true);
    expect(check({ grants: [{ subjectId: "other", expiresAt }] })).toBe(false);
    expect(check({ grants: [{ subjectId: null, expiresAt: now }] })).toBe(
      false,
    );
  });
});
describe("hasAccess account checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ blockedAt: null, deletedAt: null });
    mocks.subscriptions.mockResolvedValue([]);
    mocks.grants.mockResolvedValue([]);
  });
  it("serves free topics to guests and rejects paid guest access without querying user data", async () => {
    expect(await hasAccess(null, { ...topic, isFree: true })).toBe(true);
    expect(await hasAccess(null, topic)).toBe(false);
    expect(mocks.user).not.toHaveBeenCalled();
  });
  it("denies deleted, missing and blocked accounts even with a grant", async () => {
    mocks.grants.mockResolvedValue([
      { subjectId: null, expiresAt: new Date("2099-01-01") },
    ]);
    for (const value of [
      null,
      { blockedAt: now, deletedAt: null },
      { blockedAt: null, deletedAt: now },
    ]) {
      mocks.user.mockResolvedValue(value);
      expect(await hasAccess("u", topic)).toBe(false);
    }
    expect(mocks.grants).not.toHaveBeenCalled();
  });
  it("reads actual entitlements for a valid account", async () => {
    mocks.grants.mockResolvedValue([
      { subjectId: null, expiresAt: new Date("2099-01-01") },
    ]);
    expect(await hasAccess("u", topic)).toBe(true);
    expect(mocks.subscriptions).toHaveBeenCalled();
  });
});
