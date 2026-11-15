# Private computer contract

`server/src/daytona.ts` is a backend REST adapter for an existing sandbox. The URL must use
HTTPS without userinfo/query/hash; redirects fail closed. The only HTTP exception is an
explicit loopback fixture option in tests. Sandbox IDs are checked against configuration.
`started` maps to `running`; stopped/error states require owner intervention. No lifecycle
method is exposed. HTTP bodies, headers and signed URLs are omitted from errors. A timeout
on a mutation is ambiguous: reconcile state before retrying; the adapter never retries it.

Toolbox commands explicitly use `bash -lc` and preserve the result's exit code. Uploads use
multipart `file`; downloads return bytes. Large deployment archives may need chunked uploads;
verify the assembled SHA-256 before extraction. No secrets belong in command arguments.

The screen helper maintains an flock-protected JSON lease registry under `HQ_ROOT/leases`.
It reserves four slots (100–103), checks X sockets/locks and loopback ports, and starts Xvfb,
xfwm4, x11vnc and websockify on first use. PID/kernel starttime/argv identities persist across
HQ restarts. A changed/dead recorded identity requires manual reconciliation; the helper
refuses to kill a possibly reused PID. Generations distinguish leases. Captures use Pillow
on the selected X display, returning PNG/base64/dimensions, never the global Daytona screenshot.

The viewer requires HQ_LOCAL inside the guest. The browser connects only to the authenticated
HQ route. HQ performs RFB handshakes against loopback websockify and filters fragmented key,
pointer and clipboard messages in watch mode. Control forwards bytes. Sessions and bot ownership
are checked before establishing upstream connections. Daytona API credentials never reach the UI.

The runtime needs Xvfb, xfwm4, x11vnc, websockify, Pillow, plus desktop GTK Python/xdotool/wmctrl
for the incumbent dock/browser experience. Set HQ_DESK_PYTHON to a Python with GTK, independently
of the capture helper's Python. Additional X11 binaries may be extracted into
`HQ_ROOT/runtime/x11/usr/bin`, with libraries in the matching private runtime directory.
The helper never installs packages at app boot or edits global Chrome policies.

Hermes must be installed from an official fixed release into an owned runtime with
`HERMES_HOME_PRIMARY` beneath HQ_ROOT, API host 127.0.0.1 and own logs/keys. This deployment
uses official tag v2026.9.24, commit f97608f178d1ffeca59860195ab7da295f7c8e5f (0.21.5).
The first attempt at 951ec092848cf72336aafa7fd7bb7ae6d64e689b failed dependency resolution
(Pillow pins conflict); it is not claimed as an installed runtime.
Sources: https://github.com/NousResearch/hermes-agent/tree/f97608f178d1ffeca59860195ab7da295f7c8e5f
and its `website/docs/user-guide/features/api-server.md`. No provider login is initiated by install.

Private access is obtained with GET `/api/sandbox/:id/ports/:port/signed-preview-url`.
Store the complete response and TTL in a 0600 private file; use the returned URL unchanged,
never reconstruct its hostname, disable TLS verification or expose VNC publicly. Renew before
TTL expiry. The delivery names the private access file, with no signed token in public logs.

Rollback: stop only `app`/`primary` using private-service.py after verifying identities; undress
bots and release their own registry leases. Never stop the original desktop, supervisor or
Daytona service. Retain SQLite, Library, browser profiles, Hermes homes, private config and receipts.
`incoming/*.tgz`, chunk files, built dist and package caches are regenerable; data/profiles are not.
No global prune, sandbox reset or destructive installation cleanup is part of rollback.

Canonical local checks: `npm run test:private-computer`, `npm run typecheck`, `npm run build`.
`tests/private-computer/runtime.mjs` is the explicitly authorized real-computer E2E, run only
inside the dedicated guest app with its two private env files loaded. It exercises app HTTP,
real screen tools, Library and RFB without calling a model provider. It leaves the primary bot
and app available; logs distinguish tested computer behavior from unverified model/voice/apps.

Turn-2 runtime verification uses the public API origin supplied privately, without changing DNS,
firewall or transport. Back up the complete dedicated config files and metadata before updating
DAYTONA_API_URL and the returned preview APP_URL/SERVER_URL. The signed preview proxy can set
its own authentication cookie in addition to grokbot_session; test clients must retain both.
`node tests/private-computer/preview-runtime.mjs <private-access-file> <private-sign-in-file>` explicitly exercises
HTTPS login and WSS watch/control with validated TLS and real framebuffer bytes. Renew its
single-use proof sign-in file before running it, and generate a fresh user link afterwards.

The real UI proof attaches CDP to the browsers already managed by this application, using a
seeded owner session on the guest loopback origin. It creates a temporary bot through the real
form and captures two live noVNC screens, control/handback and a mobile viewport. It asserts
actual non-black framebuffer pixels before screenshots. The primary screen can show a mirror
when its own browser observes that display; external viewers do not have that self-reference.

For the constrained test guest, Chromium starts sequentially with background networking/GPU
work reduced and a renderer limit; these are app-profile flags, not system policy. The Cairo
GI bridge (python3-gi-cairo matching the system desktop Python) is extracted under the private
runtime and explicitly loaded by hq-shell. The original avatar source data
`web/src/avatar/shapes.gen.ts` must accompany the built app so its desktop avatar art is retained.
Unpacked home detection uses the running browser, not a CRX installation directory. CDP close
responses are read as bytes, because that endpoint does not return JSON.

Two-browser UI/protocol proof was run with only this installation's idle Hermes gateway paused
to reserve memory; it was resumed afterwards. This is not evidence of four Chrome instances
under load or two browsers plus model execution in 1 GiB. A cold UI connection used the existing
Retry control; report that condition rather than claiming uninterrupted cold startup.

The app service must keep the capture Python on the normal system PATH. A failed/empty Hermes
venv must never shadow it: Hermes is invoked by its configured absolute executable, and only
the primary gateway receives that runtime's bin directory in PATH. The service regression test
covers this boundary; the integrated E2E also asserts HTTP screenshot responses for each bot.

The final 1 GiB guest cgroup recorded `oom=1`, `oom_kill=1`. The victim and time
were not identified. The original active desktop services and configuration remained
present, but the initial process inventory omitted process state; the final zombie
processes cannot be attributed or ruled out as test effects. Do not claim complete
process preservation or stable operation under memory pressure.

Gate follow-up (delivery-v3): screenshot polling reads an existing running screen and
returns204 when none is assigned; opening the viewer initializes it. Availability checks
share a five-second successful check; explicit refresh invalidates it. Release retains
the database mapping if provider cleanup fails. Dead owned processes can be reconciled;
a live changed identity is never signalled. Capture holds the lease lock through pixel
readback. Watch rejects unknown/oversized messages and drops desktop resize.

Preview proof: `node tests/private-computer/preview-runtime.mjs <private-access-file> <private-sign-in-file>`; paths only, never put URLs/tokens in arguments. Runtime proofs
use unique bots/files and clean owned resources on failures. Set `HQ_PROOF_DIR` for
separate evidence generations.

After the orchestrator resized the guest to2vCPU/4GiB without restarting the desktop,
v3 repeated runtime13 and UI10 with the dedicated Hermes gateway running throughout.
The strengthened Home proof required the existing Retry; Home completed and its renderer answered CDP. OOM counters stayed
1→1 (historical); this does not prove four browsers or model inference under load.


Gate follow-up (delivery-v5): each screen uses a private MIT-MAGIC-COOKIE-1 Xauthority
and VNC password/rfbauth (0600, screen directory0700). Xvfb starts with `-auth`;
x11vnc uses `-rfbauth`, never `-ac`/`-nopw`. The HQ backend alone supplies the VNC
password after authenticating the viewer; it never forwards that password to the UI.
Owned commands and captures set XAUTHORITY. Screen slots share the app UID; this
protects against other local users, not malicious code running as that same UID.
On this dedicated Xvfb, `X11VNC_AVOID_WINDOWS=never` initializes selection ownership
without a login-manager delay. `X11VNC_SENDEVENT_SYNC=1` keeps selection-send X errors
inside the upstream error trap when the clipboard owner closes. These are per-process
settings; no global desktop configuration is changed.

Fresh `screenFor` results share a five-second verified mapping; after expiry an existing
mapping gets an owner-checked lookup/ensure instead of list/lease. Owned process receipts
bind PID, kernel starttime, boot ID and UID, permitting exec/argv changes within the
same lifetime. Shutdown rescans the group before returning success. Old gateway receipts
are upgraded only after strict validation; adoption without a receipt requires a dedicated
home-local gateway.pid, configured CLI, detached group/session, matching cwd/UID/home.
An unverified live PID keeps the home intact and refuses adoption/removal.
Model credentials use the explicit SHARED_ENV whitelist from the dedicated primary env,
with process-environment fallback; existing per-bot keys win. Backend secrets and unrelated
messaging credentials are not handed to model gateways. Tests use a fake local CLI and
sentinel keys; they do not prove a real provider login or model inference.


Gate follow-up (delivery-v6): ensure considers a screen ready only with all four verified
services, the X socket and listening VNC/websocket ports. A dead/partial startup stops
only verified survivors and recreates services on the same lease, preserving the private
authentication unit. A durable pre-spawn command/token journal lets recovery reconcile
a service launched before its PID identity was saved. The journal's environment is read
only after command/UID/detached-session checks. Live changed identities refuse cleanup.
`ensure` accepts an expected owner and checks it while holding the registry lock.
The app serializes release with its pending lease/ensure; old `default`/foreign-provider
IDs and missing persisted leases migrate only after a new owned lease successfully starts.
An existing lease owned by another bot is refused, never adopted.

Gateway/service ownership covers the whole attested detached session, including other
process groups and workers surviving the leader. Boot/UID/starttime and PID-reuse checks
remain mandatory; an unverifiable receipt retains the home instead of silently deleting
it. Missing homes have no identity. Managed gateways share successful HTTP probes for
five seconds while still checking their local process identity. Service start/stop uses
a per-service flock before reading state.

First install: run the uploaded installer with `--prepare` in a new exclusive root before
uploading private config/runtime/artifact. Existing unmarked roots are refused. Upgrades
rename the complete old app into `incoming/app-before-*` and extract into a separate
staging directory, so deleted build files do not survive in the live app. Stop only the
owned installation first; the installer never restarts it automatically. The dedicated
Node runtime parses app.env (quotes/comments included) before deriving the primary MCP
token. Inline hq entries support repeated add/remove while preserving unrelated YAML.
Remote writeFile creates its parent before upload; preview proofs require HTTPS for both
access and sign-in before any request.

Final follow-up (delivery-v7): a completed screen start advances a revision returned by
ensure. readyScreen associates its dressing promise with that revision and redresses
a rebuilt X server; the VNC caller also compares revisions after its own ensure.
Release already waits for active dressing through desk.ts's per-screen inTurn queue;
that contract has a deterministic blocked-dress test. The registry lock intentionally
covers start/capture through pixel readback to prevent release/reassignment mid-capture.
This serializes unrelated registry operations during that interval; no claim of parallel
capture/start performance is made, and this final round does not restructure locking.

Registry records the owned X socket/lock device, inode, UID/type and Xvfb PID while
that Xvfb identity is valid. After a crash it validates those receipts and absence of a
live X server before removing only the stale owned artifacts; changed/missing evidence
retains the lease for reconciliation. SIGKILL of a temporary owned Xvfb is exercised
in the real proof, followed by ensure and restored Chrome Home. A partial auth unit
is backed up with metadata and regenerated consistently, including rfbauth for a new
password. Existing complete credentials remain unchanged during ordinary recovery.

Primary start and sign-in use Node parseEnv on the dedicated app.env; app start already
uses Node --env-file, and stop needs only its receipt. Failed starts protect the direct
unreaped Popen child even if /proc reads fail. State uses an already-private temporary
file and atomic replacement so write failures cannot leave partial JSON. Workers'
legacy identity records remain compatible with service_matches's explicit fallback.
Receipts missing uid are upgraded before gateway shutdown.

The Linux /proc test requirement is intentional; no unsafe macOS group-kill fallback
is introduced. env.ts does not reload dotenv after imports; the app guard test also
passes with provider variables preloaded then removed. Remote desktop commands already
propagate the configured HQ_ROOT in commandEnv. Greeting validation now waits for all
12 bytes, and runtime uses the bounded upgrade helper and decoded observer file URL.
The final acceptance step is the orchestrator's manual delta review and Aside, with
no additional full automatic gate requested in this round.
