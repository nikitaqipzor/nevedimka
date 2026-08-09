import { NextRequest, NextResponse } from "next/server";
import {
  addContentVersion,
  createContentDraft,
  listContentDrafts,
  listEvidencesForUser,
  logAiCall,
  updateDraftStatus,
} from "@nevidimka/db";
import { AiRateLimitExceededError, editText } from "@nevidimka/ai";
import { validateTextLength } from "@nevidimka/shared-types";
import { requireSession } from "@/lib/session";

export async function GET(): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const [drafts, evidences] = await Promise.all([
    listContentDrafts(session.userId, 20),
    listEvidencesForUser(session.userId, 10),
  ]);

  const recentEvidences = evidences
    .filter((e) => e.rawText || e.transcript)
    .map((e) => ({ id: e.id, preview: (e.rawText ?? e.transcript ?? "").slice(0, 80) }));

  return NextResponse.json({ drafts, recentEvidences });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const userId = session.userId;

  const body = (await req.json().catch(() => null)) as
    | { sourceText?: string; sourceEvidenceId?: string }
    | null;
  const sourceText = body?.sourceText?.trim();
  if (!sourceText) {
    return NextResponse.json({ code: "BAD_REQUEST", message: "sourceText is required" }, { status: 400 });
  }
  const lengthError = validateTextLength("postSourceText", sourceText);
  if (lengthError) {
    return NextResponse.json({ code: "TEXT_TOO_LONG", message: lengthError }, { status: 400 });
  }

  const draft = await createContentDraft({
    userId,
    sourceText,
    sourceEvidenceId: body?.sourceEvidenceId,
  });
  await addContentVersion({ userId, draftId: draft.id, step: "original", text: sourceText });
  await updateDraftStatus(userId, draft.id, "editing");

  let editResult: Awaited<ReturnType<typeof editText>>;
  try {
    editResult = await editText({ sourceText }, userId);
  } catch (err) {
    if (err instanceof AiRateLimitExceededError) {
      await updateDraftStatus(userId, draft.id, "failed");
      return NextResponse.json({ code: "AI_RATE_LIMIT_EXCEEDED", message: err.message }, { status: 429 });
    }
    throw err;
  }
  const { output, tokensIn, tokensOut, costUsd } = editResult;
  await logAiCall({
    userId,
    role: "text_editor",
    input: { draftId: draft.id },
    output,
    tokensIn,
    tokensOut,
    costUsd,
  });

  const [gentle, structured, short] = await Promise.all([
    addContentVersion({ userId, draftId: draft.id, step: "gentle", text: output.gentle }),
    addContentVersion({ userId, draftId: draft.id, step: "structured", text: output.structured }),
    addContentVersion({ userId, draftId: draft.id, step: "short", text: output.short }),
  ]);
  const updatedDraft = await updateDraftStatus(userId, draft.id, "ready_for_review");

  return NextResponse.json({ draft: updatedDraft, versions: [gentle, structured, short] });
}
