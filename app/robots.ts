import { canIndex, robotsFor } from "@/lib/ops/seo";
export const dynamic = "force-dynamic";
export default function robots() {
  return robotsFor(process.env.APP_URL ?? "http://localhost:3000", canIndex());
}
