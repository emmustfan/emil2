import { describe, expect, it } from "vitest";
import { firstTouch, readTouch } from "../../lib/analytics/identity";
import { diagnosticSummary, actionSchema, readFlow } from "../../lib/demo/flow";
import { publicExamples } from "../../lib/landing/content";
import { LANDING_DEFAULTS } from "../../lib/landing/defaults";
import { eventSchemas } from "../../lib/analytics/events";
describe("demo boundaries and attribution", () => {
  it("retains only campaign keys and external hostname, removing tokens and personal URLs", () => {
    const touch = firstTouch(
      new URL(
        "https://school.test/?utm_source=search&utm_campaign=autumn&utm_term=user%40mail.ru&token=SECRET&name=Student",
      ),
      "https://search.test/private/user?email=personal@example.test",
    );
    expect(touch).toEqual({
      utm_source: "search",
      utm_campaign: "autumn",
      referrer: "search.test",
    });
    expect(
      firstTouch(
        new URL("https://school.test/"),
        "https://school.test/login?token=SECRET",
      ),
    ).toEqual({});
    expect(readTouch('{"token":"SECRET"}')).toEqual({});
    expect(readTouch("malformed")).toEqual({});
  });
  it("summarizes exactly the diagnostic attempts, without generating medical advice", () => {
    expect(
      diagnosticSummary([
        { topicId: "one", isCorrect: true },
        { topicId: "two", isCorrect: false },
        { topicId: "three", isCorrect: true },
      ]),
    ).toEqual({
      correct: 2,
      strongTopicIds: ["one", "three"],
      weakTopicIds: ["two"],
    });
  });
  it("rejects forged workflow ownership and oversized custom goals", () => {
    expect(
      actionSchema.safeParse({
        action: "goal",
        goal: "other",
        text: "x".repeat(201),
      }).success,
    ).toBe(false);
    expect(
      actionSchema.safeParse({
        action: "subject",
        subjectId: "s",
        userId: "forged",
      }).success,
    ).toBe(false);
    expect(
      actionSchema.safeParse({ action: "rate", cardId: "c", rating: "FORGED" })
        .success,
    ).toBe(false);
    expect(readFlow(null)).toEqual({
      skip: false,
      questions: [],
      cardIds: [],
      revealed: [],
      rated: [],
    });
  });
  it("publishes example options with no answer keys or explanation before submitting", () => {
    const publicData = publicExamples(LANDING_DEFAULTS);
    expect(publicData).toHaveLength(2);
    const json = JSON.stringify(publicData);
    for (const key of ["correctOptionIds", "acceptedAnswers", "explanation"])
      expect(json).not.toContain(key);
  });
  it("allows only structured anonymous analytics properties", () => {
    expect(
      eventSchemas.demo_started.safeParse({
        source: "landing",
        email: "person@example.test",
      }).success,
    ).toBe(false);
    expect(
      eventSchemas.diagnostic_completed.safeParse({ correct: 4 }).success,
    ).toBe(false);
    expect(
      eventSchemas.demo_goal_selected.safeParse({ goal: "personal text" })
        .success,
    ).toBe(false);
  });
});
