import { readFile } from "node:fs/promises";
import path from "node:path";
import { createAgentUIStreamResponse } from "ai";
import { z } from "zod";
import { createLessonCoach } from "@/lib/agents/lesson-coach";
import { parseTranscript } from "@/lib/transcript";

export const runtime = "nodejs";
export const maxDuration = 60;
const isLocalPreview = () => process.env.NODE_ENV === "development";
const configured = () => Boolean(process.env.AI_GATEWAY_API_KEY);
const bodySchema = z.object({
  lessonId: z.literal("local-lecture"), position: z.number().finite().min(0).max(728.653),
  messages: z.array(z.object({ id: z.string().max(100), role: z.enum(["user", "assistant"]), parts: z.array(z.object({ type: z.literal("text"), text: z.string().min(1).max(6000) })).min(1).max(8) })).min(1).max(20),
});

export async function GET() {
  return Response.json({ configured: isLocalPreview() && configured() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  // This endpoint is deliberately scoped to the local lecture; production
  // rollout must load its transcript after server-side enrollment authorization.
  if (!isLocalPreview()) return new Response(null, { status: 404 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return new Response(null, { status: 403 });
  if (!configured()) return Response.json({ error: "Lesson assistant is not connected yet." }, { status: 503 });
  let input: z.infer<typeof bodySchema>;
  try {
    if (Number(request.headers.get("content-length")) > 60_000) return new Response(null, { status: 413 });
    const raw = await request.text();
    if (raw.length > 60_000) return new Response(null, { status: 413 });
    input = bodySchema.parse(JSON.parse(raw));
  } catch { return Response.json({ error: "Invalid chat request." }, { status: 400 }); }
  try {
    const source = await readFile(path.join(process.cwd(), ".local-media", "lecture.srt"), "utf8");
    const cues = parseTranscript(source, 728.652336);
    if (!cues.length) return Response.json({ error: "Lecture transcript unavailable." }, { status: 503 });
    return await createAgentUIStreamResponse({
      agent: createLessonCoach(cues, input.position), uiMessages: input.messages,
      abortSignal: request.signal, timeout: 55_000,
      onError: () => "The lesson assistant could not respond. Please try again.",
    });
  } catch { return Response.json({ error: "The lesson assistant is unavailable. Please try again." }, { status: 503 }); }
}
