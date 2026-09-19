import { privateModeEnabled } from "./privateMode";
const privateHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: privateHeaders }); }
export async function handleReceiptInbox(request: Request, privateRoot?: string): Promise<Response> {
  // Public/Workers deployments never import or read the private filesystem.
  if (!privateModeEnabled()) return new Response("Not found", { status: 404, headers: privateHeaders });
  const url = new URL(request.url);
  if (!["GET", "POST", "PATCH"].includes(request.method)) return json({ error: "Method not allowed." }, 405);
  if (request.method !== "GET" && (request.headers.get("origin") !== url.origin || request.headers.get("x-receipt-request") !== "1")) return json({ error: "Receipt changes require a request from this viewer." }, 403);
  try {
    const server = await import("./inboxServer");
    const project = server.receiptProject(url.searchParams.get("project"));
    if (request.method === "GET") {
      const download = url.searchParams.get("download"), id = url.searchParams.get("id");
      if (id) {
        const { record, bytes } = server.loadOriginal(project, id, privateRoot);
        return new Response(new Uint8Array(bytes), { headers: { ...privateHeaders,
          "Content-Type": record.extension === "pdf" ? "application/pdf" : record.extension === "png" ? "image/png" : "image/jpeg",
          "Content-Disposition": `attachment; filename="receipt-${record.id.slice(0, 12)}.${record.extension}"` } });
      }
      if (download === "pdf") return new Response(new Uint8Array(server.purchasePdf(project, privateRoot)), { headers: { ...privateHeaders,
        "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${project}-expense-report.pdf"` } });
      if (download === "csv") return new Response(server.purchaseCsv(server.loadInbox(project, privateRoot)), { headers: { ...privateHeaders,
        "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${project}-purchase-ledger.csv"` } });
      if (download === "zip") return new Response(new Uint8Array(server.inboxArchive(project, privateRoot)), { headers: { ...privateHeaders,
        "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${project}-receipt-records.zip"` } });
      return json(server.loadInbox(project, privateRoot));
    }
    const limit = request.method === "POST" ? server.MAX_RECEIPT_BYTES + 65536 : 256 * 1024;
    if (Number(request.headers.get("content-length")) > limit) return json({ error: "Receipt request is too large." }, 413);
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "An upload or review is required." }, 400);
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) { await reader.cancel(); return json({ error: "Receipt request is too large." }, 413); }
      chunks.push(value);
    }
    const body = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
    const parsed = new Response(body, { headers: { "Content-Type": request.headers.get("content-type") ?? "" } });
    if (request.method === "POST") {
      const form = await parsed.formData(), files = form.getAll("file");
      if (files.length !== 1 || typeof files[0] === "string") return json({ error: "Upload one receipt per request." }, 400);
      const file = files[0];
      const result = await server.addReceipt(project, file.name, Buffer.from(await file.arrayBuffer()), privateRoot);
      return json(result, result.duplicate ? 200 : 201);
    }
    const input = await parsed.json() as { id: string; revision: number; review: unknown };
    return json(await server.reviewReceipt(project, input.id, input.revision, input.review, privateRoot));
  } catch (error) {
    // Operational errors must not leak private paths, filenames, or document contents.
    if (error && typeof error === "object" && "code" in error) return json({ error: "Private receipt storage is unavailable. Check the local service's storage permissions." }, 409);
    return json({ error: error instanceof Error ? error.message : "Unable to process receipt." }, 400);
  }
}
