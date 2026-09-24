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
| Time per website, by host — optional, off by default | The browser address bar, read through the accessibility API |
| Which document is open, by name — optional, off by default | The window title of a known document application |
| Whether the keyboard and mouse are in use | `GetLastInputInfo` |
| Lock, unlock, sleep, resume, logoff, shutdown | `SystemEvents.SessionSwitch` / `PowerModeChanged` |
| Sign-in and sign-out times, per computer | The agent's own session, opened against the ERP |
| ERP actions — what was opened, approved, updated | The existing `userLogs` trail, unchanged |

It also shows desktop notifications from SEL LIVE, and clicking one opens the exact record — in a
SEL LIVE window inside the agent, already signed in as the person who signed in to the agent, or
in their own browser where that window is not available (§7a).

**What it does not do, and contains no code to do:** keystroke logging, password capture, clipboard
reading, message or document contents, screenshots, screen recording, webcam, microphone, or
browsing history. Window titles, website domains and document names are *optional* and **off by
default**; all three are enforced server-side, so an agent that sent them under a policy that
forbids them would have them discarded at ingest rather than stored.

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
| Admin-gated exit | `windows/SEL.Agent/ExitApprovalWindow.xaml{,.cs}`, and `src/app/api/windows-agent/exit-approval/route.ts` at the other end |
| Idle lock | `windows/SEL.Agent.Core/Session/IdleLockPlanner.cs` (the rules, tested), `windows/SEL.Agent/SessionLifecycleController.cs` (the timer and windows) |
| Websites and documents | `windows/SEL.Agent.Core/Tracking/BrowserDomainRules.cs`, `DocumentNameRules.cs` (the rules, tested), `Platform/Win32/BrowserAddressBarReader.cs` (the accessibility read), `buildDetailBreakdown` in `windows-agent-rules.ts` (the report) |
| How it starts | `windows/SEL.Agent.Service/LogonTask.cs` (the scheduled task), `SelAgentService.cs` (the watchdog), `SessionLauncher.cs` (launching into a session) |
| How it is stopped | `SEL.Agent.Core/Security/ServiceSecurityRules.cs` (the descriptor, tested), `SEL.Agent.Service/ServiceProtection.cs` (applying it), `ControlPipe.cs` with `SEL.Agent/ServiceControlClient.cs` (the approved stop) |
| Start-up diagnostics | `windows/SEL.Agent/StartupTrace.cs` → `%ProgramData%\SEL LIVE\Agent\startup.log`, always on |
| Installer | `windows/SEL.Agent.Installer/Package.wxs` (the MSI), `Bundle.wxs` (the setup .exe), `build.ps1` (both) |
| Tests | `tests/windows-agent-domain.test.mjs`, `windows/SEL.Agent.Tests` |

```
npm run test:windows-agent          # 61 domain tests
npm run typecheck:windows-agent
dotnet test windows/SEL.Agent.Tests # 176 agent tests, including the control pipe against a real named pipe
```

### How the agent starts, and why it cannot be switched off

Two mechanisms, and neither is a Run key any more.

| | |
|---|---|
| **A scheduled task** | `SEL LIVE Agent`, a logon trigger with no delay, principal `BUILTIN\Users`, registered by the installer. Runs as whoever signs in, in their own session |
| **The service watchdog** | Checks every **30 seconds** that an agent is running in each active session, and starts one if not. First check 3 seconds after the service starts |

**Why the Run key had to go.** `HKLM\...\CurrentVersion\Run` appears in Task Manager's "Startup
apps" tab and in Settings → Apps → Startup, each with a switch beside it. On a PC whose user is a
local administrator — most of this fleet — anybody could turn the agent off before it ever ran,
and the machine afterwards gave no sign that anything was missing. It simply recorded nothing. A
scheduled task appears in neither list, and cannot be disabled, edited or deleted without
administrative rights.

It is also the answer to "why does the agent take so long to appear?". Explorer defers Run entries
until the desktop is built and then adds a delay of its own — ten to thirty seconds of somebody
already working while nothing is watching. A logon trigger runs as the session starts.

The task is **not hidden** from Task Scheduler, deliberately, and its description says what it
does. The protection is Windows permissions, not concealment.

### When the agent does not start

`%ProgramData%\SEL LIVE\Agent\startup.log` says how far it got. It is **always written**, unlike
`agent.log`, because it contains only process facts and start-up milestones — no window titles, no
application names, nothing observed about the person using the PC — which is what makes it safe to
leave on permanently:

```
10:37:18.266  ---- start: pid 476, session 1, 1.0.0, launched by taskeng (pid 5312), 32-bit
10:37:18.267  single-instance mutex acquired
10:37:18.279  configuration: usable, pointing at https://seltech.store
10:37:19.207  host constructed
10:37:19.239  tray icon shown; start-up complete
```

The `launched by` field is the one that earns its place: the scheduled task, the service watchdog
and a person double-clicking the icon fail in different ways, and this says which one asked.

The service's event-log entry now carries the agent's **exit code** when a launch does not survive,
which is the difference between a diagnosis and a guess:

| Exit code | Means |
|---|---|
| `0` | The agent shut itself down deliberately — another copy already running, or a configuration it could not use. `startup.log` names which |
| Above `0xC0000000` | **Windows** terminated it: a job-object limit, a blocked executable, a missing dependency. Nothing appears in the agent's own log, because it never ran |
| Anything else | The agent's own failure exit; `startup.log` has the reason |

> **This mattered on a real machine.** The service was launching the agent every minute and logging
> "started … but exited within 3s", for weeks. The agent was fine — it ran perfectly when Explorer
> started it from the Run key — but every service launch died in about sixty milliseconds, before
> it could create its own mutex, with no crash report, because the child had inherited the
> service's job object. `CREATE_BREAKAWAY_FROM_JOB` fixes it; the exit code and `startup.log` are
> what make the next one of these a five-minute problem instead of a morning's.

The watchdog also no longer gives up. It used to stop trying for ten minutes after three failures —
ten minutes of a PC recording nothing, repeated all day, on exactly the machines already broken.
Now the interval stretches (30s → 2 min → 10 min) and stays there, so a machine that can be fixed
by retrying is fixed in two minutes and one that cannot costs six log entries an hour.

### Time per website, and which document was open

Both are **off by default** and each has its own switch on `/windows-agent/policies`. With them
on, one person's day reads:

```
Applications      Google Chrome      2h 10m
                  Microsoft Excel    1h 35m

Websites          seltech.store      55m   42% of browsing · 6 visits
                  drive.google.com   25m   19% of browsing · 3 visits

Documents         Q3 Budget.xlsx     48m   Microsoft Excel · 2 spells
                  Rate Analysis.xlsx 22m   Microsoft Excel · 1 spell
```

| Setting | What it collects |
|---|---|
| `browserDomainTrackingEnabled` | The **host** of the page in front of a browser. Chrome, Edge, Firefox, Brave, Opera, Vivaldi, IE |
| `documentNameTrackingEnabled` | The **file name** open in Excel, Word, PowerPoint, Access, OneNote, Visio, Project, AutoCAD, Acrobat, Notepad, WordPad, LibreOffice |

**How the website is read, since there is no extension.** Through the accessibility API — the same
way a screen reader learns what is on screen. The agent asks the browser window for its address
bar and passes the value straight through `BrowserDomainRules.HostOf`, which returns a host or
nothing. Measured on a real Chrome window, the tree walk takes **14 ms**, and it only happens when
the window title changes, because the title is the active tab's title: an unchanged title means
the tab has not changed.

**Nothing but the host survives, structurally.** The path, the query, the fragment, the port and
any credentials are dropped inside that one function, and the raw value is never stored in a
field or a log. That is what keeps §N intact: `google.com`, never
`google.com/search?q=…` — the path of a search *is* the search. Anything that does not parse as
an absolute http(s) URL returns nothing, so a half-typed search phrase cannot leak, and
`chrome://settings`, `about:blank` and `localhost` are not websites.

**How the document is read.** From the window title of a known document application, and only
those — the title of an arbitrary window is a chat message or an email subject, which is why
Outlook and Teams are deliberately not on the list. Office decorates its titles and all of it is
stripped: `AutoSave •`, `[Read-Only]`, `[Compatibility Mode]`, `- Saved to OneDrive`. A file whose
own name contains ` - ` survives intact.

> **Expect names without extensions.** Verified against a real Excel on this build: a file opened
> as `Q3 Budget Probe.csv` has the window title `Q3 Budget Probe - Excel`, so the recorded name is
> `Q3 Budget Probe`. That is what the person sees in their own title bar. Getting the extension and
> the folder would mean COM automation into Excel, which can block on a modal dialog — not worth
> it for a suffix.

**Where the time comes from.** A span ends when the site or the document changes, not only when the
application does — switching tab raises no Windows event at all, so the tick re-samples what is in
front and the span builder splits on the detail. A null domain does not split a span, or every
moment of a page loading would produce a two-second row.

**Two gates, not one.** The agent collects nothing when the policy is off — no address bar is read,
no title is parsed — *and* the ingest route strips both fields when the effective policy forbids
them, exactly as it does window titles. The second gate is the one that matters: it does not
require trusting what an agent sends.

Document names are also sanitised server-side: a path is reduced to its last segment, so
`C:\Users\ashish\Personal\Resignation.docx` is stored as `Resignation.docx` — §13 asked which file,
not where somebody keeps their private folders.

### The lunch break

Configured on `/windows-agent/policies`, **on by default**, 13:00–13:45. It is the one optional
behaviour in this module that defaults to on, because an installation that has never opened that
screen still has lunch — and without a window, the hour everybody spends away from their desk is
reported as `UNEXPLAINED_IDLE`. A report that is wrong about the single most predictable thing in
the day is worse than one that says nothing.

| Setting | |
|---|---|
| `lunchBreakEnabled` | On by default |
| `lunchBreakStart` / `lunchBreakEnd` | `HH:mm`, organisation-local, the same clock as the workday |

**It is a claim, not a subtraction**, and that distinction is the whole design. The resolution
engine ranks `BREAK` below every kind of real work, so:

| What happened between 13:00 and 13:45 | What the day reports |
|---|---|
| Away from the desk | Break 45m |
| Locked the PC and went out | Break 45m — a break explains a lock |
| Worked in Excel 13:10–13:40 | Work 30m, break 15m |
| In a meeting 13:15–13:45 | Meeting 30m, break 15m |
| Agent not running | Nothing. A break cannot invent time that was never recorded |

Cutting the window out of the totals instead would take work away from whoever worked through it
and hide the fact that they did. This way nobody has to be granted an exception for being on the
phone at 13:30.

**It is not paid time.** `recordedWorkSeconds` excludes `BREAK`, so the window comes out of the
working-hours total as an unpaid break should — and is still reported on its own line rather than
quietly folded into anything.

Scoped like every other policy setting, so a site office on a different shift gets its own window
by department, user or device without touching the company default.

### Administrator directives, and why they expire

**Force sign-out** and **Force re-authentication** on the device page are stored as instants on the
device document — `forceSignOutAt`, `forceReauthAt` — because the server has no way to be told when
an agent has complied. Anything stored that way is delivered again on every heartbeat, so something
has to decide when the instruction is spent.

**The rule: a directive raised before the current session began is already satisfied.** "Sign this
user out" means the session that was running when somebody clicked it. If the person has signed in
since, that session is gone — by exactly the means the instruction demanded.

Enforced in both halves, deliberately:

| | |
|---|---|
| The agent | `DirectivePolicy.ShouldObey` compares the directive's instant with the session's login instant, both stamped by the server, so the PC's clock is not involved. Seven tests |
| The server | A login clears any flag older than itself. This is the half that matters for a fleet: it cures machines still running an older agent, without waiting for every one to be updated |

> **This was a live bug, and it looked like nothing to do with directives.** A force sign-out raised
> on one PC at 13:07 ended every subsequent login on it within about 250 milliseconds, for two
> days. Signing in worked, the session opened, and the tray then said "Not signed in — nothing is
> being recorded". The agent is supposed to remember which directives it has obeyed, but that
> memory is per-process — so a restart, a reinstall or a re-image starts with none — and it was
> additionally being cleared on every login, which is precisely when it was needed. The sessions
> are still in Firestore, four of them, each a quarter of a second long with `endReason:
> ADMIN_SIGNOUT`.

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

3. **Grant permissions.** In Access Management, the new `Windows Agent` module. Nobody holds any of
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

   Not an optional step. No computer can be onboarded without a code that this server accepts —
   see §5's install notes for what happens to a code it refuses.

6. **Make sure the server can mint sign-in tokens** — needed only by the embedded ERP window
   (§7a), and easy to miss because nothing else in SEL LIVE requires it.

   `createCustomToken` is the one Admin SDK call that has to *sign* a JWT. Firestore reads,
   Firestore writes and `verifyIdToken` all work with a credential that cannot sign, so a
   deployment can look completely healthy and still fail here. There are two ways to satisfy it
   and you need one:

   | | |
   |---|---|
   | A real service-account key | `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` present and well-formed. The SDK then signs locally. |
   | Application-default credentials | The runtime service account needs `roles/iam.serviceAccountTokenCreator` **on itself**, because the SDK falls back to Google's `signBlob` API. |

   On this installation *both* are now in place: the App Hosting runtime account
   (`firebase-app-hosting-compute@…`) holds Token Creator, and Secret Manager holds a correct
   key in `firebase-private-key` / `firebase-client-email` / `firebase-project-id`.

   > **Outstanding.** The App Hosting backend's own Environment configuration sets those three
   > as **plain values**, which override `apphosting.yaml`'s `secret:` references — and its
   > `FIREBASE_PRIVATE_KEY` is a 52-character fragment with no PEM header, which is why the
   > fallback was being used at all. Its `FIREBASE_CLIENT_EMAIL` also names a different service
   > account (`firebase-adminsdk-uc7tw@`) from the working one (`firebase-adminsdk-fbsvc@`).
   > Delete all three from Firebase console → App Hosting → the backend → Environment, and the
   > secrets take over on the next deploy. Until then the IAM grant is what makes it work.

   The symptom when neither is satisfied: `503 ERP_SESSION_UNAVAILABLE` from
   `/api/windows-agent/erp-session`, with `diagnostic: auth/insufficient-permission`. The agent
   degrades to opening the ERP's normal login page rather than failing.

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

**One thing needs to be typed: the enrolment code.** `APIBASEURL` defaults to
`https://seltech.store` and the installer fetches the Firebase configuration from that server
rather than carrying a copy, so the address and the key look after themselves. The code does not,
and the agent will not onboard a computer without one.

Pass it as `ENROLLMENTCODE` and the install is silent. Leave it out and the install still
succeeds, but the first person to use the PC gets the setup window asking for a code — which is
the right place for the question, because that is where somebody who can ring IT is standing.

**A code is checked with the server before it is accepted**, in both places it can be entered:

| Where | What happens to a code the server refuses |
|---|---|
| `ENROLLMENTCODE=` on the installer | The reason is written to the install log and the code is **not** written to disk. The install completes and the agent asks for a good one at first run |
| The agent's setup window | Refused on screen, with the server's reason, and nothing is saved. Save and start does nothing until a code is accepted |

Both go to `/api/windows-agent/device/check-code`, which answers without redeeming the code — so
running the installer twenty times on a bench does not consume twenty registrations.

The install is deliberately **not** failed by a bad code. Rolling back a deferred custom action
gives whoever is standing there "Setup failed" and puts the reason in an MSI log nobody opens,
while the agent's own window states it plainly and fixes it on the spot. A code that cannot be
*checked* — no network during the install — is kept and validated again before it is redeemed.

> **Deploy the server before rolling out this agent.** A server without
> `/api/windows-agent/device/register`'s companion `check-code` route answers 404, and an agent
> that treated that as a refusal would be unable to enrol anywhere. It does not: a 404 is read as
> "this server cannot check codes in advance", the code is kept, and registration validates it a
> few seconds later as it always has. So an agent ahead of its server still works — it just loses
> the early warning. Nothing is *less* strict: an invalid code cannot onboard a PC either way.

**Unattended — the one to use for a rollout.** GPO, SCCM, or a script:

```
SEL.Agent-Setup-1.0.0.0.exe /quiet ENROLLMENTCODE=SEL-HO-2026
```

```
SEL.Agent-Setup-1.0.0.0.exe /uninstall /quiet
SEL.Agent-Setup-1.0.0.0.exe /log setup.log        (when it goes wrong)
```

The enrolment code is the only value worth passing, and now the one that matters: without it the
PC is installed but not registered, and it records nothing until somebody enters one.

**Pointing a pilot machine somewhere else:**

```
SEL.Agent-Setup-1.0.0.0.exe /quiet ^
  APIBASEURL=https://staging.example.com ^
  ENROLLMENTCODE=SEL-DEV-LOCAL
```

Or on a PC that is already installed, without reinstalling:

```
"C:\Program Files\SEL LIVE\Agent\SEL.Agent.Service.exe" --write-config --url https://staging.example.com
```

`FIREBASEAPIKEY` may also be passed but should not be. It is the same public value the web app
already ships to every browser, it authorises nothing on its own, and the server hands it out on
request — the one time it was written down separately, the copy went stale and every agent
configured from it got a key Google rejects.

> **Where the default lives.** `windows/SEL.Agent.Core/SelLiveDeployment.cs`, alongside the same
> judgement made on the web side in `src/lib/firebase-public-config.ts`. Change it in one place
> and rebuild; it is a default, not a constraint, and every layer above it can override.

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

While it is on screen and `requireMorningLogin` is on, it also:

| | |
|---|---|
| Suppresses the shortcuts out of it | Windows key (either), Alt+Tab, Alt+Esc, Ctrl+Esc, Ctrl+Shift+Esc, Alt+F4 |
| Covers every other monitor | Plain dark panels, so a second screen is not a working desktop |
| Hides the taskbar | A full-screen topmost window covers it, and Win and Ctrl+Esc no longer summon it |
| Offers nothing but the sign-in | Tasks, Approvals, Meetings and Open SEL LIVE appear only *after* signing in |

Ordinary typing is untouched — including plain Tab between the two fields, Shift for capitals and
Ctrl+V to paste a password.

> **The shortcut suppression is not keystroke capture.** It is a low-level keyboard hook, which is
> the same API a keylogger uses, so it is worth being exact: it compares a virtual-key code
> against a fixed list and answers swallow or pass. It has no field to store a key in, writes
> nothing anywhere, and the decision itself lives in `GateKeyPolicy` in Core with no I/O of any
> kind. The hook exists only while an enforcing gate is on screen and is removed the moment it
> closes. §12 is intact.

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
person at the keyboard. The nav strip has back, forward, reload and home, and nothing else.

**There is deliberately no "Open in browser".** It was there as an escape hatch, and it is the
wrong thing to offer once this window is the working session: with `lockOnErpWindowClose` on,
closing the window locks the PC, so a button that moves the ERP into Chrome hands somebody a way
to carry on working outside the window whose closure is supposed to end the session. The
arrangement only means anything if there is one way in.

Links the ERP opens with `target="_blank"` navigate in the same window for the same reason —
leaving those to the browser would have been the identical escape without the button.

The cost is real and worth stating: anything the embedded browser renders badly, or that needs a
password manager, now has no in-product way out. If that bites, the setting to reconsider is
`lockOnErpWindowClose` rather than reinstating the button.

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

**When there is no token, the window shows the login.** Nobody signed in to the agent means
nothing to hand over, and `/auth/agent` forwards to `/login` carrying the page that was being
opened, so signing in there lands where the person was going. It used to say "This page is
opened by the SEL LIVE desktop agent. There is nothing to do here" and stop — a dead end at the
one moment somebody needs a login. The same path covers a failed token mint (§4.6) and anyone
who bookmarks the URL.

## 7b. Closing the agent

The tray menu has **Exit**, and choosing it asks for a **SEL LIVE administrator** — a sign-in to
this application, not a Windows one. Cancelling leaves the agent running.

The permission checked is `Windows Agent / Devices / Edit`, the same one that already covers
blocking a device and forcing a re-authentication. Anyone who can block a PC outright can already
stop it reporting, so being able to close the agent on it grants nothing new.

**Why not a UAC prompt.** That was the first implementation and it asks the wrong question.
Windows can only tell you whether somebody is a local administrator on that PC — a fact about who
set the machine up. Plenty of employees are local administrators on their own laptop, and the HR
or IT staff who should actually be making this call often hold no Windows rights on it at all.
Whether an employee may stop their own attendance recording is an organisational decision, so it
is answered by the organisation's own roles.

**The server decides, not the agent.** The agent sends the administrator's sign-in to
`/api/windows-agent/exit-approval`, which needs the device credential *as well*, checks the
permission, and writes an `AGENT_EXIT_APPROVED` entry naming who approved it, on which computer,
and why. Had the agent evaluated the permission locally, the record would be a claim by the
machine whose user wanted it stopped.

Nothing about the administrator's session is kept: no refresh token is stored, the employee's own
agent session is untouched, and the token is discarded once the answer comes back. They approved
one action on one PC, not a sign-in.

**Two consequences worth knowing before a rollout:**

- **It needs the network.** An offline PC cannot get approval, so Exit will not work there. The
  recovery paths in §7 — stopping the service, Task Manager, blocking the device — all still do.
- **Grant the permission to somebody before you need it.** A fresh installation where nobody holds
  `Devices / Edit` has no one who can approve an exit. That is the same set of people who can
  administer the module at all, so in practice it is already granted; check it is.

The agent remains an ordinary user-mode process and Task Manager can still end it, exactly as §7
says. What this adds is that the obvious, discoverable way to close it produces an answer to "why
did this PC stop reporting at half past two" — and does not happen by accident on the way out at
5 p.m.

### Stopping the Windows service needs it too

Closing the agent needed approval and removing it needed approval, while anybody who could open
`services.msc` could press **Stop** and take the watchdog with it — wider than either, because the
service is what starts the agent at sign-in and what brings it back when somebody ends it from
Task Manager.

The installer now hardens the service's own security descriptor. Windows checks `SERVICE_STOP` in
the Service Control Manager, **before any of this agent's code runs**, so:

| | |
|---|---|
| Stop in services.msc | Greyed out. `sc stop SELLiveAgent` answers "Access is denied" |
| SYSTEM | Keeps every right, so upgrades and uninstalls still stop and remove the service normally |
| Administrators | Keep start, configure, delete — and `WRITE_DAC`, deliberately: the way back is one documented command |
| Everyone | Can still see the service and its state; monitoring tools are unaffected |

**The approved way to stop it** is **Shift + right-click the tray icon → Stop background service**.
That asks for the same `Devices / Edit` permission as Exit, and is recorded as
`AGENT_SERVICE_STOP_APPROVED` — a separate audit action, because closing the agent pauses recording
until the next sign-in while stopping the service removes the thing that would restart it.

**The agent does not decide, and cannot stop anything.** It collects the administrator's sign-in
and hands the token to the service over a local named pipe; the service asks
`/api/windows-agent/exit-approval` itself, with its own device credential, and stops only if the
server says yes. That distinction is the whole design: the agent runs as the very person whose
monitoring is being switched off, so its word is not what the service acts on. A caller who cannot
produce a real administrator's token gets a refusal, and an unreachable server is a refusal too —
otherwise the service could be stopped by pulling out the network cable.

**Recovery, for an administrator who needs the Stop button back:**

```
sc sdset SELLiveAgent "D:(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWLOCRRC;;;IU)(A;;CCLCSWLOCRRC;;;SU)"
```

`SEL.Agent.Service.exe --check` reports whether the protection is on, because a machine where
somebody ran that command looks identical from the outside. Re-running the installer, or a repair,
puts it back.

### Who can approve, and where you set it

**`/windows-agent/policies` now lists them**, at the top of the page, beside the switch that makes
the question matter. Each name shows the role or grant it comes from, and any expiry.

All three approvals — closing the agent, removing it, stopping the service — check the same
permission: **`Windows Agent / Devices / Edit`**. It is deliberately the permission that already
covers blocking a device and forcing a re-authentication, because anyone who can block a PC can
already stop it reporting.

**To add people:** Settings → **Access Management**. Either grant a role that carries the
permission — the card names which roles do, so it is a role name rather than a hunt through role
documents — or grant `Windows Agent / Devices / Edit` directly to a person.

> **Grant it to at least two.** One approver is a single point of failure on the day they are on
> leave, and the failure mode is that nobody can close, remove or stop an agent anywhere in the
> company. The card says so in as many words when the list is empty, which is the state a fresh
> installation is in: the permission ships on a role, and a role with no holders approves nothing.

The list is computed server-side, by `/api/windows-agent/approvers`, and gated on
`Devices / View` rather than `Devices / Edit` — the person who most needs to know who can approve
is the one who cannot, and has to find somebody who can. It is a route rather than a query because
resolving it reads every user, role and access grant, and a Windows Agent administrator is usually
not permitted to read those; the browser receives a list of names rather than the organisation's
permission graph.

### Removing the agent needs the same approval

Closing the agent needed an administrator; uninstalling it needed nothing at all, and took two
clicks in Apps and Features. That gap is closed:

| | |
|---|---|
| Apps and Features | Shows the agent with **no Uninstall or Modify button** (`DisableRemove` on the bundle). The entry stays, so the fleet is still auditable from the PC |
| `setup.exe /uninstall` | Asks for a SEL LIVE administrator, the same `Devices / Edit` permission. Cancelling stops the uninstall with the machine untouched |
| `setup.exe /uninstall /quiet` as SYSTEM | Proceeds. No window can be shown in session 0, and a removal driven by SCCM or GPO must not hang waiting for a click nobody can see |
| An unanswered prompt | Refused after three minutes, rather than leaving msiexec waiting for ever |

Approval is recorded as `AGENT_UNINSTALL_APPROVED`, deliberately a different audit action from
`AGENT_EXIT_APPROVED`. Closing the agent pauses recording until the next sign-in; removing it ends
recording on that computer, and afterwards the PC is indistinguishable from one that was never
enrolled. "Why has this machine no data since March" needs those two to be distinguishable.

Two exemptions, both intentional: a PC that is **not enrolled** and a PC that **cannot reach SEL
LIVE** are allowed through. Blocking there would mean a machine with a dead link, or one that was
never registered, could not have a broken agent removed without a re-image.

> **This is deterrence, not enforcement**, and the distinction is the same one §7 makes about the
> access gate. A local administrator can stop the service and delete the folder, and nothing here
> pretends otherwise. What it removes is the casual route — two clicks, no record — and what it
> adds is a name in the audit trail beside every PC that legitimately stopped being monitored.

---

## 7c. The tray icon

**Left-click** opens SEL LIVE. **Right-click** gives three items and a status line:

```text
Debaprasad Bhoi — Working
─────────────────────────
Open SEL LIVE
─────────────────────────
Sign out
Exit
```

That is the whole menu an employee sees. It used to also carry My work, Tasks, Approvals and
Meetings — every one of them a shortcut to a page of SEL LIVE that "Open SEL LIVE" already
reaches, and that the ERP's own navigation lists better. A second, worse menu for the
application, kept in step by hand, in the one place nobody looks for navigation.

The status line names who is signed in, because signing in as the wrong person is otherwise
invisible until a timesheet is wrong. It deliberately does *not* name the program they are
currently using: telling somebody which window they are looking at, on their own screen, informs
nobody and reads like being watched. The icon's hover tooltip still carries it, for support.

**Shift + right-click** adds the support tools:

```text
Sync now
Agent status
Monitoring policy
```

Shift-to-reveal is Explorer's own convention, so it is discoverable to the people who would
think to try it and invisible to everyone else. `Agent status` in particular has to stay
reachable: its activity log is held in memory and is not written to disk unless `verboseLogging`
is on, so dropping the item outright would have made the agent's own log unavailable at exactly
the moment somebody is working out why it misbehaved.

`Pause tracking` appears in the ordinary menu when — and only when — `allowUserPauseTracking` is
on. It is off by default, so normally the menu really is three items.

---

## 7d. Locking an unattended PC

Three settings, all **off or generous by default**, that together make the SEL LIVE sign-in the
way into a working session. Set them per company, department, user or device like any other
policy, on `/windows-agent/policies`.

| Setting | Default | What it does |
|---|---|---|
| `lockOnIdleEnabled` | off | After `idleLockSeconds` with no input, a countdown appears; `idleLockWarningSeconds` later the PC locks |
| `idleLockSeconds` | 600 | Ten minutes. Minimum 120 |
| `idleLockWarningSeconds` | 60 | How long "Are you still working?" stays up. Any key or mouse movement cancels it. Minimum 15 |
| `lockOnErpWindowClose` | off | Closing the embedded SEL LIVE window locks the PC, and the window opens automatically at sign-in |
| `lockOnSignOut` | off | Signing out of SEL LIVE locks the PC |
| `reauthAfterLockSeconds` | 1800 | Locked longer than this, and unlocking Windows also needs a SEL LIVE sign-in. Zero asks every time |

### "You must sign in to SEL LIVE to use this PC"

That is not one switch. It is three, and they do different jobs:

| | |
|---|---|
| `requireMorningLogin` | Makes the sign-in window **mandatory** instead of dismissible. Without it the gate appears and can be closed, and the person carries on working with nothing recorded |
| `lockOnSignOut` | Closes the other way out. Signing out otherwise leaves somebody at an unlocked desktop that records nothing — the only route to working unmonitored that needs no administrator, no Task Manager and no particular knowledge |
| `lockOnIdleEnabled` | Covers walking away without signing out |

Switch on only `requireMorningLogin` and Sign out is a bypass. Switch on only `lockOnSignOut`
and the gate can be dismissed. They are listed separately because an installation may genuinely
want one without the other, but "must sign in to use the PC" needs the first two together.

**Locking means `LockWorkStation`** — the ordinary Windows lock screen, the same thing Win+L
does. The person clears it with their own Windows password; nothing the agent holds is involved
in getting back in. Ctrl+Alt+Delete still works from it, the account can still be switched, and
an administrator can still sign in. This is not a second authentication surface the agent
invented, and §7's position that the agent is not a security boundary is unchanged.

**The warning does not steal focus.** It appears exactly when somebody has stopped typing, and
the most likely next event is that they start again — into whatever they were working in. A
window that grabbed the keyboard at that moment would swallow the first few characters of the
sentence that proves they are still there.

**`idleLockSeconds` is not `idleThresholdSeconds`.** The latter only classifies recorded time
and never acts on anything. They are deliberately separate: one number deciding both what a
timesheet says and when somebody's screen goes dark could not be tuned for either, and the first
administrator to lengthen the idle threshold so that long meetings stopped showing as idle would
also, silently, have stopped PCs locking.

**Nothing locks while nobody is signed in.** A signed-out agent has no session to protect, and
locking the machine of somebody who never signed in to SEL LIVE would be the agent interfering
with a PC it has no business interfering with. The access gate covers that case.

**Closing the window is distinguished from the agent closing it.** Signing out closes the ERP
window, and so does shutting the agent down for an update. Neither locks the PC — only a person
clicking the X does.

### Before switching any of this on

Read §8. These are the settings that can stop somebody working, so the same staged rollout
applies as for the access gate: prove the agent, the sign-in and the recovery shortcut on pilot
machines first.

`lockOnErpWindowClose` deserves particular thought. With it on, a misplaced click on the X costs
somebody their unlocked desktop — which is the intended behaviour when that window *is* the
working session, and an irritation everywhere else.

---

## 7e. Work calls, on the phone

A site engineer's afternoon is mostly phone calls. None of that was reaching the timeline: the
desktop agent sees a PC, and somebody standing in a stairwell talking to a supplier looks exactly
like somebody who went home. `/work-calls` is the screen that closes that gap.

It is a page in this web app, not a native screen. The SEL LIVE Android application loads
`https://seltech.store` in a Capacitor shell, so a route here already *is* a screen in the app —
no plugin, no release, no store review to ship a change to it. Dialling is a `tel:` link, which
needs no permission and behaves the same way on every Android version back to the ones still in
the field.

### What it does not do, and why that is not a shortcut

It does not read the Android call log, and it never will from this codebase. `READ_CALL_LOG` is
restricted to apps the user has set as their default dialer; Play Store review rejects it
otherwise, and an ERP is not a dialer. So there is no supported way for this app to be *told* that
a call connected or how long it lasted.

It also does not record audio, either side, ever — §T of the brief, and not a limitation anybody
should be trying to work around.

What remains is the honest option: the app records the dial, and when it comes back into the
foreground it asks.

### The flow

1. Search the work directory — by name, company, designation, or by typing the number itself,
   because that is what somebody holding a scrap of paper actually does.
2. Optionally say what the call is about. Asked *before* dialling, because nobody types it
   afterwards.
3. The dial is recorded server-side, then the `tel:` link hands over to the phone. In that order:
   once the dialer is in front, this page may be suspended and gets no further chance to say
   anything.
4. The app becoming visible again brings up one question — *did the call happen?* — with the
   elapsed time already filled in.

Opening the page also picks up any call still sitting in `DIALLED`. That is not a nicety: Android
routinely kills a backgrounded web view, which is the single most likely thing to happen while
the dialer is in front. Without that step the call would be lost — the employee made it, and
nothing would ever ask them about it.

| Endpoint | Does |
|---|---|
| `GET /api/work-calls/contacts` | Search the directory. Any signed-in employee |
| `POST /api/work-calls/contacts` | Add or edit a contact. `Devices / Edit` |
| `POST /api/work-calls/start` | Record a dial. Server-stamped time and `workDate` |
| `POST /api/work-calls/end` | Confirm or cancel. Applies the duration rules |
| `GET /api/work-calls/today` | The caller's own day, and anything left unconfirmed |

### What each state is worth

| State | Means | Counted as work time |
|---|---|---|
| `DIALLED` | The number went to the dialer. Nothing else is known yet | **No** |
| `COMPLETED` | The employee confirmed the call happened | Yes, for the confirmed duration |
| `CANCELLED` | The employee said it did not connect | No |
| `NOT_CONFIRMED` | Confirmed, but the duration failed the rules below | No — the record is kept, with the reason |

**An unconfirmed dial is worth nothing at all.** That is the whole design, so it is worth being
explicit about the alternative: treating "away from the app for nineteen minutes" as a
nineteen-minute call. That would be a guess presented as a measurement, and it would be wrong
every time somebody left a voicemail and went to lunch. Because unconfirmed time is not counted,
confirming is worth the employee's two seconds — which is the only thing that keeps the data
truthful.

There is deliberately **no `CONNECTED` state**. Nothing in this system can observe a connection,
so there is no state to represent one.

### Duration rules

Applied server-side in `endCall`, never by the phone. A client that could send its own figure
would make all of this advisory.

| Rule | Value | Why |
|---|---|---|
| Minimum | 5 seconds | Below that it is a misdial, and it is stored as `CANCELLED` |
| Maximum | 4 hours | An app left in the background overnight and reopened the next morning becomes `NOT_CONFIRMED`, not an eighteen-hour call |
| Source | `RETURN_TO_APP` or `MANUAL` | Recorded on the row, so a report can tell a measured gap from a typed number |

Times are stamped by the server, not the handset. A phone with a wrong clock would otherwise put
a call in yesterday's timeline.

### How it reaches the timeline

`callsToActivityClaims` turns confirmed calls into `WORK_CALL` claims for the resolution engine
(§X), which is what stops a call being double-counted against desktop activity in the same
minutes — see `src/lib/work-activity-resolution.ts` and the priority table there. The claim's
length comes from the confirmed duration, never from `endedAt`, so the timeline cannot disagree
with the totals.

`tests/work-calls.test.mjs` covers this end to end with the brief's own §U example: a confirmed
call turns nineteen otherwise-idle minutes into work; the same dial left unconfirmed leaves them
`UNEXPLAINED_IDLE`.

### Administering the directory

| | |
|---|---|
| Reading it | Any signed-in employee. It is the list of site managers and clients people have to ring; hiding it behind an administrative permission is how a directory ends up back in everybody's personal contacts |
| Adding and editing | `Windows Agent / Devices / Edit` — not a permission of its own, because a new permission node starts out granted to nobody and on day one not a single person could add the first contact |
| Duplicates | Refused. A second contact with the same number gets a 409 naming the existing one — three spellings of one site manager is the normal failure here, not an unlikely one |

Reading somebody else's calls needs the same permission as reading their desktop activity. A call
log says who an employee has been talking to, which is no less revealing than what they have had
on screen.

### Before this works in production

`workContacts` and `workCalls` blocks have been added to `firestore.rules`, and the `workCalls`
composite indexes to `firestore.indexes.json`. Both still need adopting the way §4 describes —
the rules file is not wired into `firebase.json`, so the blocks have to be copied into the console
ruleset. Until the indexes exist, `callsForDay` fails with an index-required error rather than
returning nothing, which at least says so plainly.

Neither collection is client-writable. Every write goes through `/api/work-calls/*`.

---

## 7f. Releasing an update from your end

Publish a build in SEL LIVE and the fleet installs it. Nobody visits a PC.

```
1. Build       pwsh windows/SEL.Agent.Installer/build.ps1 -Sign -CertificateThumbprint <yours>
2. Host it     anywhere over https
3. Publish     /windows-agent/versions — version, packageUrl, packageSha256,
               signatureSubject, and the rings it is released to
4. Wait        each PC checks 15 minutes after its service starts, then every 6 hours
```

**The service does the updating, not the desktop agent**, and all three reasons point the same
way: it runs as SYSTEM so there is no UAC prompt, it runs whether or not anybody is signed in,
and it is the component that survives the agent being replaced underneath it. It asks
`/api/windows-agent/version` with its own device credential rather than taking a URL from the
agent — otherwise a process running as the signed-in user would be handing SYSTEM something to
execute.

**Before anything runs, two checks, both mandatory:**

| | |
|---|---|
| SHA-256 | Must equal what SEL LIVE published. This is what defends against a compromised package host: the hash arrives over an authenticated connection, the file does not |
| Authenticode | `WinVerifyTrust` must pass *and* the certificate subject must contain what you published. Verified, not merely read — `CreateFromSignedFile` happily returns the signer of a forged file |

A machine behind a proxy that blocks CRL endpoints re-verifies without revocation checking and
says so in the log. The signature and the signer are still proved; only "has this certificate
been revoked since" goes unanswered, and refusing every update for a check that could not be
*performed* would disable auto-update exactly where it is most needed.

**The install is handed to the Task Scheduler**, as a one-shot SYSTEM task two minutes out that
deletes itself afterwards. The installer's first act is to stop `SELLiveAgent` — and a process
started by the service belongs to the service's job object, so running it directly would kill the
installer half way through replacing its own files. The same lesson as
`CREATE_BREAKAWAY_FROM_JOB` in the session launcher, applied before it cost a second morning.

**Two things throttle it.** The first check waits fifteen minutes after the service starts, plus
up to an hour of jitter — four hundred machines switched on within ten minutes of each other
would otherwise all pull a 120 MB installer at once, which is a self-inflicted outage of the
office link. And `autoUpdateEnabled` is applied by the *server*, in the version route, because
the service has no user session and therefore no policy to read.

> **You need a code-signing certificate.** The version route refuses to offer any package without
> a `signatureSubject`, so with today's unsigned builds **nothing will ever be offered** and the
> fleet will stay where it is. That rule is deliberate — whoever controls the package URL
> otherwise controls code execution as SYSTEM on every office PC — and it predates this work.
> An OV code-signing certificate is the unblock. If you would rather accept unsigned packages,
> that is a one-line change in `src/app/api/windows-agent/version/route.ts`, and it should be a
> decision you make knowingly rather than one I make for you.

A mandatory build — one below `minimumSupportedVersion` — is offered even to a device whose ring
is `HELD` and even where `autoUpdateEnabled` is off, and the log says it overrode the policy.
Switching auto-update off is a statement about routine releases, not about a security fix.

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
- **Agent status** shows, on the machine itself, which optional captures are switched on for that
  PC. Reached with **Shift + right-click** on the tray icon (§7c), alongside the same Monitoring
  policy page the ERP serves.

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
| The setup window appears on a PC that was already installed | The agent has no device credential and no usable code — an install without `ENROLLMENTCODE`, or a code that has since expired, been disabled or been used up. The window names which. |
| Sign-in succeeds, then the tray immediately says "Not signed in" | A force sign-out or force re-authentication left on the device. Check `forceSignOutAt` / `forceReauthAt` against `lastLoginAt` on the device document — a flag older than the last login used to fire on every login for ever. Fixed in both halves (see below); on an older agent against an older server, clear the field. |
| The agent takes ages to appear after signing in | Check `--check` for `Logon task : MISSING`. Without the task the service watchdog is doing the work, which is up to 30 seconds. Re-run the installer, or `--install-logon-task` from an elevated prompt. |
| The agent never appears at all | `%ProgramData%\SEL LIVE\Agent\startup.log`, then the event log's exit code. §3 has the table: 0 means the agent chose to exit, 0xC0000000-something means Windows stopped it before it ran. |
| "started the desktop agent … but it exited within 3s", repeatedly | Read the exit code in the same entry. Historically this was the service's job object killing the child; if it recurs with a 0xC0000000 code, look for AppLocker, WDAC or an antivirus blocking `SEL.Agent.exe` when it is launched by a service. |
| No Uninstall button in Apps and Features | Intended. Removal needs a SEL LIVE administrator's approval — run the setup .exe with `/uninstall`. §7b. |
| Stop is greyed out in services.msc, or `sc stop` says "Access is denied" | Intended. Use Shift + right-click the tray icon → Stop background service, which asks for the same approval. The recovery command is in §7b. |
| The service stopped and nobody pressed Stop | An approved stop went through the control pipe. `AGENT_SERVICE_STOP_APPROVED` in the audit log names who approved it and why. |
| "That enrolment code has reached its registration limit" | `maxRegistrations` is exhausted. Raise it, or issue a new code. The setup window warns when a code has three or fewer left, so this is usually avoidable. |
| "That enrolment code is not recognised" on a code that looks right | Check it against the enrolment codes page: it is a document id, so `SEL-HO-2026` and `SEL-H0-2026` are different codes and both look correct on paper. |
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

Agent log: **Shift + right-click the tray icon → Agent status → Activity log** (always in
memory). File logging is off by default because the log names the applications somebody used;
enable `verboseLogging` in `%ProgramData%\SEL LIVE\Agent\agent.config.json` only while
investigating.

---

## 12. Known gaps

Stated so nobody discovers them during a rollout.

- **The access gate is not enforcement.** §7. Shell Launcher on Enterprise SKUs is the supported
  route and is not automated here.
- **`View Department` is not enforced by the Firestore rules**, only by the queries. Rules cannot
  look up a user's department during a list. See the note above `canReadWindowsActivity` in
  `firestore.rules` for the workaround.
- ~~Browser domain tracking needs a managed browser extension~~ — **done**, without an extension:
  the address bar is read through the accessibility API. Host only. §3.
- ~~Office document-level activity would need an add-in~~ — **done** from the window title, which
  every Office version back to 2007 populates. Names only, and usually without the extension —
  see §3 for why that is not worth COM automation to fix.
- **No reporting line is modelled** in this database, so `View Team` resolves to the viewer's own
  department members.
- ~~Auto-update downloads and verifies but does not self-install~~ — **done**, and the claim it
  replaces was generous: nothing was downloaded and nothing was verified. The contract and the
  server side existed, the heartbeat delivered an available version, and no code anywhere acted
  on it. §7f.
- **The setup .exe needs internet for WebView2, though not for .NET.** The framework is embedded
  in full; WebView2 ships as its 2 MB downloader, because the offline runtime is 188 MB and the
  feature it enables has a working fallback. An air-gapped site either builds with
  `-OfflineWebView2` or accepts that SEL LIVE opens in the browser there. §5.
- **Work-call durations are employee-confirmed, not measured.** §7e. Android will not tell an ERP
  that a call connected, so there is no version of this feature that measures it. A dial nobody
  confirms counts as nothing, which is the honest outcome but does mean the figure depends on
  people answering one question.
- **There is no administrative screen for the work directory yet.** Contacts go in through
  `POST /api/work-calls/contacts`; the employee-facing search reads them. Somebody holding
  `Devices / Edit` still needs a form.
- **Work calls are not yet on the administrative reports.** The records exist, carry a `workDate`,
  and already feed the resolution engine, so an employee's own timeline counts them. The
  department and attendance reports do not break them out.
