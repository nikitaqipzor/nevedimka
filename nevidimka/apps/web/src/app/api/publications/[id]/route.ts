import { NextRequest, NextResponse } from "next/server";
import { getPublication, markPublicationDeleted, markPublicationEdited } from "@nevidimka/db";
import { deleteChannelMessage, editChannelMessage, TelegramApiError } from "@nevidimka/telegram";
import { validateTextLength } from "@nevidimka/shared-types";
import { requireSession } from "@/lib/session";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const { id } = await params;

  const publication = await getPublication(session.userId, id);
  if (!publication) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ publication });
}

type PublicationAction = { action: "edit"; text: string } | { action: "delete" };

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const userId = session.userId;
  const { id } = await params;

  const publication = await getPublication(userId, id);
  if (!publication) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
  if (publication.status !== "published" && publication.status !== "edited") {
    return NextResponse.json(
      { code: "NOT_EDITABLE", message: "Можно менять только реально опубликованные посты." },
      { status: 422 }
    );
  }
  if (!publication.telegramMessageId) {
    return NextResponse.json({ code: "NO_MESSAGE_ID" }, { status: 422 });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return NextResponse.json({ code: "CHANNEL_NOT_CONFIGURED" }, { status: 422 });
  }

  const body = (await req.json().catch(() => null)) as PublicationAction | null;
  if (!body?.action) {
    return NextResponse.json({ code: "BAD_REQUEST" }, { status: 400 });
  }

  try {
    if (body.action === "edit") {
      const text = body.text?.trim();
      if (!text) {
        return NextResponse.json({ code: "BAD_REQUEST", message: "text is required" }, { status: 400 });
      }
      const lengthError = validateTextLength("postSourceText", text);
      if (lengthError) {
        return NextResponse.json({ code: "TEXT_TOO_LONG", message: lengthError }, { status: 400 });
      }

      await editChannelMessage({ botToken }, publication.channelId, publication.telegramMessageId, text);
      const updated = await markPublicationEdited(userId, id, text);
      return NextResponse.json({ ok: true, publication: updated });
    }

    if (body.action === "delete") {
      await deleteChannelMessage({ botToken }, publication.channelId, publication.telegramMessageId);
      const updated = await markPublicationDeleted(userId, id);
      return NextResponse.json({ ok: true, publication: updated });
    }

    return NextResponse.json({ code: "BAD_REQUEST", message: "unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof TelegramApiError ? err.message : "unknown error";
    return NextResponse.json({ code: "TELEGRAM_API_ERROR", message }, { status: 502 });
  }
}
