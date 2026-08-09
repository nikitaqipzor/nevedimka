import { NextRequest, NextResponse } from "next/server";
import { listVideoAssets, updateVideoAssetStatus } from "@nevidimka/db";
import { requireSession } from "@/lib/session";

export async function GET(): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const assets = await listVideoAssets(session.userId, 20);
  return NextResponse.json({ assets });
}

type VideoAction = { action: "confirm" } | { action: "cancel" };

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ code: "BAD_REQUEST", message: "id query param required" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as VideoAction | null;
  if (body?.action === "confirm") {
    const asset = await updateVideoAssetStatus(session.userId, id, "confirmed");
    return NextResponse.json({ ok: true, asset });
  }
  if (body?.action === "cancel") {
    const asset = await updateVideoAssetStatus(session.userId, id, "cancelled");
    return NextResponse.json({ ok: true, asset });
  }
  return NextResponse.json({ code: "BAD_REQUEST", message: "unknown action" }, { status: 400 });
}
