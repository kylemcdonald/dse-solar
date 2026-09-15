import { handleReceiptInbox } from "../inboxHandler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return handleReceiptInbox(request); }
export function POST(request: Request) { return handleReceiptInbox(request); }
export function PATCH(request: Request) { return handleReceiptInbox(request); }
