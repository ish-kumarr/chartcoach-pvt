# Local lesson study tools

Open http://127.0.0.1:3000/learn/price-action-secrets/1?preview=1 with the frontend development server running.

Playback supports 0.5x–2x. The searchable transcript uses the supplied timed Hindi captions and the video's current playback position, including after seeks and speed changes. Select a line to seek; use Follow video to return to automatic scrolling. Transcript and assistant reference links use the same seek warnings and required-question gates as the timeline. Caption timing and wording are only as accurate as the supplied auto-generated track; cues are clipped at the actual video end.

## Connect the assistant later

Set AI_GATEWAY_API_KEY in frontend/.env.local, optionally set LESSON_CHAT_MODEL (default anthropic/claude-sonnet-5), and restart the frontend. Never use a NEXT_PUBLIC prefix for the key. Use Recheck connection in the assistant panel.

The Vercel AI SDK agent streams responses through AI Elements and can return validated concept cards, transcript references, and practice questions with feedback. References resolve to server-loaded caption cues. Practice cards do not award course completion. Without a key, the panel remains disconnected and does not fabricate responses.

This integration is intentionally limited to the development-only local-lecture preview. Production returns 404 for chat POST requests. Before enabling protected lessons in production, add server-side learner/enrollment authorization and load the corresponding authorized transcript. Local media is never uploaded by this feature; enabling chat sends the transcript and chat messages to the configured AI provider. Live provider responses require a configured key and have not been verified without one.
