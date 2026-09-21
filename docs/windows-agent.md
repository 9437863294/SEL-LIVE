# SEL LIVE Windows Agent

Attendance, work-activity and desktop notifications for company PCs, as an extension of the
existing SEL LIVE ERP.

This document is for the people who will deploy, run and support it: IT administrators doing the
rollout, and engineers maintaining the code. It assumes you can read a registry path and run an
`msiexec` command, and it does not assume you have read the source.

---

## 1. What it actually does

A small agent runs on each office PC. While an employee is signed in to it, it records:

| What | How |
|---|---|
| Which application is in the foreground, and for how long | `SetWinEventHook` on `EVENT_SYSTEM_FOREGROUND` |
| Whether the keyboard and mouse are in use | `GetLastInputInfo` |
| Lock, unlock, sleep, resume, logoff, shutdown | `SystemEvents.SessionSwitch` / `PowerModeChanged` |
| Sign-in and sign-out times, per computer | The agent's own session, opened against the ERP |
| ERP actions — what was opened, approved, updated | The existing `userLogs` trail, unchanged |

It also shows desktop notifications from SEL LIVE, and clicking one opens the exact record — in a
SEL LIVE window inside the agent, already signed in as the person who signed in to the agent, or
in their own browser where that window is not available (§7a).

**What it does not do, and contains no code to do:** keystroke logging, password capture, clipboard
reading, message or document contents, screenshots, screen recording, webcam, microphone, or
browsing history. Window titles and website domains are *optional* and **off by default**; both are
enforced server-side, so an agent that sent them under a policy that forbids them would have them
discarded at ingest rather than stored.

---

## 2. Supported Windows, honestly

| | Win 7 SP1 | Win 8.0 | Win 8.1 | Win 10 | Win 11 |
|---|---|---|---|---|---|
| Agent runs at all | ✅ | ❌ | ✅ | ✅ | ✅ |
| Auto-start, Windows service | ✅ | — | ✅ | ✅ | ✅ |
| Application / idle / lock tracking | ✅ | — | ✅ | ✅ | ✅ |
| Attendance sessions, offline queue, sync | ✅ | — | ✅ | ✅ | ✅ |
| ERP deep links, system tray, auto-update | ✅ | — | ✅ | ✅ | ✅ |
| Notifications | SEL popup | — | SEL popup | Native toast | Native toast |
| Access gate | Topmost window | — | Topmost window | Topmost window¹ | Topmost window¹ |

¹ Windows 10/11 **Enterprise and Education** can additionally enforce a controlled shell — see §7.

### Windows 8.0 cannot run this agent

.NET Framework 4.8's supported client operating systems are Windows 7 SP1, Windows 8.1, Windows 10
and Windows 11. Microsoft dropped Windows 8.0 after 4.6.1, and 8.0 itself left support in January
2016 when 8.1 became a prerequisite for further updates.

The installer checks for this and refuses with a message naming the 8.1 update, rather than
installing a service that cannot start. Two ways forward:

1. **Update the PC to Windows 8.1.** Free, and the supported configuration regardless of this
   agent — an unpatched 8.0 machine has had no security updates for a decade.
2. **Retarget the build**, if a real 8.0 machine exists and cannot be updated:
   ```
   dotnet build windows/SEL.Agent.sln -p:SelAgentTargetFramework=net461
   pwsh windows/SEL.Agent.Installer/build.ps1 -TargetFramework net461
   ```
   .NET Framework 4.6.1 supports Windows 8.0 and every dependency still resolves. What you give up
   is four years of framework servicing. Both target frameworks are verified to build.

### Legacy-only limitations, in full

These are the only three places behaviour differs, and none is a feature being switched off.

**Notifications on Windows 7 / 8.1.** No Action Center exists, so the agent draws its own window.
It carries the same buttons, the same deep links and the same delivery receipts as a native toast,
so the §39 delivery report is comparable across a mixed fleet. What is lost: notifications do not
persist in a system notification centre after they close; they are not governed by Windows'
notification settings or Focus Assist; and one raised while nobody is signed in is shown at the
next sign-in rather than queued by the OS.

**Per-monitor DPI on Windows 7.** The gate and the popup are system-DPI aware only. On a mixed-DPI
setup they render at the primary monitor's scale. Cosmetic.

**The ERP window on Windows 7 / 8.1.** WebView2 is not part of Windows — it is an installable Edge
component, and Microsoft ended support for it on these releases in 2023. So the installer does not
offer it there, and SEL LIVE opens in the machine's default browser instead of in a window inside
the agent. Single sign-on is what is lost: the employee signs in to the browser once, as they do
today. Everything else — the deep links from notifications, the tray menu, the whole ERP — works
identically. The agent states which mode it is in rather than leaving anyone to guess. §7a.

The same fallback applies on Windows 10 and 11 where the WebView2 runtime is absent or blocked by
policy, so this is a capability check at start-up rather than a version check.

---

## 3. How it is put together

```
Windows PC                                    SEL LIVE (existing Next.js + Firebase)
┌────────────────────────────┐
│ SEL.Agent.Service          │                ┌──────────────────────────────────┐
│  (LocalSystem)             │                │ /api/windows-agent/*             │
│  · starts the agent in     │   HTTPS + JSON │   device/register   heartbeat    │
│    each signed-in session  │ ─────────────► │   login             activity     │
│  · restarts it if killed   │                │   logout            notifications│
│  · prunes the local queue  │                │   policy            version      │
├────────────────────────────┤                └───────────────┬──────────────────┘
│ SEL.Agent (per user)       │                                │ Admin SDK only
│  · access gate + dashboard │                                ▼
│  · foreground / idle / lock│                ┌──────────────────────────────────┐
│  · tray icon, notifications│                │ Firestore: windows* collections  │
│  · SQLite queue (DPAPI)    │                └──────────────────────────────────┘
└────────────────────────────┘                                │
                                                              ▼
                                               /windows-agent/* admin screens
```

**The agent never touches Firestore.** It has no Firebase SDK and no service-account key. Its
entire vocabulary is the nine API routes; everything is validated and written server-side. A
decompiled agent yields a list of URLs.

**Authentication is two independent facts:**

- *The user* — a Firebase ID token, obtained by the gate calling Google's Identity Toolkit REST
  endpoint directly with the public Web API key. The password never passes through SEL LIVE's own
  servers.
- *The device* — a 256-bit secret issued once at enrolment, stored DPAPI-encrypted on the PC, held
  in Firestore only as a salted scrypt hash.

Neither alone is sufficient. A stolen laptop is useless without a password; a stolen password is
useless on an unenrolled PC.

### Where things live

| | |
|---|---|
| Domain model, rules, policy, permissions | `src/lib/windows-agent-*.ts` (pure, dependency-free) |
| Server half (Admin SDK) | `src/lib/windows-agent-server.ts`, `-notifications.ts`, `-morning.ts` |
| API routes | `src/app/api/windows-agent/*` |
| Admin screens | `src/app/(protected)/windows-agent/*`, `src/components/windows-agent/*` |
| Windows client | `windows/` — Core, WindowsLegacy, WindowsModern, app, service, tests, installer |
| Embedded ERP window | `windows/SEL.Agent/ErpWindow.xaml{,.cs}`, `ErpBrowser.cs`, and `src/app/(public)/auth/agent/page.tsx` at the other end |
| Admin-gated exit | `windows/SEL.Agent/ElevationGate.cs` |
| Installer | `windows/SEL.Agent.Installer/Package.wxs` (the MSI), `Bundle.wxs` (the setup .exe), `build.ps1` (both) |
| Tests | `tests/windows-agent-domain.test.mjs`, `windows/SEL.Agent.Tests` |

```
npm run test:windows-agent          # 54 domain tests
npm run typecheck:windows-agent
dotnet test windows/SEL.Agent.Tests # 68 agent tests, including the OS compatibility matrix
```

---

## 4. Server setup, once

1. **Deploy the Firestore indexes.** Twenty composite indexes were added to
   `firestore.indexes.json`. Every report needs one.
   ```
   firebase deploy --only firestore:indexes
   ```

2. **Adopt the security rules.** `firestore.rules` is *not* wired into `firebase.json` in this
   repository — the live rules are maintained in the Firebase console. Copy the
   `Windows Agent` section (the `waPerm`, `canOpenWindowsAgent` and `canReadWindowsActivity`
   helpers plus the `windows*` blocks) into the console ruleset.

   Until you do, the `windows*` collections are readable and writable by any signed-in user. The
   API routes are still safe — they run under the Admin SDK and check permissions themselves —
   but the admin screens read Firestore directly.

3. **Grant permissions.** In Role Management, the new `Windows Agent` module. Nobody holds any of
   them on day one, deliberately. A sensible starting split:

   | Role | Grant |
   |---|---|
   | IT administrator | Devices (all), Enrollment Codes, Policies, Agent Versions, Audit Logs |
   | HR | Attendance View/Export, Activity View All, Reports |
   | Department manager | Activity View Department, Attendance View, Reports View |
   | Everybody | nothing — self-view needs no grant |

4. **Set `CRON_SECRET`** and schedule the sweep:
   ```
   /api/windows-agent/cron?only=sessions,notifications   every 15 minutes
   /api/windows-agent/cron?only=retention,catalog        nightly
   ```
   The sessions sweep is the one that matters: it closes sessions whose agent stopped reporting.
   Without it, a PC that lost power shows as online indefinitely.

5. **Create an enrolment code** on `/windows-agent/devices`. Leave *Approve automatically* **off**
   for the pilot, so each new machine waits for approval.

---

## 5. Building and installing the agent

### Build (on a developer or CI machine)

```
dotnet tool install --global wix --version 5.0.2
wix extension add -g WixToolset.Util.wixext/5.0.2
wix extension add -g WixToolset.UI.wixext/5.0.2
wix extension add -g WixToolset.BootstrapperApplications.wixext/5.0.2

pwsh windows/SEL.Agent.Installer/build.ps1 -Version 1.0.0.0
```

> Pin the extension versions. `wix extension add` without one resolves to the newest release,
> which is currently 7.0.0; WiX 5 rejects it with a `WIX6101` warning and installs nothing, and
> the build then fails much later with an unresolved-namespace error.

The first build downloads the Microsoft redistributables into
`windows/SEL.Agent.Installer/redist/` (about 123 MB) and caches them there. They are gitignored,
and their SHA-256 is checked on every build — these files get embedded into something that runs
as administrator on every PC in the estate, so a truncated download is worth catching here.

The output is **one file**:

```
windows/SEL.Agent.Installer/bin/SEL.Agent-Setup-1.0.0.0.exe
```

Hand that to whoever is installing. Nothing else needs to be copied. The script prints its
**SHA-256** — keep it, that is what you enter when publishing the version in SEL LIVE, and the
agent refuses an update whose hash does not match.

For a fleet, sign it:

```
pwsh windows/SEL.Agent.Installer/build.ps1 -Sign -CertificateThumbprint <thumbprint>
```

An unsigned installer is fine for a pilot. It is not fine for a rollout: the signature is what
stops a compromised update server from running arbitrary code as SYSTEM on every PC, and an
unsigned `.exe` also collects a SmartScreen warning on every machine it touches.

Other switches:

| Switch | Effect |
|---|---|
| `-KeepMsi` | Also writes the bare MSI to `bin\`, for Group Policy software installation or Intune's Win32 wrapper — neither can consume a bundle's switches |
| `-SkipBundle` | MSI only. The .NET prerequisite is then your problem |
| `-OfflineWebView2` | Embeds the full 188 MB WebView2 runtime instead of its 2 MB downloader. Only for sites with no internet at all |
| `-NoDownload` | Fail rather than fetch a missing redistributable, for build servers with no egress |

### What is in the package, and why

| Component | Size | Installed when | Vital |
|---|---|---|---|
| .NET Framework 4.8 | 121 MB | `NDP\v4\Full\Release < 528040` | Yes — no agent without it |
| Edge WebView2 (downloader) | 2 MB | Not already present, and Windows 10 or later | **No** |
| The agent MSI | 3 MB | Always | Yes |

WebView2 is deliberately non-vital. It powers the ERP window *inside* the agent (§7a), it has no
Microsoft support on Windows 7 or 8.1, and some managed desktops block it outright. Where it is
missing the agent says so and opens SEL LIVE in the user's normal browser instead. Failing an
attendance rollout because an optional browser control would not install is the wrong failure.

### Install (on each PC)

**Double-click.** Windows asks for administrator approval once — a consent prompt for an
administrator, a credential prompt for a standard user, who can then hand the keyboard to IT.
Declining either aborts the install. Everything after that point, including the prerequisites,
runs inside that one elevated session.

All configuration is optional. Installed with none, the agent opens a setup window asking for one
thing: the address of your SEL LIVE installation. It fetches the Firebase configuration from that
server itself, so nobody transcribes an API key onto each machine.

**Unattended — the one to use for a rollout.** GPO, SCCM, or a script:

```
SEL.Agent-Setup-1.0.0.0.exe /quiet ^
  APIBASEURL=https://sel.example.com ^
  ENROLLMENTCODE=SEL-HO-2026
```

```
SEL.Agent-Setup-1.0.0.0.exe /uninstall /quiet
SEL.Agent-Setup-1.0.0.0.exe /log setup.log        (when it goes wrong)
```

`FIREBASEAPIKEY` may also be passed but rarely should be: it is the same public value the web app
already ships to every browser, it authorises nothing on its own, and demanding it per machine
only ever added a typo that surfaced later as an opaque Google error.

The installer refuses before downloading anything if the OS is unsupported — Windows 8.0, or
Windows 7 without SP1 — with a message saying what to do about it.

> **Why "only an administrator can install this" is not a property check.** An earlier version
> carried `Launch Condition="Privileged"` in the MSI. That condition is evaluated in the UI
> sequence, *before* Windows Installer elevates anything, so a standard user saw a dead-end
> message box and was never offered the chance to enter credentials. It has been removed. The
> package is `Scope="perMachine"` and the bundle registers per-machine, so Windows requests
> elevation itself — which is both stricter than a property we wrote and considerably more
> helpful to the person standing at the PC.

### Check a PC before trusting it

```
"C:\Program Files\SEL LIVE\Agent\SEL.Agent.Service.exe" --check
```

Reports the OS, the notification path it will use, whether Shell Launcher is available, whether
DPAPI works, whether TLS 1.2 is usable, and whether a real handshake with your ERP succeeds. Exits
non-zero on failure, so it can be used from a deployment script.

---

## 5a. Who can sign in on which computer

**The default is open: any active SEL LIVE user, on any enrolled PC.** A freshly enrolled machine
restricts nobody, and nobody is restricted to particular machines. You narrow it from either side,
and a sign-in has to satisfy both.

| | Where | Empty means |
|---|---|---|
| **Who may use this PC** | `/windows-agent/devices/<id>` → *Who may sign in here* | The PC is shared |
| **Which PCs may this person use** | `/windows-agent/access` | The person may use any PC |

The four configurations this gives you:

| Device list | User list | Result |
|---|---|---|
| empty | empty | **Open fleet** — anybody, anywhere. The default. |
| named | empty | **A personal machine.** Only those people; they can still use other PCs. |
| empty | named | **A confined person.** A contractor tied to two site PCs, refused even on shared ones. |
| named | named | **A locked pairing.** Both lists must agree. |

### Why it takes two lists and not one

This is the part worth understanding before configuring it, because the obvious single-list design
does not work.

A device-side list can only say *who may use this PC*. Naming Priya on two machines restricts
**those machines** — it says nothing about the other thirty PCs in the building, which remain open
to everybody including her. To actually confine her with device lists alone you would have to name
an assignee on every other machine in the estate and keep that correct for ever. That is not a
configuration; it is a standing chore that will be wrong within a week.

The user-side list makes "Priya may use only these two" a single edit.

### Practical notes

- **Clearing the list removes the restriction**, it does not deny everything. The button says so
  ("Allow any computer"), and the underlying document is deleted rather than stored empty — an
  empty array left lying around reads as "a restriction exists" when none does.
- **Ticking a PC that is reserved for other people achieves nothing on its own.** Both lists must
  agree, so you also have to add the person on that device's page. The access screen warns you
  inline rather than letting you save something that cannot work.
- **Every change is audited** with the before and after lists and your reason.
- **If the restriction cannot be read, the sign-in is allowed.** A Firestore hiccup must not lock
  a building out of its computers; the device-side list still applies. The failure is logged.

---

## 6. Windows 7 and TLS 1.2 — read this before piloting

**This is the most likely reason a Windows 7 rollout fails.**

Google's identity endpoints and Firebase App Hosting both require TLS 1.2. Windows 7 SP1 supports
it but ships with it disabled for applications, and .NET Framework before 4.7 defaults to TLS 1.0.
The two combine into a failure that names neither: *"The connection was closed unexpectedly"*, on a
PC where the same URL opens fine in Chrome — because Chrome brings its own TLS stack.

The installer sets the .NET side (`SchUseStrongCrypto`, `SystemDefaultTlsVersions`, in both the
64-bit and WOW6432Node keys — the agent is a 32-bit process, so setting only the first is the
classic half-fix). It deliberately does **not** change SChannel or reboot the machine.

On each Windows 7 PC, also ensure:

1. **KB3140245** (or a later rollup containing it) is installed.
2. `HKLM\SYSTEM\CurrentControlSet\Control\SecurityProviders\SCHANNEL\Protocols\TLS 1.2\Client`
   has `Enabled = 1` and `DisabledByDefault = 0` (both DWORD).
3. Reboot.

Then re-run `--check`. Windows 8.1 and later need none of this.

---

## 7. The access gate — what it is and is not

The gate is a full-screen, topmost window shown at start-up when the policy asks for it. It blocks
close, minimise, Escape and Alt+F4, and re-asserts focus if something takes it.

**It is not a Windows security boundary.** Task Manager launched from Ctrl+Alt+Delete can end it,
and a second local account bypasses it. Anyone describing a topmost window as mandatory access
control is overselling it, and a rollout planned on that basis will be unpleasantly surprised.
Interfering with Ctrl+Alt+Delete is unsupported by Microsoft and is the fastest way to make a PC
unrecoverable, so the agent does not attempt it.

Treat the gate as **an attendance prompt that is hard to ignore**, not as access control.

If you need real enforcement, the supported route is **Shell Launcher** on Windows 10/11
Enterprise or Education, configured through Assigned Access to run the agent as the shell. That is
an operating-system feature, configured per machine by IT, and is outside what this installer does.
`--check` reports whether a given PC's SKU supports it.

### Emergency recovery

**Ctrl+Shift+Alt+F12** closes the gate and records the fact in the agent log. It exists so nobody
is ever locked out of a PC by a monitoring agent, and it concedes nothing the gate did not already
concede.

Other recovery paths, in increasing order of severity:

| Situation | Fix |
|---|---|
| Gate appearing when it should not | Set `requireMorningLogin` off in the policy; takes effect within one heartbeat |
| One PC needs the gate off now | Stop the service, then end `SEL.Agent.exe` from Task Manager |
| Credential broken after re-imaging | `SEL.Agent.Service.exe --reset-identity`, then restart the service |
| PC must stop reporting entirely | Block the device in SEL LIVE — the agent stops within one heartbeat, and Windows is unaffected |
| Remove the agent | `SEL.Agent-Setup-<version>.exe /uninstall /quiet`, or Programs and Features → "SEL LIVE Windows Agent" — removes the service, the binaries, the credential, the queue and the logs. .NET and WebView2 are left alone; they are shared Windows components and other software depends on them |

There is one entry in Programs and Features, not three. The MSI installs with
`ARPSYSTEMCOMPONENT`, so only the bundle is listed — removing it removes everything.

---

## 7a. The ERP inside the agent

Signing in to the agent signs you in to SEL LIVE. Opening a notification, or "Open SEL LIVE" from
the tray, brings up the ERP in a window that belongs to the agent, already authenticated as the
person at the keyboard. There is a nav strip with back, forward, reload, home — and **Open in
browser**, which hands the current page to Chrome or Edge.

That last button is what makes the window safe to ship. Anything it renders badly, anything that
needs a password manager, anything that wants to print: one click and it is in the real browser.
Without it, an employee hitting a limitation has nowhere to go and the window becomes an obstacle.

**Where WebView2 is unavailable** — Windows 7 and 8.1, an unmanaged desktop that never installed
it, a policy that blocks it — the agent detects that at start-up, writes it to the log, says
"Opens in your default browser" in its status panel, and every ERP link opens externally instead.
The capability is never silently dropped; only its delivery changes.

**How the single sign-on works, and what it deliberately avoids.** The embedded browser is its own
profile under `%LOCALAPPDATA%`, so it starts with no session and two people sharing a PC never
share one. The agent asks the server for a short-lived Firebase custom token
(`POST /api/windows-agent/erp-session`, which requires both the device credential and a valid user
token, and mints the token for the uid in *that* token — never for anything in the request body).
It injects it with `AddScriptToExecuteOnDocumentCreatedAsync`, which runs before the document
exists, and `/auth/agent` exchanges it for a real session.

It is not in the URL. A custom token is a bearer credential for an hour; in a query string it
would land in browser history, in the `Referer` of the first outbound request, and in the access
log of everything in between.

## 7b. Closing the agent

The tray menu has **Exit**, and choosing it asks for administrator approval. An administrator
consents; anyone else gets a credential prompt and can fetch IT. Cancelling leaves the agent
running, and the attempt is recorded in the agent log either way.

This is Windows' own elevation prompt, not a password box the agent drew — which matters, because
a dialog an application invents can be answered by anything that can send it keystrokes. It is the
same reasoning as §7: the agent asks Windows to enforce things Windows is good at enforcing, and
does not pretend to be a security boundary it is not.

The agent is still an ordinary user-mode process, so Task Manager can end it. That is stated in
§7 and has not changed. What Exit adds is that the obvious, discoverable way to close it needs
somebody with administrator rights, so it does not happen by accident on the way out at 5 p.m.

---

## 8. Staged rollout

Do not switch on the access gate fleet-wide. The default policy has it **off**, which is
deliberate: the first stage is monitoring, and enforcement comes only after the recovery path has
been proven on real machines.

| Stage | Scope | Gate | What you are checking |
|---|---|---|---|
| 1 | One test PC | off | Enrolment, heartbeat, activity appearing in reports, TLS on the oldest OS you have |
| 2 | 5 pilot users | off | A full working day looks right; notifications arrive and deep-link correctly |
| 3 | One department | off | Report figures are believable to that department's manager; agent health is clean |
| 4 | Several departments | off | Firestore cost and index performance at scale |
| 5 | Company | off | Monitoring established and understood |
| 6 | Pilot PCs first | **on** | The gate, and the recovery shortcut, on machines you can physically reach |

Use the device **update ring** (Pilot / Early / Broad / Held) to stage agent versions the same way.

---

## 9. Talking to employees about it

This system records what people do on their computers, and how it is introduced matters as much as
how it is configured. Three things the software does to help:

- **`/windows-agent/monitoring-policy`** is open to every signed-in user, with no permission
  required. It lists what is collected and what never is. Those lists are compiled into the code,
  not editable content — so the page cannot come to disagree with what the software does.
- **`/windows-agent/my-activity`** shows an employee exactly what their manager sees, down to the
  timeline. Not a softened summary. It needs no grant; you can switch it off, but you have to
  decide to.
- **Agent status** in the tray shows, on the machine itself, which optional captures are switched
  on for that PC.

Two things the software deliberately refuses to do, and that you should not work around:

- **No productivity score, rating or ranking.** Application categories describe software, not
  people. The department report is sorted alphabetically on purpose: site teams and estimators
  spend their days very differently, and computer time is not output.
- **No judgement in the defaults.** A browser is `REFERENCE` because that describes the program.
  Whether a given hour in it was work is a question for a manager, not a lookup table.

`MeasurementNotice` appears on every screen showing another person's activity, saying so.

---

## 10. Data, cost and retention

The agent coalesces foreground changes locally and uploads every 2–5 minutes. At default settings,
per PC per working day: roughly 90 heartbeat writes (one document, overwritten), ~20 batch
uploads, and a few hundred span documents.

| Collection | Written by | Retention |
|---|---|---|
| `windowsActivityEvents` | Ingest | **Deleted** after `rawActivityRetentionDays` (default 90) |
| `windowsDailyActivity` | Ingest | Kept — this is what reports read |
| `windowsSessions` | Login / logout / reaper | Kept |
| `windowsApplicationUsage` | Ingest | Kept |
| `windowsHeartbeats` | Heartbeat | One document per device, overwritten |
| `windowsAuditLogs` | Admin actions | Permanent, append-only |

Only the raw spans are ever purged. That is the deliberate split: "how many hours did the site
office work last March" stays answerable indefinitely, while "which window was open at 14:32 on the
11th" — the intrusive record with no lasting business purpose — does not.

---

## 11. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Agent never appears | Service not running, or not enrolled. Check the Application event log, source `SELLiveAgent`, then `--check`. |
| "This computer is not enrolled" | No `device.json`, or DPAPI cannot decrypt it (cloned image). `--reset-identity` and restart. |
| "Awaiting administrator approval" | The enrolment code has `autoApprove` off. Approve it on the device page. |
| Nothing syncs, no error visible | TLS 1.2 on Windows 7. Run `--check`. |
| Live board shows somebody offline who is working | No heartbeat for three intervals. Check the queue count on their device page. |
| Notifications never appear on Win 10/11 | No Start Menu shortcut (hand-copied install), so toast activation cannot register. The agent falls back to its own popup; Agent status says which is in use. |
| A report is empty and the console shows a Firestore link | A composite index is missing. Deploy `firestore.indexes.json`. |
| A report is empty and the console says "permission denied" | The rules have not been adopted into the console ruleset. See §4.2. |
| Hours look too low | Check whether the day contains locked or idle time — the buckets always sum to the session. Idle inside an application is idle, not use. |
| A logout time is marked "est." | The session ended without a sign-out; the time is the last heartbeat, not an observation. Usually a power cut. |
| SEL LIVE opens in the browser, not in the agent window | The WebView2 runtime is missing or blocked. Expected on Windows 7 and 8.1; elsewhere, install it or re-run the setup. Agent status names the mode in use. |
| The ERP window opens on the login page | The custom token was refused. The device may have been blocked, or the PC's clock is wrong — a token is rejected if the machine's time is far from the server's. The window still works; sign in manually. |
| Setup .exe appears to do nothing when double-clicked | The licence file baked into it is not valid RTF, and the licence page is the first thing shown. Check with `(Get-Content windows/SEL.Agent.Installer/License.rtf -Raw).StartsWith('{\rtf1')`. |
| Setup asks for a password and the user has none | Intended. Only an administrator can install it. §5. |

Agent log: **Agent status → Activity log** in the tray (always in memory). File logging is off by
default because the log names the applications somebody used; enable `verboseLogging` in
`%ProgramData%\SEL LIVE\Agent\agent.config.json` only while investigating.

---

## 12. Known gaps

Stated so nobody discovers them during a rollout.

- **The access gate is not enforcement.** §7. Shell Launcher on Enterprise SKUs is the supported
  route and is not automated here.
- **`View Department` is not enforced by the Firestore rules**, only by the queries. Rules cannot
  look up a user's department during a list. See the note above `canReadWindowsActivity` in
  `firestore.rules` for the workaround.
- **Browser domain tracking needs a managed browser extension** that is not part of this work. The
  policy switch and the server-side handling exist; nothing populates it yet.
- **Office document-level activity** (which file, opened when) would need an Office add-in. §13 of
  the brief anticipated this. Foreground time per Office application works today.
- **No reporting line is modelled** in this database, so `View Team` resolves to the viewer's own
  department members.
- **Auto-update downloads and verifies but does not self-install.** The version check, hash and
  signature verification are implemented; running the installer unattended is left to your
  existing software-deployment tooling, which is better at it and already has the rollback story.
- **The setup .exe needs internet for WebView2, though not for .NET.** The framework is embedded
  in full; WebView2 ships as its 2 MB downloader, because the offline runtime is 188 MB and the
  feature it enables has a working fallback. An air-gapped site either builds with
  `-OfflineWebView2` or accepts that SEL LIVE opens in the browser there. §5.
