import { NextRequest, NextResponse } from "next/server";
import {
  addContentVersion,
  createTextPublication,
  getActiveMission,
  getContentDraft,
  getContentVersion,
  getPublicationByDraftId,
  getUserById,
  listContentVersions,
  logAiCall,
  markPublicationFailed,
  markPublicationSent,
  setChosenVersion,
  setContentVersionPrivacyFlags,
  updateDraftStatus,
} from "@nevidimka/db";
import { AiRateLimitExceededError, checkPrivacy } from "@nevidimka/ai";
import { validateTextLength } from "@nevidimka/shared-types";
import { formatChannelPost, sendChannelMessage, TelegramApiError } from "@nevidimka/telegram";
import { requireSession } from "@/lib/session";
import { dayNumberFor, todayInTimezone } from "@/lib/dates";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const { id } = await params;

  const draft = await getContentDraft(session.userId, id);
  if (!draft) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });

  const [versions, publication] = await Promise.all([
    listContentVersions(session.userId, id),
    getPublicationByDraftId(session.userId, id),
  ]);

  return NextResponse.json({ draft, versions, publication });
}

type ContentAction =
  | { action: "finalize"; text: string }
  | { action: "publish" }
  | { action: "cancel" };

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const userId = session.userId;
  const { id: draftId } = await params;

  const body = (await req.json().catch(() => null)) as ContentAction | null;
  if (!body?.action) {
    return NextResponse.json({ code: "BAD_REQUEST", message: "missing action" }, { status: 400 });
  }

  switch (body.action) {
    case "finalize": {
      const text = body.text?.trim();
      if (!text) {
        return NextResponse.json({ code: "BAD_REQUEST", message: "text is required" }, { status: 400 });
      }
      const lengthError = validateTextLength("postSourceText", text);
      if (lengthError) {
        return NextResponse.json({ code: "TEXT_TOO_LONG", message: lengthError }, { status: 400 });
      }
      const finalVersion = await addContentVersion({ userId, draftId, step: "final", text });
      await setChosenVersion(userId, draftId, finalVersion.id);

      let privacyResult: Awaited<ReturnType<typeof checkPrivacy>>;
      try {
        privacyResult = await checkPrivacy({ text }, userId);
      } catch (err) {
        if (err instanceof AiRateLimitExceededError) {
          return NextResponse.json(
            { code: "AI_RATE_LIMIT_EXCEEDED", message: err.message },
            { status: 429 }
          );
        }
        throw err;
      }
      const { output, tokensIn, tokensOut, costUsd } = privacyResult;
      await logAiCall({
        userId,
        role: "privacy_guard",
        input: { draftId },
        output,
        tokensIn,
        tokensOut,
        costUsd,
      });
      const versionWithFlags = await setContentVersionPrivacyFlags(userId, finalVersion.id, output.flags);

      return NextResponse.json({ ok: true, version: versionWithFlags });
    }

    case "publish": {
      const [user, mission] = await Promise.all([getUserById(userId), getActiveMission(userId)]);
      if (!user || !mission) {
        return NextResponse.json({ code: "USER_NOT_FOUND" }, { status: 404 });
      }
      const channelId = user.channelId ?? process.env.TELEGRAM_CHANNEL_ID;
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!channelId || !botToken) {
        return NextResponse.json({ code: "CHANNEL_NOT_CONFIGURED" }, { status: 422 });
      }

      const draft = await getContentDraft(userId, draftId);
      if (!draft || !draft.chosenVersionId) {
        return NextResponse.json({ code: "DRAFT_NOT_READY" }, { status: 422 });
      }
      if (draft.status === "publishing" || draft.status === "published") {
        return NextResponse.json(
          {
            code: "ALREADY_PUBLISHING",
            message: "Публикация уже выполняется или уже завершена для этого черновика.",
          },
          { status: 409 }
        );
      }
      const version = await getContentVersion(userId, draft.chosenVersionId);
      if (!version) {
        return NextResponse.json({ code: "VERSION_NOT_FOUND" }, { status: 404 });
      }

      const today = todayInTimezone(user.timezone);
      const dayNumber = dayNumberFor(user.day0Date, today);
      const html = formatChannelPost({
        dayNumber,
        programLength: user.programLength,
        text: version.text,
      });

      await updateDraftStatus(userId, draftId, "publishing");
      const publication = await createTextPublication({
        userId,
        draftId,
        contentVersionId: version.id,
        channelId,
        publishedHtml: html,
      });

      try {
        const result = await sendChannelMessage({ botToken }, channelId, html);
        const sent = await markPublicationSent(userId, publication.id, result.messageId);
        await updateDraftStatus(userId, draftId, "published");
        return NextResponse.json({ ok: true, publication: sent });
      } catch (err) {
        const message = err instanceof TelegramApiError ? err.message : "unknown error";
        await markPublicationFailed(userId, publication.id, message);
        await updateDraftStatus(userId, draftId, "failed");
        return NextResponse.json(
          { code: "PUBLISH_FAILED", message },
          { status: 502 }
        );
      }
    }

    case "cancel": {
      const draft = await updateDraftStatus(userId, draftId, "failed");
      return NextResponse.json({ ok: true, draft });
    }

    default:
      return NextResponse.json({ code: "BAD_REQUEST", message: "unknown action" }, { status: 400 });
  }
}
