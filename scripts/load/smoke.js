import http from "k6/http";
import { check, sleep } from "k6";
export const options = {
  scenarios: {
    browsing: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "15s", target: 50 },
        { duration: "20s", target: 300 },
        { duration: __ENV.HOLD || "30s", target: 300 },
        { duration: "10s", target: 0 },
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    checks: ["rate>0.99"],
    "http_req_duration{kind:page}": ["p(95)<2500"],
    "http_req_duration{kind:api}": ["p(95)<300"],
  },
};
const origin = __ENV.BASE_URL || "http://localhost:3200";
if (
  !__ENV.LESSON_PATH ||
  !/^\/learn\/[a-z0-9-]+\/[a-z0-9-]+$/.test(__ENV.LESSON_PATH)
)
  throw new Error("Set LESSON_PATH to a synthetic free published lesson");
export function setup() {
  const r = http.get(`${origin}/api/health`, { timeout: "10s" });
  if (r.status !== 200)
    throw new Error("Load target is not ready; virtual users were not started");
}
export default function browse() {
  const landing = http.get(`${origin}/`, {
    tags: { kind: "page" },
    timeout: "15s",
  });
  check(landing, {
    "landing 200": (r) => r.status === 200,
    "HTML in Russian": (r) => (r.body || "").includes('lang="ru"'),
  });
  const lesson = http.get(`${origin}${__ENV.LESSON_PATH}`, {
    tags: { kind: "page" },
    timeout: "15s",
  });
  check(lesson, {
    "lesson 200": (r) => r.status === 200,
    "no answer fields": (r) => !(r.body || "").includes('"correctOptionIds"'),
  });
  const health = http.get(`${origin}/api/health`, {
    tags: { kind: "api" },
    timeout: "5s",
  });
  check(health, { "database ready": (r) => r.status === 200 });
  sleep(Number(__ENV.THINK_SECONDS || 5));
}
