import { NextRequest } from "next/server";
import { assertOrigin, readInput } from "@/lib/auth/http";
import { contentJSON, contentFailure } from "@/lib/content/http";
import { currentDemo } from "@/lib/demo/request";
import { demoView, demoAction } from "@/lib/demo/service";
import { actionSchema } from "@/lib/demo/flow";
export async function GET() {
  try {
    return contentJSON(await demoView((await currentDemo()).id));
  } catch (e) {
    return contentFailure(e);
  }
}
export async function POST(request: NextRequest) {
  try {
    assertOrigin(request);
    const input = actionSchema.parse(await readInput(request));
    return contentJSON(await demoAction((await currentDemo()).id, input));
  } catch (e) {
    return contentFailure(e);
  }
}
