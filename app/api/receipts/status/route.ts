import { privateModeEnabled } from "../privateMode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!privateModeEnabled()) return new Response("Not found", { status: 404 });
  return Response.json({ privateMode: true }, { headers: { "Cache-Control": "no-store" } });
}
