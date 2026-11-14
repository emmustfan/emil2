import { expect, test, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { getDb } from "../../lib/db";
import { currentLegal } from "../../lib/auth/legal";
import { hashToken, newToken } from "../../lib/auth/crypto";
import {
  createLessonFixture,
  cleanupLessonFixture,
  type LessonFixture,
} from "../helpers/lesson-fixture";

const db = getDb(),
  users: string[] = [],
  extra: BrowserContext[] = [];
let fixture: LessonFixture;
test.setTimeout(90000);
test.beforeEach(async () => {
  fixture = await createLessonFixture("course-map-browser");
  const min = await db.subject.aggregate({ _min: { order: true } });
  await db.subject.update({
    where: { id: fixture.subject.id },
    data: { order: (min._min.order ?? 0) - 1 },
  });
});
test.afterEach(async ({ context }) => {
  const anonIds = new Set<string>();
  for (const browser of [context, ...extra]) {
    for (const cookie of await browser.cookies())
      if (["lesson_guest", "demo_sid"].includes(cookie.name))
        anonIds.add(hashToken(cookie.value));
    for (const page of browser.pages()) await page.close();
  }
  for (const browser of extra.splice(0)) await browser.close();
  const demos = await db.demoSession.findMany({
    where: {
      userId: null,
      OR: [{ subjectId: fixture.subject.id }, { anonId: { in: [...anonIds] } }],
    },
    select: { id: true },
  });
  await cleanupLessonFixture(
    fixture,
    demos.map((demo) => demo.id),
    users.splice(0),
  );
});
test.afterAll(async () => {
  await db.$disconnect();
});
async function signIn(context: BrowserContext) {
  const legal = await currentLegal(),
    user = await db.user.create({
      data: {
        email: `course-map-browser-${randomUUID()}@example.test`,
        name: "Проверка карты",
        role: "USER",
        emailVerifiedAt: new Date(),
        consentPdAt: new Date(),
        consentPdVersion: legal.consent.version,
        offerVersion: legal.offer.version,
      },
    }),
    token = newToken();
  users.push(user.id);
  await db.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  await context.addCookies([
    {
      name: "sid",
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
for (const route of ["/", "/student"]) {
  test(`teeth open their lessons directly from ${route} and preserve paid access checks`, async ({
    page,
    context,
  }, info) => {
    if (route === "/student") await signIn(context);
    const freePath = `/learn/${fixture.subject.slug}/free`,
      paidPath = `/learn/${fixture.subject.slug}/paid`;
    await page.goto(route);
    const map = page.getByRole("region", { name: "Карта тем курса" });
    await expect(
      map.getByText("Пока без урока", { exact: true }),
    ).toBeVisible();
    const free = map.getByRole("link", {
      name: `Открыть урок 1: ${fixture.subject.title} — ${fixture.free.title}`,
      exact: true,
    });
    await expect(free).toHaveAttribute("href", freePath);
    await mkdir("tmp/screenshots", { recursive: true });
    await map.screenshot({
      path: `tmp/screenshots/course-map-${route === "/" ? "landing" : "student"}-${info.project.name}.png`,
    });
    await free.click();
    await expect(page).toHaveURL(new RegExp(`${freePath}$`));
    await expect(
      page.getByRole("heading", { name: fixture.free.title, exact: true }),
    ).toBeVisible();
    await page.goto(route);
    const paid = map.getByRole("link", {
      name: `Открыть урок 2: ${fixture.subject.title} — ${fixture.paid.title}`,
      exact: true,
    });
    await paid.focus();
    await paid.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${paidPath}$`));
    await expect(
      page.getByRole("heading", { name: /^Откройте предмет/ }),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText(
      "ПЛАТНЫЙ_СЕКРЕТ_ТОЛЬКО_ПО_ДОСТУПУ",
    );
  });
}
test("tooth links open lessons when JavaScript is disabled", async ({
  browser,
  page,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: page.viewportSize()!,
  });
  extra.push(context);
  const nativePage = await context.newPage();
  await nativePage.goto("http://localhost:3100/");
  await nativePage
    .getByRole("region", { name: "Карта тем курса" })
    .getByRole("link", { name: new RegExp(fixture.free.title) })
    .click();
  await expect(nativePage).toHaveURL(
    new RegExp(`/learn/${fixture.subject.slug}/free$`),
  );
  await expect(
    nativePage.getByRole("heading", { name: fixture.free.title, exact: true }),
  ).toBeVisible();
});
