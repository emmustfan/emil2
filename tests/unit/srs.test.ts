import { describe, it, expect } from "vitest";
import {
  schedule,
  type ScheduleCard,
  type ScheduleSettings,
} from "../../lib/srs/schedule";
import { dayWindow } from "../../lib/srs/day";
import { parseTopic } from "../../lib/content/parse";
import { gapContext } from "../../lib/srs/context";
import { reviewInput } from "../../lib/srs/http";
const settings: ScheduleSettings = {
  hardMinutes: 10,
  goodFirstDays: 1,
  easyFirstDays: 3,
  easeMin: 1.3,
  hardEasePenalty: 0.2,
  easyEaseGain: 0.15,
  easyBonus: 1.3,
  maxIntervalDays: 180,
};
const now = new Date("2026-11-07T12:00:00Z");
const fresh: ScheduleCard = {
  state: "NEW",
  ease: 2.5,
  intervalDays: 0,
  reps: 0,
  lapses: 0,
};
describe("pure SRS scheduling", () => {
  it("schedules a new card for 10 minutes, 1 day or 3 days", () => {
    expect(schedule(fresh, "HARD", now, settings)).toMatchObject({
      state: "LEARNING",
      intervalDays: 0,
      ease: 2.3,
      reps: 1,
      lapses: 0,
      dueAt: new Date("2026-11-07T12:10:00Z"),
    });
    expect(schedule(fresh, "GOOD", now, settings)).toMatchObject({
      state: "REVIEW",
      intervalDays: 1,
      ease: 2.5,
      dueAt: new Date("2026-11-08T12:00:00Z"),
    });
    expect(schedule(fresh, "EASY", now, settings)).toMatchObject({
      state: "REVIEW",
      intervalDays: 3,
      ease: 2.65,
      dueAt: new Date("2026-11-10T12:00:00Z"),
    });
  });
  it("records lapses only for REVIEW on Hard, without falling below minimum ease", () => {
    const reviewed = {
      ...fresh,
      state: "REVIEW" as const,
      ease: 1.35,
      intervalDays: 20,
      reps: 4,
      lapses: 2,
    };
    expect(schedule(reviewed, "HARD", now, settings)).toMatchObject({
      ease: 1.3,
      lapses: 3,
      reps: 5,
      intervalDays: 0,
      state: "LEARNING",
    });
    expect(
      schedule({ ...reviewed, state: "LEARNING" }, "HARD", now, settings)
        .lapses,
    ).toBe(2);
  });
  it("rounds intervals using the previous ease before adding the Easy bonus", () => {
    const card = {
      ...fresh,
      state: "REVIEW" as const,
      intervalDays: 3,
      ease: 2.5,
    };
    expect(schedule(card, "GOOD", now, settings).intervalDays).toBe(8);
    expect(schedule(card, "EASY", now, settings)).toMatchObject({
      intervalDays: 10,
      ease: 2.65,
    });
  });
  it("caps all day intervals and uses configured first intervals, penalties and gains", () => {
    const card = { ...fresh, intervalDays: 170, state: "REVIEW" as const };
    for (const rating of ["GOOD", "EASY"] as const)
      expect(schedule(card, rating, now, settings).intervalDays).toBe(180);
    expect(
      schedule(fresh, "EASY", now, { ...settings, maxIntervalDays: 2 })
        .intervalDays,
    ).toBe(2);
    expect(
      schedule(fresh, "GOOD", now, { ...settings, goodFirstDays: 2 })
        .intervalDays,
    ).toBe(2);
    expect(
      schedule(fresh, "HARD", now, {
        ...settings,
        hardMinutes: 5,
        hardEasePenalty: 0.4,
      }).dueAt,
    ).toEqual(new Date(now.getTime() + 300000));
    expect(
      schedule(fresh, "EASY", now, { ...settings, easyEaseGain: 0.25 }).ease,
    ).toBe(2.75);
  });
  it("treats sub-day learning intervals as first day intervals and never mutates inputs", () => {
    const card = { ...fresh, state: "LEARNING" as const, intervalDays: 0.5 };
    const before = JSON.stringify(card),
      date = now.getTime();
    expect(schedule(card, "GOOD", now, settings).intervalDays).toBe(1);
    expect(schedule(card, "EASY", now, settings).intervalDays).toBe(3);
    expect(JSON.stringify(card)).toBe(before);
    expect(now.getTime()).toBe(date);
  });
  it("rejects invalid numeric values rather than creating corrupt schedules", () => {
    expect(() =>
      schedule({ ...fresh, ease: NaN }, "GOOD", now, settings),
    ).toThrow();
    expect(() =>
      schedule(fresh, "GOOD", new Date("invalid"), settings),
    ).toThrow();
    expect(() =>
      schedule(fresh, "GOOD", now, { ...settings, hardMinutes: 0 }),
    ).toThrow();
  });
});
describe("daily introduction windows", () => {
  it("uses a user's local date rather than server UTC", () => {
    const w = dayWindow(new Date("2026-11-07T21:30:00Z"), "Asia/Yekaterinburg");
    expect(w.start.toISOString()).toBe("2026-11-07T19:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-11-08T19:00:00.000Z");
  });
  it("handles 23-hour and 25-hour daylight saving dates", () => {
    const spring = dayWindow(
        new Date("2026-03-08T16:00:00Z"),
        "America/New_York",
      ),
      fall = dayWindow(new Date("2026-11-01T16:00:00Z"), "America/New_York");
    expect(spring.end.getTime() - spring.start.getTime()).toBe(23 * 3600000);
    expect(fall.end.getTime() - fall.start.getTime()).toBe(25 * 3600000);
  });
  it("handles fractional-hour time zones and a safe fallback for invalid legacy values", () => {
    expect(dayWindow(now, "Asia/Kathmandu").start.toISOString()).toBe(
      "2026-11-06T18:15:00.000Z",
    );
    expect(dayWindow(now, "invalid").timeZone).toBe("Europe/Moscow");
  });
});
describe("review content and input boundaries", () => {
  it("fills only the reviewed gap without revealing or misplacing its neighbors", () => {
    const md = "Первый [[один|иной]], второй [[два|третий]].";
    const p = parseTopic(md);
    expect(gapContext(md, p.gaps[0].gapKey, "один")).toBe(
      "Первый один, второй ____.",
    );
    expect(gapContext(md, p.gaps[1].gapKey, "два")).toBe(
      "Первый ____, второй два.",
    );
  });
  it("distinguishes repeated sentence contexts with different answers", () => {
    const md = "- Выбор [[один|другое]]. Выбор [[два|третье]].";
    const p = parseTopic(md);
    expect(gapContext(md, p.gaps[1].gapKey, "два")).toBe("Выбор два.");
    expect(gapContext(md, "missing", "x")).toBeNull();
  });
  it("accepts explicit reveal/rate actions and rejects forged scheduling parameters", () => {
    expect(
      reviewInput.safeParse({ action: "reveal", revision: 0, topicVersion: 1 })
        .success,
    ).toBe(true);
    expect(
      reviewInput.safeParse({
        action: "rate",
        revision: 0,
        topicVersion: 1,
        rating: "HARD",
      }).success,
    ).toBe(true);
    for (const body of [
      {
        action: "rate",
        revision: 0,
        topicVersion: 1,
        rating: "GOOD",
        dueAt: "now",
      },
      { action: "reveal", revision: 0, topicVersion: 1, userId: "other" },
      { action: "rate", revision: 0, topicVersion: 1, rating: "FAKE" },
    ])
      expect(reviewInput.safeParse(body).success).toBe(false);
  });
});
