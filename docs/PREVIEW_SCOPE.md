# Frontend preview scope

## Experience promise

**Build a practice that works for you.** Find the business friction around your legal work, then choose your next useful improvement.

The preview should make that promise concrete without implying live analysis, verified outcomes or a protected account. A persistent but quiet label should say: **Interactive preview · sample website findings · saved in this browser.**

## Information hierarchy

### 1. Entry

- Primary action: **Start my assessment**.
- First field: **What's your practice's website?**
- Equal alternative: **I don't have a website yet**.
- Help: **In this preview, your URL gives context. Website findings are examples; we won't visit or test your site.**
- Secondary action: **Explore a fictional example**.

Do not invent an analyzing animation, claim to detect tools from a pasted URL, or display sample observations beneath an unqualified “Your website” heading. The no-site route must still reach a useful operating assessment.

### 2. Context and guided assessment

- Lead with **What would make your practice work better for you?**
- Context covers practice area, jurisdiction, stage, fee model and capacity.
- Questions ask about a concrete current process, not whether a lawyer considers the practice “good.”
- Answer labels should be readable rather than numeric: **Not in place yet**, **Handled as needed**, **A consistent process**, **Reviewed and improved**, **I'm not sure**, **Doesn't apply**.
- Explain “Reviewed and improved” as a stated maturity level, not automatically verified proof.
- Show progress and a back control. Preserve answers across steps. Avoid a completion claim if questions remain unanswered.

An unknown answer and no answer are not an affirmative absence. Not applicable is an explicit user assertion that may need review in a production product. Context alone should not invent a reason to mark a control irrelevant.

### 3. Scoped report

Top to bottom:

1. Assessment scope and date; preview/evidence label.
2. Owner goal and one plain-language takeaway supported by the selected answers.
3. Three actions, each connected to a finding.
4. Category results, with score/status and evidence coverage separately visible.
5. Useful strengths, remaining uncertainty, and correction/edit controls.

Suggested incomplete state: **We have enough to suggest a next step, but this area isn't graded yet.**

Suggested sample evidence label: **Example observation — not checked on your site.**

Suggested self-report label: **Based on your answers — not independently verified.**

Avoid “Your firm is compliant,” “Best lawyer,” “AI verified,” invented savings and comparisons to peers without an actual applicable benchmark. The initial report should not award a whole-practice numerical grade from a partial assessment.

### 4. Action plan and progress

Each action shows **Why this matters**, **What to do**, **Effort**, **Done when**, and **What to check next**. State mechanism instead of guaranteed lift.

Use **Plan this**, **Mark complete**, **Defer**, and **This doesn't fit**. A completed action should read **Completed by you**, not **Verified improvement**. Prefer actual saved timestamps over invented activity. Empty history is an invitation to establish a baseline, not a fabricated chart.

User-facing persistence copy: **Progress is saved in this browser. It won't appear on another device.**

Production email/login/sharing can be described as future capability, but preview controls must not claim to send, authenticate or publish. If shown, use an explicit preview explanation rather than a false success toast.

### 5. Local admin

Heading: **Scoring studio**. Label: **Local demo controls — no account or access protection.**

Explain which changes are drafts and which affect the active preview. Show rule version and preserve historical results when configuration changes. Invalid values, empty rules, excessive exclusions and insufficient coverage should produce useful validation, not NaN or misleading perfect scores.

Do not present a hidden route as protected administration. Any exposed local configuration is editable by the person with this browser; production authorization is outside this preview.

## Fictional example

**Juniper Family Law** is an invented established solo practice in Portland, Oregon with part-time administrative support. It uses a mixed hourly/scoped-flat-fee model. Its selected goal is collecting cash more predictably, and it could take on approximately two additional suitable matters next month. Its website is `https://juniper-family.example`.

The example can demonstrate useful service practices alongside inconsistent billing and follow-up. Every sample answer is explicitly fictional. Do not describe its invented figures as a legal-industry benchmark or an actual measured result. Do not attach this firm's selections to a user-entered URL as though the scan discovered them.

## Data controls

Provide a visible local export and clear route. Export should identify preview version, configuration version, capture time, fictional versus user-entered context, answers and locally derived results. Never include credentials or tokens. Clear should remove this application's local state; label separately whether resetting demo content also restores customized rules.

Browser-local storage is persistence, not authentication or a confidential case-management system. No raw client information belongs in the preview. Do not silently synchronize, send analytics payloads containing answers, or add a remote AI/CRM/email dependency.

## Review checklist

- Fresh start contains no fabricated history or completed actions.
- Fictional example and blank assessment are clearly different routes.
- Real URL input never becomes purported live website evidence.
- No-site, prelaunch, unknown and explicit not-applicable routes work.
- Zero is preserved as a value; missing inputs do not become zeros.
- Scores stay finite, with coverage and unmet requirements visible.
- Essential-control concerns remain visible even when other dimensions are strong.
- Action completion does not automatically prove performance improvement.
- Reload preserves intended local state; clear removes it; export accurately identifies its content.
- Local rule changes do not silently rewrite issued historical results.
- Mobile and keyboard users can reach all questions, choices, actions and data controls.
- Email, login, public sharing and admin labels accurately describe their preview status.
- No network call crawls the entered firm, sends answers to an AI service, emails a person, provisions an account or writes to CRM.
