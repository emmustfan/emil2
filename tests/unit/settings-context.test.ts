import { it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({ value: 3, cached: vi.fn() }));
vi.mock("../../lib/db", () => ({
  getDb: () => ({
    appSetting: {
      findMany: async () => [
        { key: "progress.inactiveDays", value: state.value },
      ],
    },
  }),
}));
vi.mock("next/cache.js", () => ({
  unstable_cache: (fn: () => Promise<unknown>) => async () => {
    state.cached();
    return fn();
  },
}));
import { getSetting, withSettingsSnapshot } from "../../lib/settings";
it("uses a database configuration snapshot for CLI domain services and isolates concurrent contexts from web caching", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = withSettingsSnapshot(async () => {
    const value = await getSetting("progress.inactiveDays");
    await gate;
    return [value, await getSetting("progress.inactiveDays")];
  });
  await Promise.resolve();
  state.value = 9;
  expect(
    await withSettingsSnapshot(() => getSetting("progress.inactiveDays")),
  ).toBe(9);
  release();
  expect(await first).toEqual([3, 3]);
  expect(state.cached).not.toHaveBeenCalled();
  expect(await getSetting("progress.inactiveDays")).toBe(9);
  expect(state.cached).toHaveBeenCalledOnce();
});
