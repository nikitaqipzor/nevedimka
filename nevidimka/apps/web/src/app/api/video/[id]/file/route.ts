import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { getLatestVideoRender, getVideoAsset } from "@nevidimka/db";
import { requireSession } from "@/lib/session";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * Serves a local file with real HTTP Range support (206 Partial Content)
 * instead of reading it whole into memory — needed for proper seeking/
 * scrubbing in the <video> player, and for not holding entire files in
 * memory as videos get larger. Falls back to a full 200 response with
 * Accept-Ranges advertised when no Range header is sent (e.g. a plain
 * `fetch` for the cover image).
 */
async function serveFileWithRange(req: NextRequest, filePath: string, contentType: string): Promise<Response> {
  const stats = await stat(filePath);
  const fileSize = stats.size;
  const range = req.headers.get("range");

  if (!range) {
    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(fileSize),
        "Accept-Ranges": "bytes",
      },
    });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${fileSize}` } });
  }

  const start = match[1] ? parseInt(match[1], 10) : 0;
  const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start < 0 || end >= fileSize) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${fileSize}` } });
  }

  const chunkSize = end - start + 1;
  const stream = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream;
  return new Response(stream, {
    status: 206,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(chunkSize),
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
    },
  });
}

export async function GET(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const { id } = await params;

  const asset = await getVideoAsset(session.userId, id);
  if (!asset) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });

  const variant = req.nextUrl.searchParams.get("variant") ?? "preview";

  if (variant === "cover") {
    const preview = await getLatestVideoRender(session.userId, id, "preview");
    if (!preview?.coverPath) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
    return serveFileWithRange(req, preview.coverPath, "image/jpeg");
  }

  const kind = variant === "final" ? "final" : "preview";
  const render = await getLatestVideoRender(session.userId, id, kind);
  if (!render) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });

  return serveFileWithRange(req, render.storagePath, "video/mp4");
}
