# Independent Law Practice Grader — frontend preview

A Next.js and React browser preview of a practice assessment, scoped results, three prioritized actions, progress history and editable local scoring rules.

**This preview does not crawl websites or connect to live services.** Website observations are labeled sample content. Operating answers come from the person using the preview or the explicitly fictional example. No email is sent, no login is created, and no records are written to Pearl, HubSpot or a backend.

## Run locally

Use Node.js 24 or later and the pnpm version pinned in `package.json`. From this directory:

```sh
pnpm install
pnpm dev
```

Open the local address printed by the development server. Use `pnpm build` for the production build and `pnpm start` to serve it. Run `pnpm typecheck` and `pnpm test` for the checks defined in `package.json`. The corresponding npm commands also work.

## What to explore

1. Start an assessment with a website URL or the no-website route. A URL is context only; the preview does not fetch it.
2. Confirm practice context and choose what the owner wants to improve.
3. Answer concrete practice questions. Unknown and not applicable have distinct meanings; neither should silently become a zero.
4. View results for dimensions with sufficient evidence, with coverage and evidence type shown separately.
5. Choose from three prioritized actions and track reported completion.
6. Save another local assessment to compare results. Completing an action is distinct from observing a business improvement.
7. Explore the local admin controls for questions, weights and rules. These changes affect only this browser's preview data.

The fictional example uses **Juniper Family Law**, an invented solo practice in Portland, Oregon. Its website, answers, scores and actions are demonstration content, not research about an actual firm. The reserved `.example` website address is not a target for assessment.

## Browser storage and privacy

The preview stores its state in this browser's local storage for this application origin. It has no account system, synchronization, database backup or protected admin boundary. Another person using the same browser profile can access the saved preview; browser storage can also be cleared or lost.

Use fictional or non-sensitive information. Do not enter credentials, client identities, matter narratives, privileged information, raw payment data or individual employee compensation. A website URL or firm name you enter may be included in an exported preview.

Use the preview's export and clear controls when available. Inspect an export before sharing it. To remove local state directly, clear this application's local storage in the browser's developer tools; clearing browser storage removes saved answers, progress and local configuration. This is local preview behavior, not a production data-retention or deletion service.

## Reading the result

- **Practice context** selects relevant questions and recommendations; it does not earn points.
- **Reported practice** describes the selected maturity answer. It does not establish that a process works consistently.
- **Sample website finding** is fictional demonstration content, even when a real URL was entered.
- **Evidence coverage** describes how much applicable information is available. It is separate from practice quality.
- **Incomplete assessment** is not a poor practice grade. Do not present a partial website assessment as a whole-practice certification.
- **Action completed** records a local status change. It does not verify an economic or client-service outcome.

Local admin tools demonstrate configuration and release behavior. They provide no authentication, access isolation, legal review or protection against deliberate score manipulation. Production administration must have server-side permissions, audit, validation and reviewed publication.

## Intentional exclusions

No live crawl or PageSpeed request; AI inference; email delivery; magic-link authentication; public profiles or leaderboards; teammate invitations; CRM sync; paid services; document upload; background scheduling; or statistical/ML claims. The full proposed product requires separate implementation and end-to-end verification.

See [Preview scope](docs/PREVIEW_SCOPE.md) for the experience contract, evidence language and review checklist.
