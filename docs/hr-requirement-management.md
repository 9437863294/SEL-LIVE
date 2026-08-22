# HR Requirement Management — Manpower Requirement & Recruitment Control

The specification for SEL Live's HR module. Section numbers here are stable and are cited from the
code (`// spec section 37`, `control rule 63.4`), so **renumbering a section means updating the
citations**. Add new material as a new section rather than inserting one in the middle.

This module is deliberately not a "job vacancy page". It controls the complete lifecycle from
manpower demand to employee joining, and ends by creating the employee record — which is what makes
it a manpower-control system rather than an applicant tracker.

It integrates with Department, Project/Site, Employee Master, Payroll, Attendance, Document
Management and Notifications, and later with Performance/Probation.

---

## 1. Overall workflow

```text
Department / Project identifies manpower need
  → Create HR requirement
  → Headcount / budget validation
  → Approval workflow
  → Requirement approved
  → HR recruiter assigned
  → JD finalisation
  → Candidate sourcing / posting
  → HR screening
  → Technical / HOD interview
  → Final / management round
  → Candidate selection
  → Salary / CTC recommendation
  → Compensation approval (if required)
  → Offer letter
  → Candidate accept / reject
  → Pre-joining process
  → Documents / verification
  → Joining
  → Employee code creation
  → Onboarding / induction
  → Requirement quantity updated
  → Filled / Partially filled / Closed
```

## 2. Module structure

| Area | Purpose |
| --- | --- |
| HR Requirement Dashboard | Overall manpower status |
| Manpower Planning | Annual/monthly planned manpower |
| Requirement Register | All manpower requisitions |
| Create Requirement | New/replacement manpower request |
| Approval Inbox | Requirement approvals |
| Requirement Workspace | Complete control centre for each requirement |
| Recruitment Pipeline | Candidate movement against requirements |
| Candidate Database | Central applicant/talent database |
| Interview Management | Interview scheduling and evaluation |
| Selection Management | Selection and compensation proposal |
| Offer Management | Offer generation and acceptance |
| Pre-Joining | Document collection and verification |
| Joining Management | Convert candidate to employee |
| Agency/Vendor Management | Recruitment agencies |
| Talent Pool | Previously shortlisted candidates |
| Reports & Analytics | HR MIS |
| SLA & Escalation | Requirement aging monitoring |
| HR Requirement Settings | Complete configuration |

## 3. HR requirement dashboard

The dashboard answers management's question: **how many people do we need, where do we need them,
and what is stopping us from hiring them?**

KPI cards: Total open requirements, total positions required, positions filled, balance positions,
critical requirements, pending approval, recruitment in progress, offers released, joining awaited,
requirements over SLA, joining this month, offer rejections.

Filters: department, project, site, location, designation, grade, recruiter, requirement type,
priority, employment type, status, date range.

Charts: planned vs required vs joined; requirements by department; requirements by project;
requirement ageing; recruiter workload; hiring funnel; source effectiveness; offer acceptance %;
average time-to-hire; candidate joining conversion.

## 4. Manpower planning

Planning precedes individual requests. A plan row is (department × designation) with approved
strength, existing strength, planned additional and derived vacancy:

| Department | Designation | Approved strength | Existing | Planned additional | Vacancy |
| --- | --- | --: | --: | --: | --: |
| Projects | Project Manager | 12 | 9 | 2 | 5 |
| Electrical | Site Engineer | 35 | 27 | 5 | 13 |
| HR | HR Executive | 5 | 4 | 0 | 1 |

HR can prepare: FY manpower budget, department plan, project plan, new-project plan, replacement
forecast, retirement forecast, resignation-driven vacancies, approved organisation structure.

When a department raises a requirement the system checks this plan automatically (see §13 —
within-plan requirements take a shorter approval route than above-plan ones).

## 5. Create new requirement — step 1, requirement information

A wizard, not one long form.

| Field | Example |
| --- | --- |
| Requirement ID | HR-REQ-2026-00128 |
| Requirement date | 21-Aug-2026 |
| Department | Projects |
| Project | TPSODL Rayagada |
| Site | Rayagada |
| Requesting manager | Project Head |
| Requirement owner | Department HOD |

The requirement ID is system-generated; users never type one.

## 6. Requirement type

Standardised reasons: New position, Replacement, Additional manpower, Project requirement,
Temporary requirement, Contractual requirement, Expansion, Internal transfer replacement,
Emergency requirement, Management requirement.

Selecting **Replacement** reveals employee search and captures the outgoing employee:

```text
Replacement of:  ABC (E10023), Site Engineer
Current CTC:     ₹5,20,000
Reason:          Resignation
Last working:    31-Aug-2026
```

This connects directly to the Employee Exit module.

## 7. Position details

| Field | Requirement |
| --- | --- |
| Designation | Mandatory |
| Job title | Mandatory |
| Grade | Mandatory |
| Number required | Mandatory |
| Employment type | Permanent / Contract / Trainee etc. |
| Location | Mandatory |
| Project/Site | Conditional |
| Reporting to | Mandatory |
| Required joining date | Mandatory |
| Priority | Critical / High / Normal / Low |
| Shift | Optional |
| Travel requirement | Optional |
| Gender requirement | Only where legally/job justified |
| Age range | Configurable |
| Minimum experience | Mandatory |
| Maximum experience | Optional |
| Qualification | Mandatory |
| Specialisation | Optional |

## 8. Skills & experience

Captured as: primary skills, secondary skills, industry experience, project experience, technical
certification, software knowledge, equipment experience, communication skills, leadership skills,
mandatory skills, preferred skills.

Example (SEL): Project Manager, domain Transmission & Substation, mandatory 132KV-and-above project
experience, 10–15 years, skills — transmission line, substation, project planning, client
coordination, billing, contract management, manpower management, safety compliance.

This feeds the JD automatically (§17).

## 9. Salary & budget

The requesting department does not normally get unrestricted salary visibility. The requirement
carries: budgeted grade, budgeted CTC range, replacement employee CTC, maximum approved CTC, project
budget, cost centre, budget availability.

```text
Grade: M3   Approved range: ₹8L–₹12L   Expected CTC: ₹10L   Budget status: Available
```

When proposed CTC exceeds the band the system must say so and route accordingly:

> **CTC exceeds approved salary band by 14%. Additional compensation approval required.**

## 10. Requirement justification

Mandatory for new positions: business justification, current workload, project requirement, revenue
impact, client requirement, contractual manpower requirement, why existing manpower cannot absorb
the work, impact if the position stays vacant.

Attachments: client contract, BOQ, organisation chart, project schedule, approval note, resignation
document, management instruction.

## 11. Duplicate requirement detection

Before submission the system matches on **same department + same designation + same
location/project + open requirement** and warns:

> Similar manpower requirement HR-REQ-2026-00115 already exists with 3 vacancies.

Actions: **View existing**, **Link requirement**, **Continue with new requirement**.

## 12. Approval workflow

Never hard-coded. A configurable approval matrix drives the chain.

Replacement: Requesting manager → Department HOD → HR Head → Approved.

New manpower: Requesting manager → Department HOD → HR Head → Finance/Budget → Director → Approved.

Senior management: HOD → HR Head → Director HR → MD/ED → Approved.

## 13. Smart approval rules

| Condition | Approval |
| --- | --- |
| Replacement within approved salary | HOD + HR |
| Replacement with salary increase | HOD + HR + Finance/Director |
| New position | HOD + HR + Finance + Management |
| Project manpower within sanctioned plan | HOD + HR |
| Above sanctioned manpower | Director |
| Senior management | ED/MD |
| Critical hiring | Fast-track workflow |
| Contract manpower | HOD + HR + Project/Commercial |

All of it configurable from Settings.

## 14. Approval screen

An approver must see more than Approve/Reject: the requirement, department, project, required
quantity, existing department strength, sanctioned strength, current vacancies, expected CTC, annual
manpower cost, requirement reason, justification, required joining date, similar open requirements,
attachments and previous approval comments.

Actions: **Approve**, **Reject**, **Send back**, **Request clarification**, **Forward**,
**Delegate**, **Approve with condition**. Every action is stored in audit history (§57).

## 15. Requirement becomes an open vacancy

After final approval the requirement starts counting:

```text
Approved qty: 5   Filled: 0   Offered: 0   Joining awaited: 0   Balance: 5
```

The HR recruitment manager then assigns a primary recruiter, optional secondary recruiter and a
target closure date.

## 16. Requirement workspace

The most important screen in the module.

```text
HR-REQ-2026-00128 — Project Manager — TPSODL Rayagada
Required 3 · Joined 1 · Offered 1 · Balance 2
Priority HIGH · Age 17 days · Target 05-Sep-2026 · Recruiter XXXXX
```

Tabs: Overview, Job description, Candidates, Pipeline, Interviews, Selection, Offers, Joining,
Documents, Communication, Approvals, Activity log, Cost, Notes.

## 17. Job description management

A JD may be created manually, copied from the JD master, copied from a previous requirement,
AI-assisted, and is version controlled.

Structure: job title, purpose, responsibilities, qualification, experience, technical skills,
behavioural skills, location, reporting, travel, employment type, CTC range (internal only unless
explicitly published). The HOD may approve a JD before publishing.

## 18. Recruitment channel management

Channels: company career portal, employee referral, internal job posting, LinkedIn, Naukri, job
portals, recruitment agency, consultant, campus hiring, direct application, existing talent pool,
walk-in, social media.

Every candidate stores its **source**, which is what makes §53's source-effectiveness reporting
possible.

## 19. Candidate database

One **candidate master**; never a duplicate candidate per requirement.

Profile: candidate ID, name, mobile, email, current company, designation, location, total
experience, relevant experience, current CTC, expected CTC, notice period, qualification, skills,
resume, source, recruiter, previous interview history, previous rejection reason, and a controlled
do-not-hire flag where legitimately applicable.

## 20. Duplicate candidate detection

Match on mobile, email, PAN (where collected at an appropriate stage), and name + DOB as a secondary
signal:

```text
Candidate already exists.
Previous application: Site Engineer — rejected 15-Jun-2026 — experience mismatch
```

HR reuses the existing profile.

## 21. Candidate application

A candidate applies to many requirements through a separate **application** record
(candidate ↔ requirement), so candidate data is never duplicated:

```text
Candidate ABC → REQ-101 Project Manager · REQ-128 PM Rayagada · REQ-150 PM Karnataka
```

## 22. Recruitment pipeline

Kanban:

```text
NEW → SCREENING → SHORTLISTED → INTERVIEW ROUND 1 → INTERVIEW ROUND 2 → FINAL INTERVIEW
  → SELECTED → COMPENSATION APPROVAL → OFFERED → OFFER ACCEPTED → PRE-JOINING → JOINED
```

Side exits: Rejected, Candidate withdrawn, No response, On hold, Offer rejected, No show, Future
talent pool.

HR drags candidate cards between authorised stages only.

## 23. HR screening

Captures qualification match, experience match, skill match, current CTC, expected CTC, notice
period, location willingness, project/site willingness, reason for change, communication
assessment, interview availability, recruiter recommendation.

Result: Shortlist, Reject, Hold, Talent pool.

## 24. Interview management

HR selects candidate, requirement, interview round, interviewers, mode, date, time and
location/video link.

Rounds: HR round, technical round, project head round, functional round, director round, final
round.

## 25. Interviewer dashboard

Interviewers get a **My Interviews** screen showing only the candidate information relevant to them.

Feedback form, each 1–5: technical knowledge, relevant experience, problem solving, communication,
leadership, role suitability, culture/behaviour. Recommendation: Strong hire, Hire, Hold, Not
recommended. Comments are mandatory for a rejection.

## 26. Interview security

Candidates never see internal evaluation. Recruiters cannot modify submitted interviewer feedback
unless specifically authorised. Submitted evaluations are timestamped and audited:

```text
Feedback submitted by Project Head · 21-Aug-2026 4:12 PM · Revision: not allowed · Audit: recorded
```

## 27. Candidate selection

HR raises a **selection proposal** carrying current CTC, expected CTC, proposed CTC, salary increase
%, budgeted CTC, grade, designation, joining date, notice period, relocation, special conditions,
interview score and panel recommendation.

## 28. Compensation approval

```text
Candidate expected ₹12.00L · HR recommended ₹10.50L · Budgeted maximum ₹10.00L · Variance +5%
```

Variance routes the proposal: HR Head → Finance → Director. Offer generation stays disabled until
this clears.

## 29. Offer management

Offer letters generate from templates with auto-populated candidate, designation, department,
location, reporting manager, grade, CTC, joining date, probation and employment conditions. HR
previews before issuing.

Statuses: Draft, Pending approval, Approved, Sent, Viewed, Accepted, Rejected, Expired, Withdrawn.

## 30. Candidate offer portal

The candidate receives a secure link showing the offer letter, designation, location, joining date
and required documents, and can **Accept**, **Reject** or **Request clarification**. Acceptance
records date, session information where appropriate, an acceptance declaration and an uploaded
signed document if required.

## 31. Pre-joining workflow

Offer acceptance generates a pre-joining checklist: Aadhaar, PAN, photograph, bank details,
education documents, experience certificate, relieving letter, previous salary slips, UAN, PF
information, ESIC information, address proof, medical fitness where applicable, background
verification where applicable, passport/visa for relevant jobs, safety certifications for site
personnel.

## 32. Document verification

Each document carries: Uploaded, Under verification, Verified, Rejected, Re-upload required,
Waived — with an HR comment, e.g. *"Previous employer relieving letter unclear. Please upload a
readable copy."*

## 33. Pre-joining reminder automation

For a joining date of 01-Sep-2026 the system notifies at T-7, T-3, T-1 and on the joining day, and
tells candidate and HR about incomplete documents.

## 34. Joining management

| Candidate | Designation | Project | Joining date | Status |
| --- | --- | --- | --- | --- |
| ABC | Site Engineer | Rayagada | 01-Sep | Confirmed |
| XYZ | Supervisor | Boudh | 02-Sep | Documents pending |
| PQR | PM | Angul | 05-Sep | Confirmation pending |

Actions: confirm joined, candidate did not join, joining postponed, offer cancelled, joining date
revised.

## 35. Candidate-to-employee conversion

The module's most valuable automation. On **Confirm joining**, candidate master + offer details +
documents + requirement details become an Employee Master record, transferring name, mobile, email,
DOB, address, department, designation, grade, project, location, reporting manager, CTC, joining
date, documents, bank information and PAN/UAN where available. HR fills only what is missing.

## 36. Employee code creation

Joining then triggers: employee code generation → employee master creation → official email
request → attendance enrolment → payroll activation → reporting hierarchy → app login creation →
induction checklist.

## 37. Requirement quantity management

```text
Site Engineer, required 5 → joined 1 → balance 4 → Partially filled
                          → joined 5 → balance 0 → recommend closure
```

> Requirement successfully fulfilled. Close requirement?

## 38. Requirement closure

Before closing, the system verifies required quantity, joined quantity, outstanding offers, upcoming
joinings, active candidates and unused agency submissions.

Options: **Close fully filled**, **Close partially filled**, **Cancel remaining positions**,
**Extend requirement**, **Reopen**. A reason is mandatory for partial closure.

## 39. Requirement status structure

```text
Draft · Submitted · Pending HOD approval · Pending HR approval · Pending budget approval
Pending management approval · Approved · Recruiter assignment pending · Open · Sourcing
Screening · Interviewing · Selection in progress · Offer in progress · Partially filled
Filled · On hold · Rejected · Cancelled · Expired · Closed · Reopened
```

## 40. SLA management

Every requirement carries an SLA target by priority (Critical / High / Normal / Low), configured
rather than hard-coded.

```text
Requirement age 22 days · Target SLA 20 days · OVERDUE BY 2 DAYS
```

## 41. Escalation engine

```text
Day 0            requirement assigned to recruiter
50% SLA          notify recruiter
75%              notify recruiter + HR manager
100%             notify HR Head
120%             notify HOD
150%             escalate to Director
```

Fully configurable.

## 42. Requirement hold

Reasons: budget hold, project delayed, client approval pending, management instruction, role
redesign, internal candidate under evaluation. Whether the SLA clock pauses on hold is
configurable.

## 43. Requirement cancellation

Cancellation never deletes data. It captures cancellation reason, approval where necessary,
positions cancelled, candidate impact, offer impact and financial impact. Affected candidates move
to talent pool, another requirement, or rejected.

## 44. Reopen requirement

Five required, five joined, one resigns after 20 days — instead of starting over, create a
replacement requirement **linked to the original**, preserving complete manpower history.

## 45. Internal candidate flow

Not every vacancy needs external recruitment. Support internal transfer, internal promotion,
inter-project transfer and IJP (internal job posting):

```text
Requirement → internal candidate → current manager approval → receiving HOD → HR
  → transfer/promotion → requirement filled
```

## 46. Employee referral

Employees see eligible openings and **Refer candidate** with name, mobile, email, resume and
relationship. The system records source = Employee referral and the referring employee ID. Referral
rewards can later link to payroll.

## 47. Recruitment agency management

Agency master: name, contact person, agreement, roles permitted, fee structure, replacement
guarantee, payment terms, validity, performance. Agencies are assigned to specific requirements, and
the module tracks candidates submitted, shortlisted, interviewed, offered, joined, invoice due and
replacement guarantee period.

## 48. Talent pool

Good candidates are never discarded. Pools by discipline: project manager, electrical, civil,
transmission, substation, safety, accounts, HR, administration, testing & commissioning. A new
requirement surfaces matches:

> 12 previously shortlisted candidates match this requirement.

## 49. Notifications

Requirement submitted; approval requested; requirement approved; requirement rejected; recruiter
assigned; SLA approaching; requirement overdue; candidate assigned; interview scheduled; interview
feedback pending; candidate selected; compensation approval required; offer approved; offer
accepted; offer rejected; candidate documents pending; joining approaching; candidate joined;
candidate no-show; requirement fulfilled; requirement cancelled.

In-app and push notifications, with email where configured.

## 50. Automation examples

**Replacement automation** — resignation accepted → check position criticality → *"Create
replacement requirement?"* → employee details pre-populated → approval.

**New project automation** — new project created → project manpower template → PM 1, Site Engineer
4, Supervisor 6, Safety 2, Store 1 → HOD reviews → bulk requirements generated. Especially valuable
for an EPC organisation.

## 51. Requirement templates

A 132 KV transmission project template (project manager, site engineer, supervisor, surveyor, safety
officer, store keeper, accountant, technician, helper) and a 220/33 KV GIS template with a different
structure. Creating a project can generate its manpower requirements from the selected template.

## 52. Recruitment cost tracking

Job portal cost, agency fee, advertisement, travel reimbursement, interview expense, candidate
relocation, medical test, background verification, joining bonus, total hiring cost.

```text
HR-REQ-00128 · positions joined 4 · total hiring cost ₹1,20,000 · cost per hire ₹30,000
```

## 53. Management reports

| Report | Purpose |
| --- | --- |
| Requirement register | Complete requisition history |
| Open position report | Current vacancies |
| Requirement ageing | Delayed positions |
| Planned vs actual headcount | Workforce control |
| Department vacancy | Department shortage |
| Project vacancy | Project manpower shortage |
| Recruitment funnel | Conversion analysis |
| Recruiter performance | HR team productivity |
| Source effectiveness | Best hiring channels |
| Candidate rejection | Rejection analysis |
| Offer acceptance | Compensation competitiveness |
| No-show report | Joining risk |
| Joining forecast | Upcoming hires |
| Hiring cost | Recruitment spend |
| CTC variance | Budget control |
| Agency performance | Vendor evaluation |
| SLA report | Hiring SLA compliance |

## 54. HR requirement register

Columns: requirement ID, requirement date, department, project, location, designation, requested
qty, joined qty, balance qty, type, priority, requested by, HOD, recruiter, target date, age, SLA,
current stage, status. A row opens the Requirement Workspace (§16).

## 55. My HR tasks

A task queue rather than making users check each screen:

```text
3 requirements need approval · 5 interview feedbacks pending · 2 compensation approvals pending
4 offers need approval · 7 candidate documents pending · 3 candidates joining this week
5 requirements over SLA
```

This also surfaces on the main SEL Live dashboard.

## 56. Permissions

- **Employee** — refer candidates.
- **Requesting manager** — create requirement, view own requirements, respond to HR clarification.
- **HOD** — approve/reject department requirements, view department manpower, interview candidates.
- **Recruiter** — manage assigned requirements and candidates, schedule interviews, prepare offers.
- **HR manager** — assign recruiters, manage all requirements, override workflow subject to
  permissions.
- **HR head** — full HR access, compensation approval, reports.
- **Finance** — budget review only.
- **Director/ED/MD** — approval and management dashboard.
- **System admin** — configuration only.

## 57. Audit trail

Every significant activity is recorded:

```text
21-Aug-2026 10:21  requirement created by ABC
21-Aug-2026 11:05  submitted for approval
21-Aug-2026 13:12  approved by Project Head
21-Aug-2026 15:35  approved by HR Head
21-Aug-2026 16:22  recruiter assigned
22-Aug-2026 09:12  candidate XYZ added
24-Aug-2026 11:15  interview completed
25-Aug-2026 14:16  candidate selected
26-Aug-2026 12:30  offer issued
```

Audit history is not deletable by normal users.

## 58. HR settings

One settings area covering: designation master, department master, grade master, qualification
master, skill master, job description master, location master, project integration, employment
types, requirement types, requirement reasons, priority master, approval matrix, CTC approval rules,
recruiter assignment rules, interview stages, interview forms, rating templates, offer templates,
document checklist, joining checklist, SLA rules, escalation rules, recruitment sources, agency
master, notification rules, employee referral rules, requirement numbering, candidate numbering,
role permissions.

## 59. Database architecture

```text
hrRequirements · hrRequirementApprovals · hrManpowerPlans
candidates · candidateApplications
interviews · interviewFeedback
selectionProposals · compensationApprovals
offers · preJoining · joiningRecords
recruitmentAgencies · talentPools · jobDescriptions · recruitmentSources
hrActivities · hrNotifications · hrSettings
```

Relationship:

```text
Requirement
 ├── Applications ──── Candidate
 ├── Interviews
 ├── Selection
 ├── Offers
 ├── Joining
 └── Employee
```

## 60. Automation architecture

```text
MANPOWER PLAN → REQUIREMENT → APPROVAL ENGINE → RECRUITMENT ATS
   ├── SOURCING   ├── INTERVIEW   └── TALENT POOL
        → SELECT → COMPENSATION APPROVAL → OFFER → PRE-JOINING → JOINING
        → EMPLOYEE MASTER → { PAYROLL, ATTENDANCE, ONBOARDING } → PROBATION / HRMS
```

## 61. Project manpower control

Because SEL operates across many projects/sites, project manpower control is a core part of this
module, not an afterthought. Management opens a project and sees:

```text
TPSODL RAYAGADA
Approved manpower 48 · Required 48 · Existing 36 · Under recruitment 8
Offered 3 · Joining awaited 2 · Shortage 12 · Critical shortage 4
```

Then drills down by designation:

```text
Project Manager 1/1 · Site Engineer 5/8 · Supervisor 10/14
Safety Officer 1/2 · Store 2/2 · Testing Engineer 0/2
```

This is what turns requirement management into a real manpower-control system rather than only an
ATS.

## 62. Menu

```text
HR
├── HR Dashboard
├── Manpower
│   ├── Manpower Dashboard
│   ├── Manpower Planning
│   ├── Requirement Register
│   ├── New Requirement
│   ├── Approval Inbox
│   └── Project Manpower
├── Recruitment
│   ├── Recruitment Dashboard
│   ├── Open Positions
│   ├── Candidate Database
│   ├── Recruitment Pipeline
│   ├── Interviews
│   ├── Selection
│   ├── Offers
│   ├── Pre-Joining
│   └── Joining
├── Talent
│   ├── Talent Pool
│   ├── Employee Referrals
│   └── Recruitment Agencies
├── Reports
└── Settings
```

One continuous workflow: **Requirement → Approval → Recruitment → Candidate → Interview →
Selection → CTC approval → Offer → Pre-joining → Joining → Employee Master →
Payroll/Attendance/Onboarding.**

---

## 63. Control rules

The invariants the service layer enforces regardless of which screen or client initiates a change.
These are cited from code as `control rule 63.n`.

1. **Requirement IDs are system-allocated** inside a transaction, so two simultaneous submissions
   can never share a sequence (§5).
2. **A requirement cannot be recruited against before final approval.** Applications, interviews and
   offers may only attach to a requirement in an open/recruiting status (§15, §39).
3. **`requestedQuantity` is immutable after approval.** Reducing scope happens by cancelling
   positions (§43) or partial closure (§38), never by editing the approved number — otherwise
   "what was approved" stops being answerable.
4. **Joined count is derived, never typed.** It is the count of joining records confirmed against
   the requirement (§37).
5. **Offers cannot exceed the approved compensation.** An offer whose CTC is above the approved
   band or above the approved selection proposal requires a cleared compensation approval first
   (§9, §28).
6. **Submitted interview feedback is append-only.** A correction is a new revision with its own
   timestamp and author; the original is never overwritten (§26).
7. **`claimedQuantity` of a joining is one candidate.** A joining record converts exactly one
   candidate to one employee, so headcount can never drift from the employee master (§35).
8. **A candidate is never duplicated.** Applications reference the candidate master; a second
   application for the same person reuses the profile (§19, §21).
9. **A requirement at a terminal status is locked** — Filled, Closed, Cancelled, Rejected and
   Expired requirements accept no new applications, offers or joinings (§39).
10. **Every state transition writes an audit entry** naming the actor, the action and the before/
    after values. Audit entries are not deletable by normal users (§57).
11. **A replacement requirement must name the outgoing employee** so manpower history stays
    traceable through resignations and reopenings (§6, §44).
12. **Salary visibility follows permission, not role name.** CTC figures render only for holders of
    the sensitive-data permission; everyone else sees the requirement without them (§9, §56).

---

## 64. Implementation notes

Where the code lives, what runs on a schedule, and what is deliberately still a manual step.

### Layout

| File | Contents |
| --- | --- |
| `src/lib/hr-policy.ts` | Every rule in this document as a pure function. Dependency-free, so it runs in the browser, on mobile and in the Admin-SDK routes, and is unit-tested without an emulator. |
| `src/lib/hr-requirement.ts` | Types, collections (§59), settings defaults, the default approval matrix (§13) and the shipped templates (§51). Re-exports the policy module. |
| `src/lib/hr-requirement-service.ts` | Every state transition, the numbering transactions, the activity log and the §49 notifications. |
| `src/app/(protected)/hr/**` | The 24 routes of §62. |
| `src/components/hr/**` | The screens. Each standalone screen is reused, scoped by `requirementId`, as the matching tab of the Requirement Workspace (§16). |
| `tests/hr-domain.test.mjs` | `npm run test:hr` — the domain rules, including the worked examples from §9, §37, §40, §52 and §61. |
| `tsconfig.hr.json` | `npm run typecheck:hr` — typechecks the module on its own. |

### Scheduled work

`GET /api/hr/sla` runs the daily sweep — SLA state and escalations (§40, §41), offer expiry (§29) and
pre-joining reminders (§33). Registered in `vercel.json` at 01:00. It is idempotent: each requirement
records the escalation percentages already sent and each joining record the reminder offsets already
fired, so running it twice sends nothing twice. Guard it with the `CRON_SECRET` environment variable.

### Candidate offer portal

`/offer/[token]` is public and unauthenticated, backed by `/api/hr/offer`. It runs on the Admin SDK
rather than reading Firestore from the browser: a security rule permitting an anonymous read of
`offers` by token would expose every offer to anyone able to guess one. The API returns only the
fields the letter itself contains, and accepting through the portal creates the same joining record
and checklist that HR recording a verbal acceptance does.

### Setup checklist

1. Deploy the composite indexes: `firebase deploy --only firestore:indexes`.
2. Set `CRON_SECRET` so the sweep is not publicly callable.
3. Add a **HR & Recruitment** row to the `modules` collection with `icon: "Users"` — `ModuleCard`
   maps that title to `/hr`.
4. Grant the module's permissions from Role Management; the tree is in `src/lib/permissions.ts`.
5. In HR Settings, fill the masters (grades, designations, qualifications) and the **CTC bands** —
   with no bands configured, nothing is checked against a salary ceiling and §9's alert never fires.
6. Load the default approval matrix from Settings → Approval matrix, then switch off what does not
   apply.
7. Enter the manpower plan (§4) for the designations you recruit for. Without plan lines every
   requirement reads as above sanctioned strength and routes to Finance and management.

### Known boundaries

- **§36's downstream triggers are a checklist, not an integration.** Joining creates the employee
  record and allocates the employee code; official email, attendance enrolment, payroll activation,
  app login and induction are tracked as onboarding steps for HR to tick. Wiring them to the Payroll
  and Attendance modules is a separate piece of work, and pretending otherwise would leave HR
  believing payroll had been activated when it had not.
- **The employee master is extended additively.** `confirmJoining` writes the existing fields
  (`employeeNo`, `name`, `department`, `designation`, `dateOfJoin`, …) plus the recruitment-specific
  ones (grade, project, reporting manager, CTC, PAN, bank, provenance). Nothing existing is renamed,
  so the Employee module's screens keep working — but they do not yet *show* the new fields.
- **Approval-rule conditions are edited as a set, not individually.** Settings can load the default
  matrix, reorder it and switch rules on or off; editing one rule's conditions and stages in place
  still needs a per-rule editor.
- **Document uploads record a URL.** The checklist stores a link rather than performing the upload,
  because file upload in this app goes through the shared storage helper per module.
- **Firestore security rules are not in this repository** (`firebase.json` deploys indexes only), so
  the new collections need rules applied wherever they are managed.
