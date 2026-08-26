import { privateModeEnabled } from "../privateMode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!privateModeEnabled()) return new Response("Not found", { status: 404 });
  try {
    const { loadReceiptArchive, receiptAllowlist } = await import("../receiptServer");
    const archive = loadReceiptArchive();
    return new Response(new Uint8Array(archive), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": 'attachment; filename="dse-fiji-receipts.zip"',
        "Content-Length": String(archive.length),
        "Content-Type": "application/zip",
        "X-Content-Type-Options": "nosniff",
        "X-Receipt-Count": String(receiptAllowlist().size),
      },
    });
  } catch (error) {
    console.error("Unable to build private receipt archive", error);
    return new Response("Receipt archive is incomplete", { status: 409 });
  }
}
