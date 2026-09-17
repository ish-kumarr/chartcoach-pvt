# DRM device and credential matrix

This document separates credential-independent engineering evidence from real
CDM playback evidence. Update a row only from a physical device using the
recorded package, OS/browser build, HTTPS environment, and retained sanitized
logs. Headless browsers, emulators, test doubles, and development Clear Key do
not satisfy Widevine or FairPlay rows.

## Current gate

| Capability | Status | Evidence required to change status |
|---|---|---|
| Local CENC + Clear Key contract | IMPLEMENTED, VERIFY PER RELEASE | Passing automated gate and manual encrypted playback flow. Development/test only. |
| Credentialed provider contract | IMPLEMENTED WITH TEST DOUBLE | Contract tests for HTTPS manifest/license/certificate URLs, expiry, and capture policy. |
| Google Widevine service | CREDENTIAL BLOCKED | Approved license-service access, server test vectors, successful challenge/license/renewal/denial evidence. |
| Apple FairPlay service | CREDENTIAL BLOCKED | FairPlay Streaming approval, deployment certificate/private key, SPC/CKC service, vendor test vectors. |
| Production DRM release | BLOCKED | All required physical-device rows passed, production key custody, server watermark rendering, operations review, and security review. |

Credential-blocked rows are expected while applications are pending. The
application must continue to report `credentials_status=pending` and
`production_ready=false` in this state.

## Physical-device acceptance record

| Platform | Required DRM path | Current status | Checks after credentials arrive |
|---|---|---|---|
| Windows / current Chrome | Widevine, DASH or validated production manifest | CREDENTIAL BLOCKED | Three cold starts; license and renewal; expiry/denial; captions; speed; watched-range seek; prompts; fullscreen; remount. |
| Windows / current Edge | Widevine | CREDENTIAL BLOCKED | Record selected CDM and repeat the Chrome checks. |
| Android phone / current Chrome | Widevine | CREDENTIAL BLOCKED | Touch targets; rotation; captions; TalkBack; background/foreground; renewal; network interruption. |
| macOS / current Safari | FairPlay, native HLS | CREDENTIAL BLOCKED | Certificate and SPC/CKC exchange; three cold starts; captions; seek gates; fullscreen/inline prompt behavior; remount. |
| iPhone / current Safari | FairPlay, native HLS | CREDENTIAL BLOCKED | Portrait/landscape; inline/native fullscreen limits; VoiceOver; background/foreground; renewal; prompt restoration. |
| iPad / current Safari | FairPlay, native HLS | CREDENTIAL BLOCKED | Rotation; touch layout; inline/fullscreen gate transitions; captions; renewal; remount. |

For each run record:

- date, tester, hardware model, OS build, browser build, and Shaka version;
- anonymized asset/generation ID and DRM policy;
- manifest type and selected CDM/key system;
- sanitized request correlation IDs for certificate/license/renewal/denial;
- playback duration, cold-start count, and every interaction result;
- screenshot or screen recording only when it contains no capability URL,
  token, key, email address, or private lesson content.

## External material still required

Widevine requires approved license-service access and its associated server
credentials or vendor integration material. FairPlay requires Apple approval,
the FairPlay Streaming Server SDK material, deployment certificate/private key,
and SPC/CKC service configuration. Both require an HTTPS test environment and
the physical devices listed above.

Do not place vendor SDKs, certificates, private keys, content keys, license
responses, or signed URLs in this repository. Supplying those materials starts
the credentialed acceptance sprint; it does not require redesigning the player
or its provider-neutral authorization contract.
