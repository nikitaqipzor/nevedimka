import { NextRequest, NextResponse } from "next/server";
import { setChannelId } from "@nevidimka/db";
import { getBotChatMember, getMe, sendChannelMessage, TelegramApiError } from "@nevidimka/telegram";
import { requireSession } from "@/lib/session";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return NextResponse.json({ code: "BOT_NOT_CONFIGURED" }, { status: 500 });
  }

  const body = (await req.json().catch(() => null)) as { channelId?: string } | null;
  const channelId = body?.channelId?.trim();
  if (!channelId) {
    return NextResponse.json({ code: "BAD_REQUEST", message: "channelId is required" }, { status: 400 });
  }

  try {
    const me = await getMe({ botToken });
    const membership = await getBotChatMember({ botToken }, channelId, me.id);

    if (membership.status !== "administrator" && membership.status !== "creator") {
      return NextResponse.json(
        {
          code: "NOT_ADMIN",
          message: "Бот не администратор этого канала. Добавь его в администраторы и попробуй снова.",
        },
        { status: 422 }
      );
    }
    if (membership.can_post_messages === false) {
      return NextResponse.json(
        { code: "CANNOT_POST", message: "У бота нет права публиковать сообщения в этом канале." },
        { status: 422 }
      );
    }

    // Test publication, per PROJECT_SPEC.md section 7 — confirms the
    // connection actually works end to end, not just that the API call
    // to check membership succeeded.
    await sendChannelMessage(
      { botToken },
      channelId,
      "✅ «Невидимка» подключена к этому каналу. Публикации будут приходить сюда."
    );

    await setChannelId(session.userId, channelId);
    return NextResponse.json({ ok: true, channelId });
  } catch (err) {
    const message = err instanceof TelegramApiError ? err.message : "Не удалось проверить канал.";
    return NextResponse.json({ code: "TELEGRAM_API_ERROR", message }, { status: 422 });
  }
}
