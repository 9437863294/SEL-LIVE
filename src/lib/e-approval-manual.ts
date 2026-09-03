/**
 * The E-Approval handbook, as data.
 *
 * One source, two outputs: the in-app tutorial at `/e-approval/help` renders it, and
 * `scripts/build-e-approval-manual.mjs` renders the same array into `docs/E-Approval-Manual.docx`.
 * Written this way because a manual kept separately from the product is a manual that is wrong within
 * a month — here, correcting a sentence corrects both the screen and the Word file.
 *
 * Dependency-free so the docx script can import it under Node with no bundler.
 *
 * Every claim in here describes behaviour that exists. Where something is deliberately absent — the
 * ten reporting areas still awaiting requirements, the missing "Branch" field — it says so rather
 * than quietly omitting it.
 */

export type ManualAudience = 'everyone' | 'approver' | 'administrator';

export interface ManualBlock {
  kind: 'paragraph' | 'steps' | 'bullets' | 'table' | 'note' | 'warning';
  /** For paragraph, note and warning. */
  text?: string;
  /** For steps and bullets. */
  items?: string[];
  /** For table. */
  headers?: string[];
  rows?: string[][];
}

export interface ManualSection {
  id: string;
  number: string;
  title: string;
  audience: ManualAudience;
  summary: string;
  /** The screen this section is about, when there is one. */
  route?: string;
  blocks: ManualBlock[];
}

export interface ManualPart {
  id: string;
  title: string;
  audience: ManualAudience;
  intro: string;
  sections: ManualSection[];
}

export const MANUAL_AUDIENCE_LABEL: Record<ManualAudience, string> = {
  everyone: 'Everyone',
  approver: 'Approvers',
  administrator: 'Administrators',
};

export const E_APPROVAL_MANUAL_META = {
  title: 'E-Approval — User and Administrator Handbook',
  organisation: 'Sidhartha Engineering Limited',
  subtitle: 'Raising, approving and administering electronic note-sheets',
  version: '1.0',
  moduleRoute: '/e-approval',
} as const;

const p = (text: string): ManualBlock => ({ kind: 'paragraph', text });
const note = (text: string): ManualBlock => ({ kind: 'note', text });
const warn = (text: string): ManualBlock => ({ kind: 'warning', text });
const steps = (...items: string[]): ManualBlock => ({ kind: 'steps', items });
const bullets = (...items: string[]): ManualBlock => ({ kind: 'bullets', items });
const table = (headers: string[], rows: string[][]): ManualBlock => ({ kind: 'table', headers, rows });

export const E_APPROVAL_MANUAL: ManualPart[] = [
  /* ────────────────────────────────────────────────────────────────────────────────────────────
   * Part 1 — everyone
   * ──────────────────────────────────────────────────────────────────────────────────────────── */
  {
    id: 'basics',
    title: 'Part 1 · Getting started',
    audience: 'everyone',
    intro:
      'What the module is for, how to move around it, and how to raise your first approval. Read this part whatever your role.',
    sections: [
      {
        id: 'what-it-is',
        number: '1.1',
        title: 'What E-Approval is',
        audience: 'everyone',
        summary: 'An electronic note-sheet that carries its own approval trail.',
        blocks: [
          p(
            'E-Approval replaces the paper note-sheet. You write what you are proposing, say who should approve it, and the file moves from desk to desk until it is approved, rejected or sent back. Everything that happens to it — who held it, for how long, what they said — stays on the record permanently.',
          ),
          p('Three kinds of task can appear in your inbox, and they are not the same thing:'),
          table(
            ['Task', 'What it means', 'Where it goes next'],
            [
              ['Approval', 'You are being asked to authorise the proposal.', 'On to the next approver, or finished.'],
              [
                'Verification',
                'An approver is still holding the file and wants you to check something first.',
                'Straight back to whoever asked you — never onward.',
              ],
              [
                'Clarification',
                'Somebody has a question for you.',
                'Straight back to whoever asked, the same as a verification.',
              ],
            ],
          ),
          note(
            'This distinction is the heart of the module. A verification does not take the approval away from the approver who asked for it — they still hold the file and it returns to them automatically, however many people it passes through on the way.',
          ),
        ],
      },
      {
        id: 'navigation',
        number: '1.2',
        title: 'Finding your way around',
        audience: 'everyone',
        summary: 'The left-hand menu, grouped into three.',
        route: '/e-approval',
        blocks: [
          p(
            'The menu on the left (the Menu button on a phone) is grouped into My Work, Registers and Configuration. You only see the entries your role permits.',
          ),
          table(
            ['Menu entry', 'What it shows'],
            [
              ['Dashboard', 'What you owe, how urgent it is, and where your own requests have got to.'],
              ['Create Approval', 'Raise a new note-sheet.'],
              ['My Inbox', 'Everything waiting on you — approvals, verifications, clarifications and returns.'],
              ['Created by Me', 'Every request you have raised, at whatever stage.'],
              ['Drafts', 'Saved but not submitted. A draft has no reference number yet.'],
              ['My Activity', 'Everything you have personally done — approved, verified, returned and the rest — across every approval.'],
              ['Department Inbox', 'Approvals sent to your department rather than to you by name.'],
              ['All Approvals', 'The full register, for those permitted to see it.'],
              ['Completed / Rejected', 'Closed files.'],
              ['Delegations', 'Substitute approvers for leave.'],
              ['Reports', 'Management analytics.'],
              ['Settings', 'Configuration, for administrators.'],
            ],
          ),
        ],
      },
      {
        id: 'raising',
        number: '1.3',
        title: 'Raising an approval',
        audience: 'everyone',
        summary: 'The create form asks one thing at a time.',
        route: '/e-approval/create',
        blocks: [
          p(
            'The form starts as a single field and reveals the next step once you have answered the one before it. Only three things are genuinely required: a subject, a proposal, and somebody to send it to.',
          ),
          steps(
            'Subject — one line naming what is being approved. For example, "Approval for purchase of safety equipment".',
            'The proposal — the full text being approved. Say what is proposed, why, and what it costs. This is the wording an approver signs.',
            'Kind of approval — the approval type, if your organisation has configured any. It decides how the request routes and whether an amount is required.',
            'Financial details — appears as a required step only when the chosen type needs an amount. Otherwise it is optional and hidden.',
            'Who approves it — name the first approver. One is enough.',
          ),
          p('Four optional sections can be opened when you need them, and stay out of the way when you do not:'),
          bullets(
            'Supporting documents — drag files in, or tap to choose. They upload when you save or submit.',
            'Financial details — amount, vendor, cost centre, budget head.',
            'Filing details — department, project or site, priority, required-by date, your own reference number.',
            'Visibility — CC people who should see it, and mark the file confidential.',
          ),
          note(
            'You only have to name the first approver. Whoever receives it can send it for verification, add approvers, or forward it on — the chain builds itself as the file moves.',
          ),
          p(
            'Under "Who approves it" the panel headed "It will go to" always shows the chain that will actually run, with the SLA hours for each stage. Check it before submitting.',
          ),
          note(
            'Save draft keeps it private and gives you no reference number. Submit allots the reference number and sends it to the first approver. You cannot submit without an approver.',
          ),
        ],
      },
      {
        id: 'after-submit',
        number: '1.4',
        title: 'After you submit',
        audience: 'everyone',
        summary: 'Reference numbers, notifications and tracking.',
        blocks: [
          p(
            'On submission the request is given a reference number such as EA/FIN/2026-27/00125 — the prefix, your department code, the financial year and a running number. It is allotted once and never changes, even if the content is later revised.',
          ),
          p('You will be notified when:'),
          bullets(
            'the file moves to a new desk — the notice names who is holding it now;',
            'somebody comments or mentions you;',
            'it is returned to you for correction;',
            'it is approved or rejected.',
          ),
          p(
            'To see where anything of yours has got to, open Created by Me, or read the "Who has the files you raised" table on the dashboard — it groups your open requests by whoever is holding them, oldest first.',
          ),
        ],
      },
      {
        id: 'reading',
        number: '1.5',
        title: 'Reading an approval',
        audience: 'everyone',
        summary: 'The detail screen and its tabs.',
        route: '/e-approval/{reference}',
        blocks: [
          p(
            'The blue box at the top answers the question people usually ring up to ask: who is holding it, since when, for what, and how long is left on their clock.',
          ),
          table(
            ['Tab', 'What is in it'],
            [
              ['Overview', 'The proposal and all its filing details.'],
              [
                'Workflow',
                'The chain as it actually happened. Verifications appear indented inside the approver who asked for them, with the arrow back.',
              ],
              ['Comments', 'Discussion. Nothing here can be deleted.'],
              ['Attachments', 'Files, grouped by the version of the request they belong to.'],
              ['Activity', 'The full audit trail, append-only.'],
              ['Versions', 'Superseded content, with the approvals that had been given against it.'],
            ],
          ),
        ],
      },
      {
        id: 'returned',
        number: '1.6',
        title: 'If a request comes back to you',
        audience: 'everyone',
        summary: 'Correcting and resubmitting — and when that costs you the approvals already given.',
        blocks: [
          p(
            'An approver can return a request for correction. It appears in your inbox marked Returned, with the reason. Open it, choose Edit, make the correction, save, then use Resubmit on the approval screen.',
          ),
          warn(
            'If you change the subject, the proposal, the amount, the department, the project or the attachments, the approvals already given are superseded and the chain restarts. This is deliberate: somebody who approved "purchase 10 helmets for ₹25,000" has not approved "purchase 10 vehicles for ₹90,00,000". Correcting a typo costs you nothing — the file goes straight back to whoever returned it.',
          ),
          p(
            'When approvals are superseded, everyone whose approval no longer stands is told, and the old content is kept in the Versions tab alongside the approvals it carried.',
          ),
        ],
      },
      {
        id: 'comments-attachments',
        number: '1.7',
        title: 'Comments and attachments',
        audience: 'everyone',
        summary: 'What can be added, edited and removed — and what cannot.',
        blocks: [
          bullets(
            'Comments can be added by anybody involved. Type @ and a full name to notify somebody directly.',
            'A comment can be edited, but the previous text is kept and the comment is marked as edited.',
            'A comment can be retracted — it is struck through, not removed.',
            'Attachments can be added at any point: when raising, when approving, when verifying, when returning.',
            'An attachment is never overwritten. Uploading a revision adds a second file beside the original.',
          ),
          note(
            'Nothing on an approval can be deleted once posted. That is what makes the file usable as evidence months later.',
          ),
        ],
      },
      {
        id: 'signing-attachments',
        number: '1.8',
        title: 'Signing a document',
        audience: 'everyone',
        summary: 'Draw or upload your signature once, then stamp it onto any PDF attachment.',
        blocks: [
          p(
            'Set your signature up once from My Activity — draw it with a finger, stylus or mouse, or upload an image of it — and it is ready from then on. If you have not set one up yet, opening Sign on a document offers the same drawing screen there and then.',
          ),
          p('To actually sign a document: open the Attachments tab and choose Sign on any PDF.'),
          steps(
            'Choose which page to sign.',
            'Choose roughly where on the page — one of nine positions (corners, edges or centre) — and how large.',
            'Optionally fine-tune the exact spot.',
            'Sign & save.',
          ),
          note(
            'Signing creates a new, signed copy of the document. The original you uploaded is never changed, and stays on the record exactly as it was.',
          ),
          warn(
            'Once an approval is closed — approved, rejected or cancelled — nothing on it can be signed any more, by anybody. Sign while the file is still moving. Whatever was signed before it closed stays on the record.',
          ),
          warn(
            'This is a visual signature — a scanned mark, the same as signing a paper note-sheet by hand. It is not a certificate-backed digital signature (a DSC). If your organisation needs a legally-binding cryptographic signature, that requires a licensed signing provider and is outside what this module does.',
          ),
        ],
      },
    ],
  },

  /* ────────────────────────────────────────────────────────────────────────────────────────────
   * Part 2 — approvers
   * ──────────────────────────────────────────────────────────────────────────────────────────── */
  {
    id: 'approving',
    title: 'Part 2 · For approvers',
    audience: 'approver',
    intro:
      'What to do when a file reaches you, what each action means, and how to take one back if you send it to the wrong person.',
    sections: [
      {
        id: 'inbox',
        number: '2.1',
        title: 'Your inbox',
        audience: 'approver',
        summary: 'Everything waiting on you, soonest deadline first.',
        route: '/e-approval/inbox',
        blocks: [
          p(
            'My Inbox holds approvals, verifications, clarifications and returned files together. The dashboard splits the same work into separate counts if you prefer to take one kind at a time.',
          ),
          note(
            'You do not need a special permission to act on something assigned to you. Being given the step is the authority to act on it. Permissions govern what you can raise, see and administer — not what you can do with a file already in your hands.',
          ),
        ],
      },
      {
        id: 'actions',
        number: '2.2',
        title: 'The actions available to you',
        audience: 'approver',
        summary: 'What each button does, and what it does to the file.',
        blocks: [
          p(
            'Which buttons appear depends on the kind of step and on what the workflow allows at that stage. Not every action is offered on every file.',
          ),
          table(
            ['Action', 'What happens'],
            [
              ['Approve', 'Your stage is complete and the file moves to the next approver.'],
              [
                'Approve & Complete',
                'Approves and closes the workflow, skipping every remaining stage. Offered only where the workflow permits it.',
              ],
              [
                'Send for Verification',
                'Somebody checks something and it comes straight back to you. You keep the file; your clock pauses while you wait.',
              ],
              ['Request Clarification', 'Ask a question. The answer returns to you the same way.'],
              [
                'Return',
                'Send it back — to the requester, or to any earlier approver. A reason is required. Steps between them and you run again in their original order.',
              ],
              ['Forward', 'Hand the approval to somebody else. They become the approver; you are out of it.'],
              [
                'Delegate',
                'Let somebody act in your place. You keep the step, and their action is recorded as "on behalf of" you.',
              ],
              ['Add Approver', 'Insert an extra approval stage immediately after yours.'],
              ['Escalate', 'Pass the step to a senior authority. Their clock starts fresh.'],
              ['Reject', 'Close the request. A reason is required.'],
              ['Hold / Resume', 'Stop the clock while something is outstanding. Only you can release your own hold.'],
              ['Take Ownership', 'Claim a step addressed to your department, so it is yours alone.'],
              [
                'Assign to',
                'Department heads only. Hand a file addressed to your department to a named member — or move it from one member to another. It stays on the department’s record.',
              ],
              ['Add Participant', 'Give somebody view and comment access.'],
            ],
          ),
          note(
            'Verification and forwarding are often confused. Verification borrows somebody briefly and returns; forwarding gives the approval away. If you want an opinion, verify. If it is not your decision to make, forward.',
          ),
        ],
      },
      {
        id: 'amount-approved',
        number: '2.3',
        title: 'Approving a different amount',
        audience: 'approver',
        summary: 'You are not limited to the figure you were asked to approve.',
        blocks: [
          p(
            'On a request that carries an amount, Approve and Approve & Complete show it to you as an editable field, not just a number on the screen. Leave it as it is to approve exactly what was asked for. Change it to approve something else — the same thing as striking out a figure on a paper note-sheet and writing a different one above it.',
          ),
          note(
            'If somebody approved before you at a different figure, you see that figure — not the original request — because that is what is actually being carried forward. Change it again and whoever comes after you sees yours.',
          ),
          warn(
            'This does not touch the approvals given before you. Revising the amount is part of your own decision, not an edit to the request — nobody has to re-approve anything because of it. That protection exists for a different situation: the requester changing the proposal itself after it has already been approved. See "If a request comes back to you" in Part 1.',
          ),
          p(
            'Wherever the amount is shown afterwards — the Overview tab, the workflow timeline, the Activity trail, the printed Approval Note — you will see both figures when they differ: what was requested, and what was actually sanctioned.',
          ),
        ],
      },
      {
        id: 'verifying',
        number: '2.4',
        title: 'When you are asked to verify',
        audience: 'approver',
        summary: 'Three possible answers, and what each one does.',
        blocks: [
          p('A verification asks you to check something. You have three answers:'),
          bullets(
            'Verified — you checked and it is correct.',
            'Verified with observation — correct, but with a note the approver should read.',
            'Not verified — it does not check out.',
          ),
          p(
            'All three send the file straight back to whoever asked. "Not verified" does not reject the request; the approver decides what to do about it.',
          ),
          note(
            'You can send it on for further verification yourself. However deep that goes, each answer returns to the person who asked for it, one level at a time.',
          ),
        ],
      },
      {
        id: 'sla',
        number: '2.5',
        title: 'Deadlines and reminders',
        audience: 'approver',
        summary: 'How the clock works, and when it stops.',
        blocks: [
          p(
            'Each stage carries an SLA in hours, scaled by the priority of the request — an urgent file gets a quarter of the normal time, a low-priority one half again as much.',
          ),
          note(
            'Your clock stops while you are waiting on a verification you asked for, and while the file is on hold. You are only ever answerable for the time you actually held it.',
          ),
          p(
            'Reminders follow a ladder your administrator sets — by default at 24, 48, 72 and 96 hours, escalating through Level 1 to Management. A reminder is never sent twice for the same rule.',
          ),
        ],
      },
      {
        id: 'recall',
        number: '2.6',
        title: 'Taking an action back',
        audience: 'approver',
        summary: 'Recall your own dispatch; a supervisor can reverse a decision.',
        blocks: [
          p('Sent something to the wrong person? Open the Activity tab and use the button on that entry.'),
          table(
            ['', 'Recall', 'Reverse'],
            [
              ['Who', 'The person who sent it', 'Somebody with the Reverse Any permission'],
              ['What', 'A dispatch — verification, clarification, forward, delegation, escalation', 'A completed decision — approve, verify, return, reject, hold'],
              ['How long', 'Minutes (15 by default)', 'Hours (24 by default)'],
            ],
          ),
          p(
            'Both require that nothing has happened since — once the verifier has replied, taking the request back would erase their work rather than your mistake.',
          ),
          note(
            'Neither is a deletion. The original action stays on the record and the undo is added after it, saying who undid what and why. Whoever the work was taken back from is told it has been withdrawn.',
          ),
        ],
      },
      {
        id: 'leave',
        number: '2.7',
        title: 'Going on leave',
        audience: 'approver',
        summary: 'Set a substitute so approvals do not stall.',
        route: '/e-approval/delegations',
        blocks: [
          steps(
            'Open Delegations.',
            'Choose New delegation.',
            'Choose who is covering for you.',
            'Set the dates. Leaving the end date blank makes it open-ended.',
            'Optionally restrict it to one approval type.',
          ),
          note(
            'A delegation is a dated window and expires on its own. Every action the substitute takes is recorded as "on behalf of" you — the authority is delegated, the accountability is not.',
          ),
          p(
            'You are always the one being covered for — you can delegate your own approvals, and only your own. Removing a delegation follows the same rule.',
          ),
          note(
            'Administrators holding "Delegations → Manage Others" can additionally arrange or remove cover on anybody’s behalf — for the colleague who went on leave without setting one up. Everyone can see the full list either way, so it is always clear who is covering for whom.',
          ),
          p('Delegation resolves one level only: if A delegates to B and B delegates to C, A’s files go to B.'),
        ],
      },
    ],
  },

  /* ────────────────────────────────────────────────────────────────────────────────────────────
   * Part 3 — administrators
   * ──────────────────────────────────────────────────────────────────────────────────────────── */
  {
    id: 'administration',
    title: 'Part 3 · For administrators',
    audience: 'administrator',
    intro:
      'Everything that decides how an approval behaves before anybody touches it. Changes apply to approvals raised from then on — a request already in flight keeps the chain it was given.',
    sections: [
      {
        id: 'setup-order',
        number: '3.1',
        title: 'Setting the module up',
        audience: 'administrator',
        summary: 'The order to do it in.',
        route: '/e-approval/settings',
        blocks: [
          steps(
            'Roles — grant E-Approval permissions in Settings → Role Management. Nobody sees the module until you do.',
            'Approval Types — add the kinds of request your organisation raises.',
            'Workflows — use "Samples" to seed three example chains, then assign real approvers.',
            'Approval Matrix — amount bands per type, each pointing at a workflow. Use the tester before trusting it.',
            'Department Routing — for every department that will receive department-addressed steps.',
            'Policies — change control, approver powers, recall and reverse windows, reminders, numbering.',
            'Deploy the Firestore indexes (firebase deploy --only firestore:indexes).',
            'Schedule the reminder sweep (see 3.8).',
          ),
          note(
            'The module works before any of this is configured: an employee can name their own approvers on the form. Configuration is what removes that decision from them.',
          ),
        ],
      },
      {
        id: 'types',
        number: '3.2',
        title: 'Approval types',
        audience: 'administrator',
        summary: 'What people can raise.',
        route: '/e-approval/settings/types',
        blocks: [
          p('A type decides three things beyond its name:'),
          bullets(
            'Whether the amount field is shown at all, and whether it is required.',
            'Whether the file is confidential by default.',
            'Which workflow it falls back to when no matrix rule matches.',
          ),
          note('A code such as PUR is used in reference numbers when department codes are switched off.'),
        ],
      },
      {
        id: 'workflows',
        number: '3.3',
        title: 'Workflows',
        audience: 'administrator',
        summary: 'Named chains of stages.',
        route: '/e-approval/settings/workflows',
        blocks: [
          p(
            'A workflow is an ordered list of stages. A stage with more than one approver runs them in parallel, and you choose how it is satisfied: all must approve, any one, or a set number of them.',
          ),
          p('Each stage carries its own SLA and its own set of powers — what that approver may do:'),
          bullets(
            'send for verification, request clarification;',
            'return, forward, delegate, add an approver, escalate;',
            'reject, hold;',
            'approve & complete (off by default — it ends the workflow early).',
          ),
          warn(
            'A stage with no approver assigned is skipped when the chain is built, and the request goes through one signature short. The list flags these in amber.',
          ),
          note('Duplicate is useful for building a variant of an existing chain without retyping it.'),
        ],
      },
      {
        id: 'matrix',
        number: '3.4',
        title: 'The approval matrix',
        audience: 'administrator',
        summary: 'Which chain a request takes.',
        route: '/e-approval/settings/matrix',
        blocks: [
          p(
            'A rule matches on any combination of approval type, department, project and amount band, and points at a workflow. Unset criteria match everything.',
          ),
          p('When two rules could both apply:'),
          bullets(
            'the more specific one wins;',
            'between two equally specific rules, the higher Priority number wins;',
            'failing that, the narrower amount band wins.',
          ),
          warn(
            'Use the tester at the bottom of the page before trusting a matrix. Enter a type and an amount and it highlights the rule that will actually fire. A matrix is the one piece of configuration whose mistakes stay invisible until a real note-sheet takes the wrong route — by which time the wrong people have seen it.',
          ),
        ],
      },
      {
        id: 'departments',
        number: '3.5',
        title: 'Department routing',
        audience: 'administrator',
        summary: 'Who a department-addressed step actually reaches.',
        route: '/e-approval/settings/departments',
        blocks: [
          table(
            ['Mode', 'Behaviour'],
            [
              ['Anyone', 'Any listed member can take it. Claiming it locks it to that person.'],
              ['Head', 'Goes straight to the department head.'],
              ['Queue', 'Held for the head, who uses Assign to hand it to a member. Members cannot claim it themselves.'],
            ],
          ),
          warn(
            'A department with nothing configured here reaches only its head. If no head is set either, nobody can act and the file stalls. The list flags unconfigured departments.',
          ),
          note(
            'Membership is stated here rather than read from user records, because the application has no user-to-department field. It is an explicit decision an administrator owns.',
          ),
        ],
      },
      {
        id: 'policies',
        number: '3.6',
        title: 'Policies',
        audience: 'administrator',
        summary: 'Change control, approver powers, recall, reminders and numbering.',
        route: '/e-approval/settings/policies',
        blocks: [
          p('Five groups of settings, all held in one record and saved together.'),
          p('Change control — which edits invalidate approvals already given.'),
          warn(
            'Leave Amount ticked unless you have a specific reason. With it off, a figure can be raised after approval without superseding anything.',
          ),
          p(
            'Amount tolerance treats a change within that percentage as a correction rather than a new proposal; 0 means any change supersedes. Restart-from decides where the chain resumes afterwards.',
          ),
          p(
            'What approvers may do — organisation-wide ceilings on nesting depth, return-to-any-step and approve-&-complete. A workflow stage can switch any of these off for itself; it can never switch one on that is off here.',
          ),
          p('Recall & reverse — the two windows and their on/off switches. See 2.5.'),
          p(
            'Reminders & escalation — the ladder, measured from when a step became active and excluding time paused. Each rule carries a level from Level 1 to Management. "Run now" processes it on demand.',
          ),
          p(
            'Numbering — prefix, separator, digits, and whether the department code appears. The example updates as you type.',
          ),
        ],
      },
      {
        id: 'permissions',
        number: '3.7',
        title: 'Permissions',
        audience: 'administrator',
        summary: 'What the role tree governs — and what it deliberately does not.',
        blocks: [
          p('Granted in Settings → Role Management under E-Approval.'),
          table(
            ['Node', 'Governs'],
            [
              ['View Module, Dashboard, Inbox', 'Seeing the module at all.'],
              ['Requests', 'Create, edit, delete a draft, cancel, and how much of the register you can see.'],
              ['Requests → View Confidential', 'Opening files marked confidential.'],
              ['Comments, Attachments', 'Commenting and uploading.'],
              ['Audit Trail', 'The Activity tab.'],
              ['Reversals → Reverse Any', 'Undoing somebody else’s completed action.'],
              ['Reports', 'The analytics pages, and exporting them.'],
              ['Delegations', 'Setting up substitute approvers for yourself.'],
              [
                'Delegations → Manage Others',
                'Arranging or removing cover on somebody else’s behalf. Without it a person can only delegate their own approvals.',
              ],
              ['Settings → …', 'Each configuration page separately.'],
            ],
          ),
          warn(
            'There is no "Approve", "Verify" or "Return" permission, and this is deliberate. Being assigned a step is the authority to act on it. A verifier a Director picked is authorised by that choice — requiring them to also hold a matching role permission is how a file ends up parked with somebody who cannot move it.',
          ),
        ],
      },
      {
        id: 'reminders-cron',
        number: '3.8',
        title: 'Scheduling the reminder sweep',
        audience: 'administrator',
        summary: 'Reminders and escalations need a scheduler.',
        blocks: [
          p(
            'The endpoint /api/e-approval/escalations processes the ladder. It is safe to call as often as you like — each step records which rules have already fired, so nothing is sent twice.',
          ),
          warn(
            'Until this is scheduled, no reminder or escalation is ever sent. The "Run now" button on the Policies page is a manual substitute, not a replacement.',
          ),
          note('Guard the endpoint with the CRON_SECRET environment variable if it is reachable publicly.'),
        ],
      },
      {
        id: 'reports',
        number: '3.9',
        title: 'Reports',
        audience: 'administrator',
        summary: 'Six analytics areas, with a shared filter and Excel export.',
        route: '/e-approval/reports',
        blocks: [
          table(
            ['Report', 'Answers'],
            [
              ['Executive Command Center', 'What is outstanding, what it is worth, how it has moved period on period.'],
              ['Status Distribution', 'Every status, its share and its value, with drill-down.'],
              ['Approval Aging', 'Nine age bands, and the oldest-pending table with escalation level.'],
              ['Bottleneck Intelligence', 'Which desk, department and workflow stage is costing time.'],
              ['SLA & Escalation', 'Compliance by department, approver, type or stage; escalation by level.'],
              ['Approver Performance', 'Per-person workflow metrics and rankings.'],
            ],
          ),
          note(
            'Two conventions worth knowing when reading any of them. Turnaround excludes time a step spent paused, so an approver is measured on the time they actually held the file. And a rate with nothing to divide shows a dash rather than 0% — a rate over no cases is unknown, not zero.',
          ),
          warn(
            'Approver Performance reports workflow metrics, not a performance appraisal. A high return rate may be diligence; a fast response may be rubber-stamping.',
          ),
          note(
            'Ten further analytics areas listed in the original specification — department performance, financial, rework, verification, workflow efficiency, requester, delegation, category, project and audit, plus a custom report builder — are not built. They appear greyed on the reports hub so the gap is visible.',
          ),
        ],
      },
      {
        id: 'known-gaps',
        number: '3.10',
        title: 'Known gaps',
        audience: 'administrator',
        summary: 'Stated plainly, so nobody hunts for them.',
        blocks: [
          bullets(
            'There is no "Branch" field. Reports can filter by department, project, type, requester and priority, but branch does not exist anywhere in the data.',
            'Notifications reach the in-app bell and whatever channels the central notification system already serves. There is no WhatsApp integration.',
            'Comments do not support voice notes.',
            'The workflow builder is a structured list editor, not a drag-and-drop canvas.',
            'No other module yet routes its approvals through this engine, though it is built to accept them.',
            'Signing a document places a visual mark, not a certificate-backed digital signature (DSC) — see 1.8.',
          ),
        ],
      },
    ],
  },

  /* ────────────────────────────────────────────────────────────────────────────────────────────
   * Appendix
   * ──────────────────────────────────────────────────────────────────────────────────────────── */
  {
    id: 'appendix',
    title: 'Appendix',
    audience: 'everyone',
    intro: 'Reference tables.',
    sections: [
      {
        id: 'statuses',
        number: 'A.1',
        title: 'Statuses',
        audience: 'everyone',
        summary: 'What each status on a request means.',
        blocks: [
          table(
            ['Status', 'Meaning'],
            [
              ['Draft', 'Saved but not submitted. No reference number yet.'],
              ['Submitted', 'Just sent; about to reach its first approver.'],
              ['Pending Approval', 'With an approver.'],
              ['Pending Verification', 'With somebody checking something for an approver.'],
              ['Pending Clarification', 'With somebody answering a question.'],
              ['Returned', 'Sent back for correction.'],
              ['Resubmitted', 'Corrected and sent back into the workflow.'],
              ['On Hold', 'An approver has stopped the clock.'],
              ['Partially Approved', 'A parallel stage has some but not all of the approvals it needs.'],
              ['Approved', 'Complete.'],
              ['Rejected', 'Closed without approval.'],
              ['Cancelled', 'Withdrawn by the requester.'],
              ['Superseded', 'Content changed after approval; this version no longer stands.'],
              ['Closed', 'Finished and filed.'],
            ],
          ),
        ],
      },
      {
        id: 'glossary',
        number: 'A.2',
        title: 'Glossary',
        audience: 'everyone',
        summary: 'Terms used throughout.',
        blocks: [
          table(
            ['Term', 'Meaning'],
            [
              ['Stage', 'One position in the approval chain.'],
              ['Step', 'One person’s task — an approval, a verification or a clarification.'],
              ['Chain', 'The ordered set of stages a request runs through.'],
              ['Matrix', 'The rules deciding which chain a request takes.'],
              ['SLA', 'The time allowed for a stage, in hours.'],
              ['Supersede', 'To invalidate approvals because the content changed.'],
              ['Recall', 'Taking back your own dispatch within minutes.'],
              ['Reverse', 'Undoing a completed decision, with permission, within hours.'],
              ['Delegate', 'Authorising somebody to act in your place for a period.'],
            ],
          ),
        ],
      },
    ],
  },
];

/** Every section flattened, for search and for the docx table of contents. */
export const E_APPROVAL_MANUAL_SECTIONS: ManualSection[] = E_APPROVAL_MANUAL.flatMap((part) => part.sections);
