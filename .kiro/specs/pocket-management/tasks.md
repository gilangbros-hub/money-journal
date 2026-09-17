# Implementation Plan: Pocket Management

## Overview

Implement managed Pocket Definitions and immutable per-Budget-Month Pocket Assignments in the existing Node.js/Express, Mongoose, Handlebars, browser-JavaScript, and Tailwind application. The plan replaces fixed-pocket runtime behavior only behind a disabled-by-default, migration-verified compatibility flag; it preserves legacy data, current salary-cycle rules, closed-month fencing, and existing API/UI behavior until activation.

## Tasks

- [x] 1. Establish the managed-pocket persistence and feature-flag foundation
  - [x] 1.1 Add `POCKET_MANAGEMENT_ENABLED` and `POCKET_MANAGEMENT_DUAL_WRITE` configuration parsing, safe defaults, and feature helpers in `config.js`, `.env.example`, and `utils/rollout.js`.
    - Expose flags through `app.locals.configuration` without changing feature-off behavior; managed routes must be unavailable while the primary flag is false.
    - _Requirements: 12.15_
  - [x] 1.2 Create `models/pocketDefinition.js` and `models/pocketAssignment.js` with the approved schemas, audit/version/timestamp fields, embedded allocation validation, and required unique/sort indexes.
    - Enforce unique normalized names and unique `(pocketId, budgetYear, budgetMonth)` assignments at the database layer; expose DTO-ready immutable snapshots.
    - _Requirements: 1.1–1.5, 2.4, 3.3, 5.5–5.10, 7.1–7.4, 10.1, 10.5–10.6_
  - [x] 1.3 Evolve `models/transaction.js` additively with `pocketId` and `sourceBreakdowns[].pocketId`, compatibility fields, and managed-mode indexes while retaining legacy documents during rollout.
    - Do not remove legacy pocket strings or existing indexes; managed identifiers must be queryable by stored Budget Month and canonical expense date.
    - _Requirements: 4.7–4.8, 8.8–8.12, 12.7–12.10_

- [x] 2. Build pure pocket canonicalization, planning, and safe error primitives
  - [x] 2.1 Implement `services/pocketValidation.js` for name normalization, grapheme-aware emoji validation, cadence/rupiah validation, deterministic multi-field errors, assignment canonical equality, and DTO serialization helpers.
    - Use `Intl.Segmenter` for one user-perceived emoji; share these rules with migration logic and never persist a partially valid command.
    - _Requirements: 2.1–2.8, 3.4–3.9, 6.11–6.12_
  - [x] 2.2 Implement `services/pocketAssignmentPlanner.js` to derive salary-cycle ISO weeks, canonicalize monthly/weekly `Use_Default` and `Customize` plans, validate keys/amounts, and calculate assignment totals.
    - Derive cadence, defaults, and weeks server-side; return every independently evaluable entry error in deterministic order.
    - _Requirements: 5.10–5.13, 6.1–6.14, 9.9–9.10_
  - [x] 2.3 Extend `utils/domainErrors.js` and `middleware/errorHandler.js` with sanitized multi-error validation, lifecycle, version, feature-disabled, and assignment errors.
    - Allowlist only safe recovery metadata (field, entry index, authorized ID/month, current version); retain request IDs and never disclose values, names, bodies, sessions, or database details.
    - _Requirements: 1.6–1.8, 3.10–3.12, 4.12–4.14, 5.11–5.13, 7.7–7.9, 9.1–9.3, 10.2–10.4_
  - [ ]* 2.4 Write boundary/example tests in `test/unit/pocketValidation.test.js` and `test/domainErrors.test.js` for cadence, emoji, name, rupiah, unknown-ID, week, and sanitized error cases.
    - Verify exact field paths, full multi-error accumulation, and request-ID-safe API error envelopes.
    - _Requirements: 2.1–2.8, 3.10, 4.14, 6.5, 6.11–6.12, 8.6–8.7_
  - [ ]* 2.5 Write `test/property/pocketDefinitionCreation.property.test.js` for **Property 1: Definition creation is a single-record preserving round trip**.
    - Use `test/helpers/property.js` with the required feature/property comment and assert preservation of arbitrary preexisting state.
    - **Validates: Requirements 1.1–1.5**
  - [ ]* 2.6 Write `test/property/pocketDefinitionValidation.property.test.js` for **Property 2: Definition validation is complete and state preserving**.
    - **Validates: Requirements 2.1–2.3, 2.5, 2.7–2.8, 3.9**
  - [ ]* 2.7 Write `test/property/pocketNameUniqueness.property.test.js` for **Property 3: Normalized name equality defines uniqueness**.
    - **Validates: Requirements 2.4**
  - [ ]* 2.8 Write `test/property/pocketDefinitionListing.property.test.js` for **Property 4: Definition listing is a complete ordered lifecycle partition**.
    - **Validates: Requirements 3.1–3.3**
  - [ ]* 2.9 Write `test/property/pocketDefinitionUpdate.property.test.js` for **Property 5: Definition updates obey patch, version, and no-op semantics**.
    - **Validates: Requirements 3.4–3.8, 10.5**
  - [ ]* 2.10 Write `test/property/pocketSnapshotIsolation.property.test.js` for **Property 6: Confirmed snapshots are isolated from later definition changes**.
    - **Validates: Requirements 3.13–3.14, 6.15, 7.11–7.12**
  - [ ]* 2.11 Write `test/property/pocketLifecycle.property.test.js` for **Property 7: Lifecycle transitions change availability without changing references**.
    - **Validates: Requirements 4.3–4.4, 4.6–4.9, 4.11**
  - [ ]* 2.12 Write `test/property/pocketAssignmentSetup.property.test.js` for **Property 8: Assignment setup is a complete status projection**.
    - **Validates: Requirements 5.1–5.2, 5.16**
  - [ ]* 2.13 Write `test/property/pocketDefaultAllocation.property.test.js` for **Property 9: Default allocation planning follows cadence and intersecting weeks**.
    - **Validates: Requirements 6.1–6.2**
  - [ ]* 2.14 Write `test/property/pocketCustomAllocation.property.test.js` for **Property 10: Custom allocation keys and values exactly match the required plan**.
    - **Validates: Requirements 6.3–6.5, 6.11–6.12**

- [x] 3. Implement the Pocket Management aggregate service
  - [x] 3.1 Create `services/pocketManagementService.js` with injected models/clock/connection and commands to create, list, patch, archive, restore, load setup, confirm assignments, remove assignments, and list assignment-backed expense options.
    - Apply authentication and Wife-role defense in depth; use compare-and-set versions, canonical no-ops, active/archived lifecycle rules, deterministic sorting, `withOpenBudgetPeriods`, and MongoDB transactions with bounded transient retries.
    - Confirmation must validate the complete batch before writes, atomically reconcile inserts/updates/no-ops, preserve omitted assignments, and return a fresh complete monthly result and combined total only after commit.
    - _Requirements: 1.1–1.8, 3.1–3.14, 4.3–4.14, 5.1–5.19, 6.1–6.16, 7.1–7.10, 9.1–9.10, 10.1–10.13_
  - [ ]* 3.2 Write `test/property/pocketAssignmentConfirmation.property.test.js` for **Property 11: Successful confirmation persists the canonical assignment result**.
    - **Validates: Requirements 5.5–5.9, 6.8–6.9, 6.13**
  - [ ]* 3.3 Write `test/property/pocketAssignmentAtomicity.property.test.js` for **Property 12: Any confirmation error rejects the complete batch**.
    - **Validates: Requirements 5.11–5.13, 9.9–9.10**
  - [ ]* 3.4 Write `test/property/pocketAssignmentIdempotence.property.test.js` for **Property 13: Repeating an equivalent confirmation is idempotent**.
    - **Validates: Requirements 5.17, 6.16**
  - [ ]* 3.5 Write `test/property/pocketAssignmentIsolation.property.test.js` for **Property 14: Assignment aggregates are isolated by pocket and month**.
    - **Validates: Requirements 6.14, 7.1–7.4**
  - [ ]* 3.6 Write `test/property/pocketAssignmentRemoval.property.test.js` for **Property 15: Assignment removal is confirmed, spending-safe, and key isolated**.
    - **Validates: Requirements 7.7–7.10**
  - [ ]* 3.7 Add replica-set service/database tests in `test/integration/pocketManagementService.test.js` for unique-index conflicts, rollback injection at each write boundary, no partial committed assignment set, archive/restore, and assignment-removal spending checks.
    - Assert actual indexes and transaction outcomes rather than in-memory approximations.
    - _Requirements: 1.8, 2.9, 4.4–4.10, 5.18–5.19, 7.8–7.10, 10.1–10.2_

- [x] 4. Integrate managed assignments into budget, transaction, and reporting reads/writes
  - [x] 4.1 Refactor `services/budgetService.js` and `services/budgetCalculationService.js` to prefer managed assignment snapshots when enabled and return only assignments for the selected Budget Month.
    - Preserve feature-off and guarded fallback readers; calculate monthly/weekly allocations, salary-cycle/week intersection spending, split shares, totals, remaining, percentages, and intentional zero-assignment views without fixed-pocket substitution.
    - _Requirements: 5.14–5.15, 7.11–7.12, 8.1–8.7, 8.13–8.14, 12.15–12.17_
  - [ ]* 4.2 Write `test/property/pocketBudgetView.property.test.js` for **Property 16: Budget views contain exactly the selected month’s assignments**.
    - **Validates: Requirements 5.14, 8.1**
  - [ ]* 4.3 Write `test/property/pocketMonthlyAttribution.property.test.js` for **Property 17: Monthly attribution includes each eligible spending contribution**.
    - **Validates: Requirements 8.2**
  - [ ]* 4.4 Write `test/property/pocketWeeklyAttribution.property.test.js` for **Property 18: Weekly attribution is limited to the salary-cycle/week intersection**.
    - **Validates: Requirements 8.3**
  - [ ]* 4.5 Write `test/property/pocketMetrics.property.test.js` for **Property 19: Pocket metrics obey the allocation formulas**.
    - **Validates: Requirements 8.4–8.6**
  - [ ]* 4.6 Write `test/property/pocketTotals.property.test.js` for **Property 21: Allocation and spending totals count canonical contributions exactly once**.
    - **Validates: Requirements 5.10, 8.13–8.14**
  - [x] 4.7 Update `services/transactionService.js`, `utils/transactionDto.js`, and transaction validation/filtering paths to validate new and updated single/split expense IDs against the server-derived month assignment and render existing labels from snapshots.
    - Keep legacy names as compatibility projections only; include archived-but-assigned IDs exactly once and reject active-but-unassigned IDs without changing expense state.
    - _Requirements: 4.7, 8.8–8.12, 12.9–12.10_
  - [x] 4.8 Update `services/reportingService.js`, transaction/history/dashboard adapters, and relevant controllers to filter/manage pockets by IDs while preserving legacy aliases and historical snapshot presentation.
    - No report may join a current definition to overwrite a historical assignment label, cadence, amount, or totals.
    - _Requirements: 7.11–7.12, 8.1–8.14, 12.11, 12.16–12.17_
  - [ ]* 4.9 Write `test/property/pocketExpenseEligibility.property.test.js` for **Property 20: Expense pocket options and references equal month assignments**.
    - **Validates: Requirements 4.7, 8.8–8.12**
  - [ ]* 4.10 Add integration coverage in `test/integration/pocketBudgetTransactionReporting.test.js` for empty months, monthly/weekly/split attribution boundaries, archived options, unassigned update rejection, and snapshot-backed historical views.
    - _Requirements: 5.14–5.15, 7.11–7.12, 8.1–8.14, 12.16–12.17_

- [x] 5. Add the managed Pocket HTTP/page surface and contract safeguards
  - [x] 5.1 Create `controllers/pocketController.js` and `routes/pockets.js`; register them in `app.js` using the existing actor/options/`asyncHandler` factories and explicit authenticated/Wife middleware.
    - Implement every approved page/API route, normalized ID/month input, `{ success: true, data }` mutation envelopes, and feature-disabled behavior before accessing managed data.
    - _Requirements: 1.6–1.7, 3.1–3.3, 4.12–4.14, 5.1–5.2, 9.1–9.3, 10.7–10.9, 11.1_
  - [ ]* 5.2 Add `test/integration/pocketRoutes.test.js` supertest coverage for every managed route with unauthenticated, Husband, and Wife agents, including common error sanitization and feature-on/off compatibility.
    - Assert middleware and service authorization, deterministic multi-error envelopes, 401 no-disclosure, and retained legacy response fields.
    - _Requirements: 1.6–1.7, 3.12, 4.12–4.14, 9.1–9.3, 10.7–10.9, 12.15_

- [x] 6. Deliver the accessible Pocket Management interface and wire existing pages
  - [x] 6.1 Create `views/pocket-management.hbs` and add navigation/action entry points from `views/check-pockets.hbs`, `views/log-spending.hbs`, and applicable existing page shells.
    - Provide one heading; role-aware create/manage/setup sections; ordered forms; semantic summary/empty states; archive and removal confirmation dialogs; screen-reader status/error regions; and server capability/flag bootstrap values.
    - _Requirements: 4.1–4.2, 5.3–5.4, 5.14–5.16, 6.6–6.7, 7.5–7.6, 10.7–10.9, 11.1–11.25_
  - [x] 6.2 Implement `public/js/pocket-management.js` as an ID-keyed staged state module for loading definitions/setup, selection deduplication, default/custom allocation toggles, summaries, requests, field errors, retry, and version-conflict keep/load recovery.
    - Do not persist selection/mode/draft changes until confirm; disable only pending actions; replace state from canonical success responses; retain drafts on failures.
    - _Requirements: 5.3–5.4, 6.6–6.7, 10.7–10.9, 11.5–11.12_
  - [x] 6.3 Update `public/js/check-pockets.js`, `public/js/log-spending.js`, and their templates to consume assignment-backed `pocketId` options and managed budget DTOs without changing feature-off interactions.
    - Surface Start setup for an active empty month and managed snapshot labels/emoji in budget and expense flows.
    - _Requirements: 4.6–4.11, 5.14–5.16, 7.11–7.12, 8.1–8.12, 12.15–12.17_
  - [x] 6.4 Extend `src/input.css` and rebuild source styles for responsive, high-contrast, reduced-motion-aware management cards, inputs, dialogs, focus rings, and 44px mobile primary targets.
    - Preserve established journal tokens, shape, spacing, dialog, and status patterns; keep DOM and visible order aligned with no horizontal scrolling at 320–767px.
    - _Requirements: 11.13–11.25_
  - [ ]* 6.5 Add jsdom UI tests in `test/ui/pocketManagement.test.js` for form/order/prepopulation, setup staging, default/custom transitions, summaries, dialog cancel paths, pending/success/failure/retry, field error associations, and version conflict recovery.
    - Use fake timers for the post-response 200ms status requirement and assert that pre-confirm UI interactions make no mutation request.
    - _Requirements: 4.1–4.2, 5.3–5.4, 6.6–6.7, 7.5–7.6, 10.7–10.9, 11.1–11.12, 11.16–11.19_
  - [ ]* 6.6 Add browser-capable viewport/accessibility tests under `test/ui/` for 320/321/480/767/768px layouts, keyboard order, dialog focus trap/restoration, accessible names/live status, contrast/focus targets, and reduced-motion timing.
    - Confirm no horizontal primary-content overflow, 44px targets, and decorative transitions no longer than 200ms when motion is permitted.
    - _Requirements: 11.13–11.25_

- [x] 7. Enforce editable-window, authorization, and concurrency policies across managed mutations
  - [x] 7.1 Integrate the managed service with `services/budgetPeriodGuard.js`, salary-cycle resolution, and structured safe operation events to recheck active/next open months, lifecycle, versions, and references inside each transaction.
    - Ensure no-op commands preserve audit/timestamps; persistence success is emitted only after commit; non-transient business conflicts are never auto-retried.
    - _Requirements: 5.18–5.19, 9.3–9.10, 10.1–10.6_
  - [ ]* 7.2 Write `test/property/pocketAuthorization.property.test.js` for **Property 22: Unauthorized actors cannot mutate pocket state**.
    - **Validates: Requirements 1.6, 3.12, 4.13, 9.3**
  - [ ]* 7.3 Write `test/property/pocketEditableWindow.property.test.js` for **Property 23: Editable-window policy accepts exactly the active and next month**.
    - **Validates: Requirements 9.4–9.5**
  - [ ]* 7.4 Write `test/property/pocketOptimisticVersion.property.test.js` for **Property 24: Optimistic versions reject stale writes and increment changed writes once**.
    - **Validates: Requirements 10.3–10.6**
  - [ ]* 7.5 Add barrier-driven replica-set concurrency tests in `test/concurrency/pocketManagement.test.js` for duplicate names, equivalent/different concurrent assignment creates, stale updates, period-close races, retries, and complete winning audit/version tuples.
    - Never assume which valid writer wins; assert exactly one canonical persisted outcome and no partial state.
    - _Requirements: 2.9, 5.17–5.19, 9.6–9.8, 10.1–10.13_

- [x] 8. Extend the controlled migration and compatibility lifecycle
  - [x] 8.1 Extend `services/migrationTransformService.js` with the `pocket-management-v1` transform: deterministic normalized-name IDs, latest-cadence resolution, active zero-default definitions, period snapshots, transaction/split associations, blockers, and preservation checks.
    - Produce bounded, order-independent preview items; migrate unambiguous groups while retaining all unmappable records and every legacy source field.
    - _Requirements: 12.1–12.14_
  - [x] 8.2 Extend `services/migrationService.js`, `models/migrationPreview.js`, and `models/migrationPreviewItem.js` to approve, execute, verify, and rollback the new managed preview within the existing fingerprint/current-value safeguards.
    - Commit executable managed documents, transaction associations, compatibility projections, and preview state atomically; blocked groups remain untouched.
    - _Requirements: 10.1–10.2, 12.11–12.14_
  - [x] 8.3 Implement compatibility dual-read/dual-write projection adapters in the managed service, budget/transaction/reporting services, and migration reads.
    - Prefer a verified managed assignment; use legacy fallback only for unmigrated records; track fallback use and prevent activation with ambiguous double sources.
    - _Requirements: 7.11–7.12, 8.1–8.14, 12.15–12.17_
  - [ ]* 8.4 Write `test/property/pocketMigrationDefinitions.property.test.js` for **Property 25: Legacy definitions are deterministic and cadence-derived**.
    - **Validates: Requirements 12.1–12.6**
  - [ ]* 8.5 Write `test/property/pocketMigrationAssociations.property.test.js` for **Property 26: Migration associations preserve source financial records and isolate blockers**.
    - **Validates: Requirements 12.7–12.10, 12.13–12.14**
  - [ ]* 8.6 Write `test/property/pocketMigrationFixedPoint.property.test.js` for **Property 27: Migration is a history-preserving fixed point**.
    - **Validates: Requirements 12.11–12.12, 12.16**
  - [ ]* 8.7 Add migration lifecycle tests in `test/migration/pocketManagementMigration.test.js` for preview bounds, shuffled sources, cadence conflicts, partial progress, stale preview rejection, transactional rollback, rerun idempotence, and historical route equivalence.
    - _Requirements: 10.1–10.2, 12.1–12.17_

- [x] 9. Add activation verification and release safeguards in executable tooling
  - [x] 9.1 Extend `scripts/rollout-preflight.js` to require managed schema paths/indexes, transaction support, normalized-name/composite-key duplicate checks, flag-safe route smoke coverage, and managed-without-fixed-constants readiness.
    - Preflight must fail closed before `POCKET_MANAGEMENT_ENABLED` can be enabled.
    - _Requirements: 2.4, 5.18–5.19, 10.1–10.2, 12.15_
  - [x] 9.2 Extend `scripts/rollout-verify.js`, `scripts/run-acceptance-profile.js`, and `scripts/run-test-phase.js` with managed migration verification, pre/post budget/transaction/report equivalence, zero-fallback observation checks, and phase coverage for new suites.
    - Preserve feature-off compatibility and make failed verification/rollout conditions machine-detectable for a safe flag rollback.
    - _Requirements: 8.1–8.14, 10.1–10.2, 12.11–12.17_
  - [ ]* 9.3 Add rollout compatibility and readiness tests in `test/rolloutCompatibility.test.js` and `test/rolloutReadiness.test.js` for flag-off legacy behavior, verified managed activation, required route smoke paths, zero legacy fallback before retirement, and disabled-flag rollback.
    - _Requirements: 12.15–12.17_

- [x] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Final verification wiring
  - [x] 11.1 Update the acceptance-profile manifests and feature test registration so all new unit, property, integration, UI, migration, concurrency, and rollout suites are executed by their existing named phases.
    - Completion requires every listed test file to be discoverable without adding a separate runner or bypassing existing phase isolation.
    - _Requirements: 1.1–12.17_

- [x] 12. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test tasks; core implementation, migration, integration, and release-safeguard work is not optional.
- All planned implementation is JavaScript because the approved design and current repository use Node.js/CommonJS, Express, Mongoose, Handlebars, browser JavaScript, and Tailwind CSS.
- Property tasks use the approved 27 correctness properties exactly once and must retain the required feature/property comments plus `test/helpers/property.js` options.
- The migration stays additive and reversible: feature flags default off, preview before execution, verification before activation, and disabling the flag remains the immediate application rollback.
- This plan intentionally excludes deployment, manual UAT, documentation, and non-code operations.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "2.3"] },
    { "id": 2, "tasks": ["2.2"] },
    { "id": 3, "tasks": ["2.4", "2.13", "2.14", "3.1"] },
    { "id": 4, "tasks": ["2.5", "2.6", "2.7", "2.8", "2.9", "2.10", "2.11", "2.12", "3.2", "3.3", "3.4", "3.5", "3.6", "3.7"] },
    { "id": 5, "tasks": ["4.1", "4.7", "5.1", "7.1", "8.1"] },
    { "id": 6, "tasks": ["4.2", "4.3", "4.4", "4.5", "4.6", "4.8", "4.9", "4.10", "5.2", "7.2", "7.3", "7.4", "7.5", "8.2", "8.4", "8.5"] },
    { "id": 7, "tasks": ["6.1", "8.3", "8.6", "8.7"] },
    { "id": 8, "tasks": ["6.2", "6.3", "6.4", "9.1"] },
    { "id": 9, "tasks": ["6.5", "6.6", "9.2"] },
    { "id": 10, "tasks": ["9.3"] },
    { "id": 11, "tasks": ["11.1"] }
  ]
}
```
