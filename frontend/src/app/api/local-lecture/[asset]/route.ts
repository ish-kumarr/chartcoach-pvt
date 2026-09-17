import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ asset: string }> }) {
  if (process.env.NODE_ENV !== "development") return new Response(null, { status: 404 });
  const { asset } = await context.params;
  const files: Record<string, string> = { "video.mp4": "lecture.mp4", "captions.vtt": "lecture.srt", "poster.jpg": "poster.jpg" };
  if (!Object.hasOwn(files, asset)) return new Response(null, { status: 404 });
  const file = path.join(process.cwd(), ".local-media", files[asset]);
  try {
    if (asset === "captions.vtt") {
      const srt = await readFile(file, "utf8");
      const vtt = "WEBVTT\n\n" + srt.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
      return new Response(vtt, { headers: { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "no-store" } });
    }
    const { size } = await stat(file);
    const range = request.headers.get("range");
    let start = 0, end = size - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const headers: Record<string, string> = { "Content-Type": asset === "video.mp4" ? "video/mp4" : "image/jpeg", "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
    if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>;
    return new Response(stream, { status: range ? 206 : 200, headers });
  } catch { return new Response("Local lecture file unavailable", { status: 404 }); }
}
