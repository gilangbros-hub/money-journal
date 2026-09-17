# Implementation Plan: Salary-Cycle Budgeting

## Overview

Implement salary-cycle Budget_Month assignment and per-pocket Monthly/Weekly cadence incrementally in the existing Node.js, Express, Mongoose, Handlebars, and browser-JavaScript application. The sequence establishes pure date logic and additive storage first, then guarded transaction and budget services, reporting and UI integration, a previewed migration lifecycle, and backward-compatible rollout gates. Every step writes, modifies, or tests code; each executable correctness property from the design is placed next to the implementation it validates.

## Tasks

- [x] 1. Establish runtime, validation, and automated-test foundations
  - [x] 1.1 Configure the JavaScript test and date-tooling stack
    - Update `package.json` and `package-lock.json` with `@js-temporal/polyfill`, `fast-check`, `supertest`, `jsdom`, and a replica-set-capable isolated MongoDB test dependency.
    - Add non-watch `node --test` scripts for unit, property, integration, UI, migration, concurrency, and complete test profiles; keep production startup behavior unchanged.
    - _Requirements: 10.3, 10.10, 11.1, 12.12_

  - [x] 1.2 Implement validated startup configuration and feature flags
    - Add a configuration module for `HOUSEHOLD_TIME_ZONE` with the `Asia/Jakarta` default and Temporal-based IANA validation.
    - Add `SALARY_CYCLE_BUDGETING_ENABLED` with a safe disabled default, inject validated configuration into application startup, and prevent listener startup for an invalid zone.
    - Update `.env.example` with non-secret configuration keys and safe defaults.
    - _Requirements: 11.1, 11.2, 11.7_

  - [x] 1.3 Add typed domain errors and a common HTTP error adapter
    - Implement field-specific validation, authentication, authorization, closed-period, editable-window, assignment-conflict, concurrent-write, migration-conflict, not-found, and storage errors.
    - Add a safe response envelope and request identifier handling without exposing stack traces, database details, sessions, or financial payloads.
    - _Requirements: 1.6, 2.8, 3.5, 3.9, 4.8, 4.9, 5.9, 5.10, 8.9, 8.11, 9.6, 9.7, 10.10, 10.11, 11.8, 12.6, 12.7, 12.8, 12.14, 12.16_

  - [x] 1.4 Create shared deterministic test infrastructure
    - Add injected clock, time-zone, feature-flag, notification, database-session, authenticated-agent, and isolated-database helpers under the test tree.
    - Add reusable fast-check arbitraries for strict calendar dates, Budget_Months, real ISO weeks, safe integer rupiah, unique pocket shares, mixed cadence state, legacy records, and correlated concurrent writes.
    - Configure property failures to retain seed, shrink path, and counterexample, with at least 100 runs per property.
    - _Requirements: 1.5, 3.10, 10.3, 11.4, 11.5, 12.12, 12.13_

- [x] 2. Implement the pure Salary Cycle Resolver
  - [x] 2.1 Implement strict date, Budget_Month, payday, period, assignment, and active-month functions
    - Create `services/salaryCycleResolver.js` with strict `YYYY-MM-DD` and `YYYY-MM` parsing through Temporal calendar types, field-specific failures, adjusted-payday calculation, inclusive assignment, December rollover, salary-cycle boundaries, and an injected-instant active Budget_Month.
    - Keep the module pure: do not read MongoDB, sessions, process-local dates, or JavaScript `Date` for date-only decisions.
    - _Requirements: 1.1-1.6, 2.1-2.8, 9.1-9.3, 9.9, 11.1-11.5, 11.8-11.10_

  - [x] 2.2 Implement ISO Calendar_Week parsing, listing, and intersection
    - Extend the resolver with strict `YYYY-Www` validation, real ISO week identity checks, Monday/Sunday descriptors, ordered distinct week listing, and inclusive period/week intersection.
    - Include crossing weeks in both adjacent Salary_Cycle_Period lists without assigning any date to both periods.
    - _Requirements: 5.2-5.5, 5.9, 5.10, 11.1, 11.5, 12.3, 12.7_

  - [x] 2.3 Write the property test for payday weekend adjustment
    - **Property 1: Payday weekend adjustment**
    - Add `Feature: salary-cycle-budgeting, Property 1: Payday weekend adjustment` and an independent day-of-week oracle covering all weekdays, leap years, and weekend shifts to Friday.
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**

  - [x] 2.4 Write the property test for contiguous salary-cycle periods
    - **Property 2: Salary-cycle periods form a contiguous partition**
    - Generate adjacent Budget_Months and boundary dates; prove adjacency, no overlap, and exactly-one-period membership with an independent Temporal oracle.
    - **Validates: Requirements 2.4, 2.5, 2.6, 2.7**

  - [x] 2.5 Write the property test for the inclusive payday assignment boundary
    - **Property 3: Payday is the inclusive assignment boundary**
    - Generate valid dates throughout each month and matching exact instants for active-month resolution; verify pre-payday and on/after-payday behavior.
    - **Validates: Requirements 2.1, 2.2, 9.1, 9.2**

  - [x] 2.6 Write the property test for December rollover
    - **Property 4: December assignment rolls into the following year**
    - Generate December dates from Actual_Payday through month-end and verify January assignment and January period start, including weekend paydays.
    - **Validates: Requirements 2.3, 2.4, 9.3**

  - [x] 2.7 Write the property test for ISO week partitioning
    - **Property 7: ISO weeks partition each salary-cycle period**
    - Generate Budget_Months across leap-year, month, calendar-year, and ISO week-year boundaries; compare ordered week descriptors and one-week-per-date membership to an independent oracle.
    - **Validates: Requirements 5.2**

- [x] 3. Add additive salary-cycle data models and indexes
  - [x] 3.1 Evolve the Transaction model for canonical date-only storage
    - Update `models/transaction.js` with canonical `expenseDate`, assignment/schema versions, compatibility `date`, authoritative numeric Budget_Month fields, preserved split fields, timestamps, and reporting indexes.
    - Preserve mixed schema-version reads and existing identifiers/fields during rollout.
    - _Requirements: 3.1-3.5, 6.11, 10.8, 11.3, 11.6, 11.10, 12.8_

  - [x] 3.2 Evolve PocketBudget as the in-place Monthly_Allocation model
    - Add updater, version, and schema-version fields while preserving the existing collection, `_id`, `budget` field, timestamps, and unique `(pocket, month, year)` key.
    - Ensure whole-record accepted updates correlate amount and audit metadata.
    - _Requirements: 4.3, 5.8, 10.1, 10.2, 12.9, 12.11-12.14_

  - [x] 3.3 Add cadence and Weekly_Allocation models
    - Create `PocketBudgetCadence` and `WeeklyAllocation` schemas with enums, audit/version fields, exact Monthly and Weekly composite unique indexes, and period/pocket read indexes.
    - Keep weekly records in a separate collection so legacy monthly readers remain compatible.
    - _Requirements: 4.1-4.7, 5.5-5.8, 12.3, 12.10-12.13_

  - [x] 3.4 Evolve ClosedMonth into the persistent BudgetPeriod guard
    - Add `isClosed`, `closedAt`, `updatedBy`, `mutationSequence`, and schema version while preserving existing close identity and audit data.
    - Reopening must update the guard rather than delete it; retain the unique month/year key.
    - _Requirements: 8.1-8.8, 9.8, 10.9_

  - [x] 3.5 Add immutable migration preview and preview-item models
    - Create preview status, approval, fingerprint, count, actor, and execution metadata plus exact ordered Extended JSON before/after items and blocking reasons.
    - Add uniqueness and executable-item indexes needed for deterministic approval, execution, verification, and rollback.
    - _Requirements: 10.4, 10.5, 10.7, 10.11-10.13_

  - [x] 3.6 Test mixed-version models, composite uniqueness, and index preconditions
    - Add model tests for legacy-compatible reads, schema-v2 validation, preserved identifiers/timestamps, unique monthly/weekly/cadence keys, duplicate preflight failure, and guard persistence after reopen.
    - _Requirements: 4.1-4.4, 5.5, 10.2, 10.8, 10.9, 12.9-12.13_

- [x] 4. Make transaction assignment authoritative and atomic
  - [x] 4.1 Implement canonical transaction validators, DTO mappers, and split normalization
    - Add strict Expense_Date, identifier, amount, category, pocket, payer, and source validators; require one-to-three unique positive integer-rupiah shares whose exact sum equals the expense amount.
    - Map canonical `expenseDate` to an unchanged edit/response string and a local-noon legacy compatibility instant; never silently downgrade invalid multi-pocket input.
    - _Requirements: 3.3-3.10, 6.4-6.6, 6.11, 11.3, 11.6, 11.8, 11.10, 12.8_

  - [x] 4.2 Implement the reusable open-period transaction guard
    - Add `withOpenBudgetPeriod` to require and fence an open guard in the same MongoDB transaction as each protected write.
    - Support sorted source/destination guard acquisition for cross-period expense edits and typed rejection with no partial mutation.
    - _Requirements: 3.1, 3.2, 8.1-8.8, 9.8_

  - [x] 4.3 Implement TransactionService create, update, delete, get, and list commands
    - Derive Budget_Month from Expense_Date, accept omitted or matching legacy budget fields, reject conflicts with the derived month/year, and atomically persist canonical date, assignment, splits, and compatibility fields.
    - Enforce source/destination closed guards on create/update/delete, keep stored assignment authoritative on reads, and queue notifications only after commit.
    - _Requirements: 3.1-3.5, 3.9, 3.10, 6.11, 8.3-8.7, 11.3-11.6, 12.8, 12.13_

  - [x] 4.4 Refactor transaction controllers/routes and add assignment preview
    - Make `controllers/transactionController.js` a thin adapter over TransactionService and the common error mapper.
    - Add authenticated `GET /api/salary-cycle/assignment?date=YYYY-MM-DD`; retain existing transaction routes and compatibility response aliases.
    - Preserve authentication behavior and prevent unauthorized data disclosure.
    - _Requirements: 3.3-3.9, 7.5, 7.6, 8.10, 8.11, 12.15, 12.16_

  - [x] 4.5 Add transaction service/database integration tests
    - Test canonical create, same-period update, cross-period update, delete, split validation, omitted/matching/conflicting legacy fields, mixed schema reads, closed source/destination rejection, deterministic guard order, rollback, and post-commit notification failure.
    - Compare complete before/after records for rejected commands to prove atomicity.
    - _Requirements: 3.1-3.5, 3.9, 6.11, 8.3-8.7, 11.3, 12.8, 12.13_

  - [x] 4.6 Add authenticated transaction and assignment route tests
    - Exercise Wife, non-Wife household, and unauthenticated agents; assert stable errors, exact saved/edit dates, assignment conflict details, existing route compatibility, and no data disclosure.
    - _Requirements: 3.3-3.9, 8.10, 8.11, 11.6, 12.15, 12.16_

  - [x] 4.7 Write the property test for deterministic, metadata-independent assignment
    - **Property 5: Assignment is deterministic and metadata-independent**
    - Generate two valid non-date transaction DTOs for one date/zone and prove repeated resolver and assignment-mapper outputs are identical despite payer, role, category, note, amount, or pocket changes.
    - **Validates: Requirements 1.5, 2.5, 3.10**

  - [x] 4.8 Write the property test for time-zone-independent date-only round trips
    - **Property 6: Date-only assignment and round trips are time-zone independent**
    - Generate dates, months, supported IANA zones, and contrasting client/host offsets; include a small subprocess `TZ` matrix and canonical storage/DTO round trips without parsing date-only values through UTC midnight.
    - **Validates: Requirements 11.1, 11.3, 11.4, 11.5, 11.6, 11.10**

- [x] 5. Implement cadence-aware budget calculations and guarded writes
  - [x] 5.1 Implement pure spending expansion, metrics, aggregate, and status helpers
    - Create `services/budgetCalculationService.js` to expand single expenses once and split expenses only into Pocket_Shares, then calculate monthly/weekly spending, missing-allocation behavior, remaining, rounded percentage, alerts, and Check Pockets statuses.
    - Make eligibility depend on stored Budget_Month, pocket, and—only for weekly metrics—the inclusive period/week intersection.
    - _Requirements: 6.1-6.12, 7.2, 7.3, 7.7-7.15, 12.2, 12.5_

  - [x] 5.2 Write the property test for exact Pocket_Share conservation
    - **Property 9: Pocket-share expansion conserves spending exactly once**
    - Generate single and one-to-three-pocket split expenses with mixed cadence; compare both totals and item multisets to an independent expected-share oracle.
    - **Validates: Requirements 6.1, 6.3, 6.4, 6.5, 6.6, 6.11, 6.12, 7.8**

  - [x] 5.3 Write the property test for balance and percentage arithmetic
    - **Property 11: Remaining balance and percentage arithmetic are consistent**
    - Generate safe-range allocation/spending pairs plus missing allocations, explicitly covering zero, equality, one-rupiah under/over, and large values across pocket, week, and aggregate helpers.
    - **Validates: Requirements 6.7, 6.8, 6.9, 6.10, 7.13, 7.14, 7.15**

  - [x] 5.4 Implement BudgetService salary-cycle reads
    - Create `services/budgetService.js` read methods returning validated Budget_Month, time zone, inclusive period, intersecting weeks, cadence, exact active/missing allocations, pocket metrics, aggregate metrics, close state, and server-authoritative `canEdit`.
    - Default absent legacy cadence to Monthly without creating records and ensure aggregate spending is counted once.
    - _Requirements: 4.1-4.6, 5.1-5.6, 6.1-6.12, 7.1-7.3, 7.7-7.15, 9.1-9.9, 12.1-12.7_

  - [x] 5.5 Implement BudgetService cadence, allocation, close, reopen, and delete commands
    - Enforce Wife role, strict keys/amounts, active-or-next editable window, open BudgetPeriod guard, weekly-period intersection, inactive-allocation confirmation, preservation of inactive records, and exact-key isolation.
    - Use complete atomic upserts with versions and duplicate-key retry for accepted-write ordering; close/reopen must serialize against protected expense and budget mutations.
    - _Requirements: 4.1-4.12, 5.5-5.10, 8.1-8.10, 9.4-9.9, 12.8-12.14_

  - [x] 5.6 Write the property test for cadence/allocation key isolation
    - **Property 10: Cadence and allocation updates are isolated by key**
    - Generate normalized cadence, monthly, and multi-week state; apply one pure transition and prove only the target key changes, inactive allocations remain stored, and only active cadence affects calculations.
    - **Validates: Requirements 4.3, 4.4, 4.5, 4.6, 4.7, 4.12, 5.7**

  - [x] 5.7 Write the property test for crossing-week attribution
    - **Property 8: Crossing-week attribution uses the period intersection**
    - Generate Actual_Payday-crossing weeks, dates on both sides, pockets, and positive amounts; prove the week appears in both lists while each item contributes only to its stored period/intersection.
    - **Validates: Requirements 5.4, 6.2**

  - [x] 5.8 Add budget service/database integration tests
    - Cover monthly/weekly retrieval and upsert, missing allocations, cadence confirmation/cancel, inactive retention, exact week validation, editable boundaries, role enforcement, close/reopen, protected deletes, aggregate/status thresholds, and complete rollback on rejection.
    - Race close/reopen with expense, cadence, and allocation mutations and verify one complete serializable outcome.
    - _Requirements: 4.1-4.12, 5.1-5.10, 6.1-6.12, 7.7-7.15, 8.1-8.10, 9.1-9.9, 12.1-12.14_

  - [x] 5.9 Write the property test for concurrent allocation integrity
    - **Property 13: Concurrent allocation writes preserve uniqueness and complete accepted values**
    - Run at least 100 generated Monthly and Weekly write races against the isolated replica-set fixture with production indexes, correlated request tokens, varied delays, duplicate-key retries, and explicit conflict paths.
    - Assert at most one exact-key record and require every final amount/audit field to match one complete accepted request and its committed version order.
    - **Validates: Requirements 5.8, 12.9, 12.10, 12.11, 12.12, 12.13, 12.14**

- [x] 6. Checkpoint - Ensure core service tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Integrate cadence-aware APIs and reporting
  - [x] 7.1 Implement ReportingService over stored assignments and active cadence
    - Create `services/reportingService.js` for dashboard totals, categories, roles, recent expenses, previous named-Budget_Month comparison, alerts, and history filtering.
    - Join BudgetService active allocations, count each transaction/share once, preserve canonical Expense_Date, and match pocket filters against single pockets or split shares while displaying each transaction once.
    - _Requirements: 6.12, 7.4-7.10, 7.13-7.15, 10.15, 12.2-12.5, 12.15_

  - [x] 7.2 Refactor budget controllers and extend budget routes
    - Route budget reads, history, legacy monthly saves/deletes, close/reopen, cadence writes, monthly writes, weekly writes, and typed allocation deletes through BudgetService and the common error adapter.
    - Preserve `GET/POST/DELETE /api/budget` compatibility while adding explicit cadence/allocation routes and salary-cycle response fields.
    - _Requirements: 4.1-4.12, 5.1-5.10, 8.1-8.11, 9.4-9.8, 12.1-12.16_

  - [x] 7.3 Refactor dashboard and history controllers/routes to ReportingService
    - Keep existing authenticated Monthly Story, Review History, dashboard summary, and transaction list routes while validating `YYYY-MM` strictly and returning period/date metadata.
    - Remove controller-side host/device month defaults and direct monthly-only allocation assumptions.
    - _Requirements: 7.1, 7.4-7.10, 10.15, 11.5, 11.6, 12.6, 12.15, 12.16_

  - [x] 7.4 Add budget/reporting API and service integration tests
    - Test canonical response contracts, monthly and selected-week metrics, crossing weeks, alert/status thresholds, stored-assignment precedence, split pocket filtering, prior named-month comparison, legacy budget payloads, and role/authentication behavior.
    - Add smoke coverage for every existing authenticated budget, transaction, dashboard, and history route with feature behavior enabled and disabled.
    - _Requirements: 6.1-6.12, 7.1-7.15, 8.9-8.11, 10.15, 12.1-12.16_

- [x] 8. Update salary-cycle browser interfaces
  - [x] 8.1 Replace Log Spending's editable Budget Month with server preview
    - Update `views/log-spending.hbs` and `public/js/log-spending.js` to send raw `YYYY-MM-DD`, request assignment on load/change, show a read-only derived Budget_Month and period, disable submit for field errors, and refresh preview after a 409 conflict.
    - Populate edits from canonical `expenseDate` without `new Date(dateOnly)`, UTC midnight, or `toISOString()` conversion; omit assignment fields or echo only the derived values for compatibility.
    - _Requirements: 3.6-3.8, 11.3, 11.4, 11.6, 11.8, 12.15_

  - [x] 8.2 Add Log Spending DOM interaction tests
    - Compile the Handlebars view in jsdom and test initial/change preview, exact edit round trip, invalid-date blocking, assignment conflict refresh, server error display, and regression guards against UTC date-only conversion.
    - _Requirements: 3.6-3.8, 11.4, 11.6, 11.8_

  - [x] 8.3 Add salary-cycle and cadence controls to the Check Pockets view
    - Update `views/check-pockets.hbs` with named Budget_Month and inclusive period labels, cadence controls, one ISO week selector per weekly pocket, allocation/metrics fields, inactive-allocation confirmation UI, and closed/out-of-window states.
    - Keep controls accessible to authenticated readers while rendering mutations only for Wife users as appropriate.
    - _Requirements: 4.10, 4.11, 5.1, 5.3, 7.1-7.3, 8.9, 8.10, 12.1-12.5_

  - [x] 8.4 Implement server-driven Check Pockets interactions
    - Refactor `public/js/check-pockets.js` to initialize from the server active month, navigate named months, render period/week descriptors and active metrics, save only exact monthly/weekly keys, and require confirmation before cadence changes that inactivate saved allocations.
    - Use response `canEdit`/`isClosed` for control states without treating the browser as authorization authority; remove device-calendar budget defaults and recurrence/carryover assumptions.
    - _Requirements: 4.10-4.12, 5.1-5.9, 7.1-7.3, 7.7, 9.1-9.9, 12.1-12.5_

  - [x] 8.5 Add Check Pockets DOM interaction tests
    - Test monthly and weekly cards, one-week selection, full and intersection labels, missing allocations, exact-key saves, cadence confirm/cancel, inactive retention display, server active month, and disabled closed/out-of-window controls.
    - _Requirements: 4.10-4.12, 5.1-5.9, 7.1-7.3, 8.2, 9.4-9.8_

  - [x] 8.6 Update Monthly Story and Review History for salary-cycle metadata
    - Update both Handlebars views and `public/js/monthly-story.js` / `public/js/review-history.js` to use server active Budget_Month defaults, display inclusive cycle ranges, consume cadence-aware alerts, preserve stored Expense_Date strings, and group/sort without UTC midnight conversion.
    - Ensure history pocket filtering displays split transactions once when the selected pocket appears in a Pocket_Share.
    - _Requirements: 7.1, 7.4-7.10, 11.5, 11.6, 12.15_

  - [x] 8.7 Add Monthly Story and Review History DOM tests
    - Verify server-derived defaults, cycle labels, charts/totals/recent items by stored assignment, monthly and weekly alert labels, exact date grouping, split-pocket filtering, and absence of date-only `toISOString()` paths.
    - _Requirements: 7.1, 7.4-7.10, 11.4-11.6_

- [x] 9. Replace the immediate-write migration with a controlled lifecycle
  - [x] 9.1 Implement pure migration transforms, canonical fingerprints, and preservation checks
    - Add deterministic transform functions for legacy monthly budgets, transaction canonical dates/optional assignment proposals, existing closed markers, and required open guards.
    - Canonically order and hash source identity/version plus zone/migration version; produce exact before/after items, blockers, unchanged counts, and an executable set without writing source data.
    - _Requirements: 10.1-10.6, 10.8-10.11, 10.14_

  - [x] 9.2 Write the property test for preserving, idempotent migration
    - **Property 12: Migration transformation is preserving and idempotent**
    - Generate valid legacy and mixed-version budgets, transactions, and closed periods; prove a second transform is equivalent to the first result, proposes zero changes, and preserves every required identity, amount, owner, date, share, close, and timestamp field.
    - **Validates: Requirements 10.1, 10.2, 10.8, 10.9, 10.14**

  - [x] 9.3 Implement the immutable migration preview command
    - Replace/retire `scripts/migrate-budget-month.js` with an operator CLI that defaults to safe preview behavior and uses shared runtime validators/resolver.
    - Persist preview metadata/items only, never mutate source financial records, enumerate all invalid/duplicate/conflict identifiers, include exact historical reassignment proposals, and block unsupported transaction deployments or oversized all-or-nothing previews.
    - _Requirements: 10.3-10.6, 10.10, 10.11_

  - [x] 9.4 Implement explicit preview approval and historical reassignment gates
    - Add conditional status transitions and Wife/operator authorization for approval; require explicit preview identity and a separate historical flag whenever an Expense_Date-derived assignment would change.
    - Keep preview items immutable and reject blocked, changed, already-consumed, or unauthorized approval attempts without source writes.
    - _Requirements: 10.6, 10.7, 10.10-10.12_

  - [x] 9.5 Implement stale-safe, all-or-nothing migration execution
    - Recompute and compare the source fingerprint, require Approved status and all gates, then apply exactly the executable preview after-values and status change in one database transaction with supported write guarantees.
    - Abort on any mismatch/failure so every source record remains at its recorded before-value; make successfully migrated records idempotent for future previews.
    - _Requirements: 10.7, 10.11-10.14_

  - [x] 9.6 Implement migration verification and separately approved rollback
    - Verify every applied record, preservation invariant, schema/index invariant, and route-readable result against preview after-values.
    - Add rollback approval and reverse-order restoration only when affected records still match applied fingerprints; otherwise return a rollback conflict without writes.
    - _Requirements: 10.2, 10.8, 10.9, 10.12-10.15_

  - [x] 9.7 Add migration lifecycle integration and failure-injection tests
    - Prove preview source collections are unchanged; test invalid dates/pockets, duplicate keys, conflicts, transaction-support preconditions, exact counts/items, authorization/approval flags, stale previews, successful execution, verification, zero-change rerun, rollback, and rollback refusal.
    - Inject failure after multiple attempted items and assert complete source/preview rollback; run authenticated route smoke tests over converted records.
    - _Requirements: 10.1-10.15, 12.9-12.16_

- [x] 10. Complete backward-compatible rollout and readiness automation
  - [x] 10.1 Implement feature-flagged compatibility readers and write behavior
    - Wire schema-v1/v2 readers, effective Monthly cadence defaults, canonical/legacy transaction aliases, dual date writes, old monthly budget payload adaptation, and disabled-feature rejection of weekly mutations.
    - Ensure enabling the flag exposes authoritative assignment and weekly UI together, while disabling it leaves existing authenticated monthly pages/routes functional.
    - _Requirements: 3.3-3.5, 10.1, 10.15, 11.10, 12.15, 12.16_

  - [x] 10.2 Add the feature-off/feature-on compatibility regression matrix
    - Test legacy clients that omit budget fields, clients with matching/conflicting fields, mixed schema data, old monthly budget routes, canonical responses, authentication, and every existing page/API with the flag disabled and enabled.
    - Assert weekly writes are unavailable while disabled and complete salary-cycle behavior is available only after enablement.
    - _Requirements: 3.3-3.5, 8.10, 8.11, 10.15, 12.15, 12.16_

  - [x] 10.3 Add automated rollout preflight and post-migration verification commands
    - Add non-interactive scripts that validate time zone, transaction support, duplicate/index preconditions, required indexes, migration verification, representative weekday/weekend/payday/week-crossing cases, and authenticated route smoke fixtures.
    - Make every readiness command read-only except explicitly approved migration operations and return a failing exit status for any unmet acceptance gate.
    - _Requirements: 1.1-1.4, 5.4, 10.3, 10.10-10.15, 11.7, 12.9-12.16_

  - [x] 10.4 Assemble and execute the complete deterministic acceptance test profile
    - Update test scripts/configuration to run unit, all 13 property tests, service/database, route, UI, migration, concurrency, feature-off/on, index, and smoke suites in dependency order without watch mode or production services.
    - Fix test or implementation defects until the full profile passes with no migration mismatches, duplicate composite keys, route regressions, unhandled rejections, or leaked asynchronous resources.
    - _Requirements: 1.1-1.6, 2.1-2.8, 3.1-3.10, 4.1-4.12, 5.1-5.10, 6.1-6.12, 7.1-7.15, 8.1-8.11, 9.1-9.9, 10.1-10.15, 11.1-11.10, 12.1-12.16_

- [x] 11. Final checkpoint - Ensure full verification and rollout readiness
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- No task is marked optional: the test coverage, migration safeguards, compatibility behavior, authorization, closed-period enforcement, and rollout gates are all required for correct delivery.
- Each correctness property is a separate executable `fast-check` subtask located immediately after or near the code it validates.
- Migration order is strict: preview, explicit approval (including historical reassignment approval where applicable), stale-source check, atomic execution, verification, and only then separately approved rollback capability.
- Production deployment, live data migration, manual user acceptance, and documentation work are intentionally excluded; the plan creates code and automated evidence needed for a controlled rollout.
- Checkpoints require non-watch test commands and do not start development servers or watchers.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["1.4", "2.1", "3.1", "3.2", "3.3", "3.4", "3.5"] },
    { "id": 2, "tasks": ["2.2", "3.6", "4.1", "4.2"] },
    { "id": 3, "tasks": ["2.3", "2.4", "2.5", "2.6", "2.7", "4.3", "5.1", "9.1"] },
    { "id": 4, "tasks": ["4.4", "4.7", "4.8", "5.2", "5.3", "5.4", "9.2"] },
    { "id": 5, "tasks": ["4.5", "4.6", "5.5", "5.7", "9.3"] },
    { "id": 6, "tasks": ["5.6", "5.8", "5.9", "7.1", "9.4"] },
    { "id": 7, "tasks": ["7.2", "7.3", "8.1", "9.5"] },
    { "id": 8, "tasks": ["7.4", "8.2", "8.3", "9.6"] },
    { "id": 9, "tasks": ["8.4", "8.6", "9.7"] },
    { "id": 10, "tasks": ["8.5", "8.7"] },
    { "id": 11, "tasks": ["10.1"] },
    { "id": 12, "tasks": ["10.2"] },
    { "id": 13, "tasks": ["10.3"] },
    { "id": 14, "tasks": ["10.4"] }
  ]
}
```
