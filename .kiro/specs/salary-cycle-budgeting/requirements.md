# Requirements Document

## Introduction

Salary-cycle budgeting aligns Money Journal budget periods with the household payday instead of calendar-month boundaries. The household receives both salaries on the 25th, moved backward to Friday when the 25th falls on Saturday or Sunday. An expense dated on or after an Actual_Payday belongs to the following Budget_Month. Budget pockets can use either one Monthly_Allocation for the salary cycle or separate Weekly_Allocations selected by Calendar_Week.

This requirements document covers planning only. No application code is changed. The requirements reflect the current Express, Mongoose, Handlebars, and browser JavaScript implementation, including explicit transaction `budgetMonth` and `budgetYear` values, one budget record per pocket and calendar month, month-level closing, manual Budget Month selection, dashboard and history month filters, and the existing historical migration script.

## Glossary

- **Money_Journal**: The complete household expense and budgeting application.
- **Household**: The user and spouse sharing one salary schedule and budget.
- **Expense_Date**: The user-selected calendar date on which an expense occurred, interpreted without a time-of-day.
- **Nominal_Payday**: The 25th calendar day of a month.
- **Actual_Payday**: The salary date after applying the weekend adjustment to the Nominal_Payday.
- **Salary_Cycle_Resolver**: The Money Journal capability that calculates Actual_Payday dates, Budget_Month assignments, and Salary_Cycle_Period boundaries.
- **Budget_Month**: A named calendar month and year whose budget covers the Salary_Cycle_Period ending immediately before that month’s Actual_Payday. For example, the February 2027 Budget_Month starts on the January 2027 Actual_Payday and ends one day before the February 2027 Actual_Payday.
- **Salary_Cycle_Period**: The inclusive sequence of local dates from the preceding month’s Actual_Payday through the day before the Budget_Month’s Actual_Payday.
- **Household_Time_Zone**: The IANA time zone used for all payday, Expense_Date, Calendar_Week, and Salary_Cycle_Period calculations.
- **Pocket**: One of the configured budget sources, such as Groceries or Weekday Transport.
- **Budget_Cadence**: The budgeting mode selected for a Pocket within a Budget_Month; permitted values are Monthly and Weekly.
- **Monthly_Allocation**: One budget amount for a Pocket across one complete Salary_Cycle_Period.
- **Calendar_Week**: A Monday-through-Sunday local-date interval identified by ISO week-year and week number.
- **Weekly_Allocation**: One budget amount for a Pocket, Budget_Month, and Calendar_Week combination.
- **Pocket_Share**: The portion of a multi-pocket expense allocated to one Pocket.
- **Budget_Service**: The Money Journal capability that stores, retrieves, validates, closes, and summarizes pocket budgets.
- **Transaction_Service**: The Money Journal capability that creates, updates, deletes, validates, and retrieves expenses.
- **Budget_Interface**: The Check Pockets and Log Spending user interfaces that display salary-cycle and cadence controls.
- **Reporting_Service**: The Money Journal capability that supplies Monthly Story, Review History, charts, totals, comparisons, and alerts.
- **Closed_Budget_Month**: A Budget_Month marked closed through the existing month-close workflow.
- **Migration_Process**: The controlled conversion of existing budget and transaction data to salary-cycle-compatible data.
- **Wife_Role**: The existing session role authorized to edit budgets and close or reopen Budget_Months.
- **Legacy_Client**: An application client that sends the current transaction and budget API fields without salary-cycle or cadence metadata.
- **Active_Cadence_Allocation**: The Monthly_Allocation or Weekly_Allocation selected by a Pocket’s current Budget_Cadence for a specific Budget_Month and, for Weekly cadence, Calendar_Week.
- **Allocation_Composite_Key**: The uniqueness identity for an allocation: Pocket plus Budget_Month for Monthly_Allocation, or Pocket plus Budget_Month plus ISO week-year plus ISO week number for Weekly_Allocation.
- **Editable_Window**: The active Budget_Month and the immediately following Budget_Month, provided each Budget_Month is open.
- **Migration_Preview**: An immutable dry-run report of exact proposed transformations, unchanged records, invalid records, and conflicts produced without persistent writes.
- **Historical_Reassignment_Approval**: The explicit product and operator authorization required before historical transaction Budget_Month assignments may be replaced.
- **Concurrent_Write_Policy**: The reviewed rule that determines whether competing valid updates to one Allocation_Composite_Key receive ordered acceptance or a version-conflict response.
- **Eligible_Spending_Item**: A single-pocket expense amount or one Pocket_Share whose Pocket and stored Budget_Month match the calculation target; a weekly calculation additionally requires Expense_Date to fall within the selected Calendar_Week and Salary_Cycle_Period intersection.

## Product Assumptions Applied in This Draft

1. The Household_Time_Zone defaults to `Asia/Jakarta` because the application uses Indonesian currency and locale conventions. The time zone remains explicit and configurable so deployment location cannot change date classification.
2. Calendar_Week uses ISO Monday-through-Sunday boundaries.
3. Budget_Cadence is selected independently for each Pocket and Budget_Month, allowing a Pocket to change cadence in a later Budget_Month without changing history.
4. A Calendar_Week crossing an Actual_Payday can appear in two adjacent Budget_Months. Each view counts only the dates assigned to the selected Budget_Month.
5. Weekly_Allocations are entered independently for each Calendar_Week and do not repeat or carry forward automatically.
6. The server-calculated Budget_Month is authoritative. The existing manual Budget Month selector becomes a read-only assignment preview.
7. Existing transaction reassignment remains gated: Migration_Preview identifies proposed Expense_Date-derived changes, and persistent reassignment occurs only after Historical_Reassignment_Approval is confirmed and Migration_Preview is explicitly approved.
8. Existing budget amounts migrate as Monthly_Allocations, preserving the current behavior unless a Wife_Role user explicitly selects Weekly cadence for a later open Budget_Month.
9. Saved allocations made inactive by a cadence change remain stored for possible restoration but are excluded from active-cadence calculations.
10. A missing active-cadence allocation follows current product behavior: the allocation amount is zero, attributed spending remains visible, remaining amount is zero minus spending, and percentage used is zero.

## Product Decisions Requiring Review

These items are genuine product choices rather than code-level details. The requirements below state the current draft behavior explicitly so each choice remains testable and reviewable.

1. **Household time zone**: Confirm `Asia/Jakarta` or provide another IANA time zone.
2. **Week convention**: Confirm Monday-through-Sunday ISO weeks rather than Sunday-through-Saturday weeks.
3. **Cadence scope**: Confirm that cadence is chosen per Pocket per Budget_Month rather than once per Pocket for all future periods.
4. **Payday-crossing weeks**: Confirm that a single Calendar_Week may have separate allocations in adjacent Budget_Months when Actual_Payday falls during the week.
5. **Historical reassignment approval**: Confirm whether an approved migration may replace historical `budgetMonth` and `budgetYear` values with Expense_Date-derived assignments. Until Historical_Reassignment_Approval and explicit Migration_Preview approval, Migration_Process performs zero historical transaction writes. The existing migration script deliberately assigned missing records to March 2026, so historical intent may differ from derived classification.
6. **Manual exceptions**: Confirm that users cannot override the derived Budget_Month. The current Log Spending screen permits manual selection of the prior, current, or next calendar month.
7. **Weekly recurrence and carryover**: Confirm that Weekly_Allocations neither auto-repeat nor transfer unused or overspent amounts to another Calendar_Week.
8. **Inactive allocation retention**: Confirm the draft behavior that a cadence change preserves allocations belonging to the previous cadence for later restoration while excluding those allocations from calculations. An alternative policy could delete inactive allocations only after explicit confirmation.
9. **Missing allocation presentation**: Confirm the current behavior that a missing active-cadence allocation is represented as zero allocation, retains attributed spending, produces negative remaining when spending is positive, and reports zero percent used rather than an undefined percentage.
10. **Concurrent write conflict policy**: Confirm whether two valid concurrent updates to the same allocation use an explicit version-conflict response or a documented accepted-write ordering. Regardless of the selected policy, only one record may exist for the composite allocation key, and the final record must equal one complete accepted request.

## Requirements

### Requirement 1: Calculate Actual Payday

**User Story:** As a household member, I want payday adjusted for weekends, so that budget boundaries match salary availability.

#### Acceptance Criteria

1. THE Salary_Cycle_Resolver SHALL define Nominal_Payday as the local calendar date on the 25th day of the requested month and year in Household_Time_Zone.
2. WHEN Nominal_Payday falls on Monday, Tuesday, Wednesday, Thursday, or Friday, THE Salary_Cycle_Resolver SHALL return the 25th of the requested month and year as Actual_Payday.
3. WHEN Nominal_Payday falls on Saturday, THE Salary_Cycle_Resolver SHALL return the immediately preceding Friday, the 24th of the requested month and year, as Actual_Payday.
4. WHEN Nominal_Payday falls on Sunday, THE Salary_Cycle_Resolver SHALL return the immediately preceding Friday, the 23rd of the requested month and year, as Actual_Payday.
5. WHEN the same valid month, year, and Household_Time_Zone are supplied more than once, THE Salary_Cycle_Resolver SHALL return the same Actual_Payday for every invocation.
6. IF the supplied month is outside 1 through 12, the supplied year is not an integer representing a valid local calendar year, or Household_Time_Zone is not a recognized IANA time zone, THEN THE Salary_Cycle_Resolver SHALL return a field-specific validation error without returning an Actual_Payday.

### Requirement 2: Assign Expenses to Salary-Cycle Budget Months

**User Story:** As a household member, I want expenses classified by payday, so that spending after salary receipt uses the following month’s budget.

#### Acceptance Criteria

1. WHEN a valid Expense_Date is before Actual_Payday for the Expense_Date calendar month in Household_Time_Zone, THE Salary_Cycle_Resolver SHALL assign the Expense_Date calendar month and year as Budget_Month.
2. WHEN a valid Expense_Date is equal to or after Actual_Payday for the Expense_Date calendar month in Household_Time_Zone, THE Salary_Cycle_Resolver SHALL assign the immediately following calendar month and year as Budget_Month.
3. WHEN a valid Expense_Date is equal to or after December Actual_Payday, THE Salary_Cycle_Resolver SHALL assign January of the following year as Budget_Month.
4. THE Salary_Cycle_Resolver SHALL define the Salary_Cycle_Period for a target Budget_Month as the inclusive local-date interval beginning on the preceding calendar month’s Actual_Payday and ending on the local date immediately before the target Budget_Month’s Actual_Payday.
5. WHEN a valid Expense_Date is resolved, THE Salary_Cycle_Resolver SHALL assign the Expense_Date to exactly one Budget_Month and exactly one Salary_Cycle_Period.
6. WHEN two chronologically adjacent Budget_Months are resolved, THE Salary_Cycle_Resolver SHALL set the later Salary_Cycle_Period start date to one local calendar day after the earlier Salary_Cycle_Period end date.
7. WHEN consecutive Salary_Cycle_Periods are resolved, THE Salary_Cycle_Resolver SHALL produce no overlapping local date and no unassigned local date between the periods.
8. IF Expense_Date, target Budget_Month, or Household_Time_Zone is invalid, THEN THE Salary_Cycle_Resolver SHALL return a field-specific validation error without returning a Budget_Month or Salary_Cycle_Period.

### Requirement 3: Apply Authoritative Transaction Assignment

**User Story:** As a household member, I want budget assignment calculated consistently, so that browser behavior cannot place an expense in the wrong budget.

#### Acceptance Criteria

1. WHEN a valid new expense is submitted, THE Transaction_Service SHALL derive Budget_Month from Expense_Date through the Salary_Cycle_Resolver and persist the expense and derived Budget_Month in one atomic operation.
2. WHEN a valid Expense_Date update is submitted, THE Transaction_Service SHALL derive the replacement Budget_Month through the Salary_Cycle_Resolver and persist Expense_Date and Budget_Month in one atomic operation.
3. WHEN a Legacy_Client omits `budgetMonth` and `budgetYear`, THE Transaction_Service SHALL accept an otherwise valid expense request and persist the derived Budget_Month.
4. WHEN supplied `budgetMonth` and `budgetYear` equal the derived Budget_Month, THE Transaction_Service SHALL accept an otherwise valid expense request.
5. IF supplied `budgetMonth` or `budgetYear` conflicts with the derived Budget_Month, THEN THE Transaction_Service SHALL return a conflict error containing the derived month and year without creating or updating an expense.
6. WHEN a valid Expense_Date changes in the Budget_Interface, THE Budget_Interface SHALL display the derived Budget_Month before expense submission.
7. THE Budget_Interface SHALL present the derived Budget_Month as a non-editable value.
8. IF Expense_Date is invalid or nonexistent in the calendar, THEN THE Budget_Interface SHALL display a field-specific validation error and prevent expense submission.
9. IF Transaction_Service receives an invalid or nonexistent Expense_Date, THEN THE Transaction_Service SHALL return a field-specific validation error without creating or updating an expense.
10. WHEN otherwise identical expenses use different payer values or authenticated household roles, THE Transaction_Service SHALL derive the same Budget_Month from the shared Expense_Date and Household_Time_Zone.

### Requirement 4: Configure Pocket Budget Cadence

**User Story:** As a Wife_Role user, I want each pocket budgeted monthly or weekly, so that each spending category uses an appropriate planning interval.

#### Acceptance Criteria

1. THE Budget_Service SHALL store exactly one Budget_Cadence value for each Pocket and Budget_Month combination.
2. THE Budget_Service SHALL permit only Monthly and Weekly as Budget_Cadence values.
3. WHERE Monthly Budget_Cadence is active, THE Budget_Service SHALL use one Monthly_Allocation identified by Pocket and Budget_Month.
4. WHERE Weekly Budget_Cadence is active, THE Budget_Service SHALL use Weekly_Allocations identified by Pocket, Budget_Month, and Calendar_Week.
5. WHEN Budget_Cadence is Monthly, THE Budget_Service SHALL exclude saved Weekly_Allocations for the same Pocket and Budget_Month from spending limits, remaining amounts, percentages, alerts, and Budget_Month aggregates.
6. WHEN Budget_Cadence is Weekly, THE Budget_Service SHALL exclude a saved Monthly_Allocation for the same Pocket and Budget_Month from spending limits, remaining amounts, percentages, alerts, and Budget_Month aggregates.
7. WHEN Budget_Cadence changes for one Pocket and Budget_Month, THE Budget_Service SHALL leave cadence and allocations for every other Pocket and Budget_Month unchanged.
8. IF an allocation amount is missing, non-numeric, non-finite, or less than zero, THEN THE Budget_Service SHALL return a field-specific validation error without changing cadence or allocation data.
9. IF a requested cadence value is not Monthly or Weekly, THEN THE Budget_Service SHALL return a field-specific validation error without changing cadence or allocation data.
10. IF a cadence change would make one or more saved allocations inactive, THEN THE Budget_Interface SHALL identify the allocations and require explicit Wife_Role confirmation before submitting the cadence change.
11. IF Wife_Role confirmation for a cadence change is not provided, THEN THE Budget_Interface SHALL retain the existing Budget_Cadence without submitting the change.
12. WHEN a confirmed cadence change makes saved allocations inactive, THE Budget_Service SHALL preserve the inactive allocations and exclude the inactive allocations according to criteria 5 and 6.

### Requirement 5: Select and Budget Calendar Weeks

**User Story:** As a Wife_Role user, I want weekly pocket budgets separated by calendar week, so that each week can have an independent spending limit.

#### Acceptance Criteria

1. WHERE Weekly Budget_Cadence is active, THE Budget_Interface SHALL provide a Calendar_Week selector that selects exactly one Calendar_Week at a time for the selected Pocket and Budget_Month.
2. WHEN a valid Budget_Month is selected, THE Budget_Service SHALL return exactly the distinct Monday-through-Sunday ISO Calendar_Weeks containing at least one local date in the Budget_Month’s Salary_Cycle_Period.
3. WHEN the Budget_Interface displays a Calendar_Week option, THE Budget_Interface SHALL display the ISO week-year, ISO week number, Monday local start date, and Sunday local end date.
4. WHEN one Calendar_Week intersects two adjacent Salary_Cycle_Periods, THE Budget_Service SHALL include the Calendar_Week in the Calendar_Week list for both corresponding Budget_Months.
5. WHEN a valid Pocket, Budget_Month, and Calendar_Week are selected, THE Budget_Service SHALL retrieve the Weekly_Allocation matching the exact Pocket, Budget_Month, ISO week-year, and ISO week-number composite key.
6. IF no Weekly_Allocation matches a valid selected composite key, THEN THE Budget_Service SHALL return an explicit missing-allocation result with allocation amount zero and without creating an allocation.
7. WHEN a valid Weekly_Allocation is saved, THE Budget_Service SHALL leave allocations for every other Pocket, Budget_Month, and Calendar_Week unchanged.
8. WHEN a valid Weekly_Allocation is updated more than once, THE Budget_Service SHALL retain the most recently accepted amount for the exact composite key until another accepted update changes the amount.
9. IF a selected Calendar_Week contains no local date in the selected Budget_Month’s Salary_Cycle_Period, THEN THE Budget_Service SHALL return a validation error without creating or updating an allocation.
10. IF the selected Calendar_Week identity is not a valid ISO week-year and ISO week-number pair, THEN THE Budget_Service SHALL return a field-specific validation error without creating or updating an allocation.

### Requirement 6: Attribute Spending to Monthly and Weekly Budgets

**User Story:** As a household member, I want spending totals matched to each pocket cadence, so that remaining balances are accurate.

#### Acceptance Criteria

1. WHERE Monthly Budget_Cadence is active, THE Budget_Service SHALL calculate Pocket spending as the sum of all Eligible_Spending_Items for the Pocket and Budget_Month across the complete Salary_Cycle_Period.
2. WHERE Weekly Budget_Cadence is active, THE Budget_Service SHALL calculate Pocket spending as the sum of all Eligible_Spending_Items within the selected Calendar_Week and selected Budget_Month’s Salary_Cycle_Period intersection.
3. WHEN no Eligible_Spending_Item exists for a calculation, THE Budget_Service SHALL return spending equal to zero.
4. WHEN a single-pocket expense qualifies as an Eligible_Spending_Item, THE Budget_Service SHALL include the full expense amount exactly once for the selected Pocket.
5. WHEN a split expense qualifies for attribution, THE Budget_Service SHALL include each Eligible_Spending_Item for the corresponding Pocket and exclude the split expense’s full amount from Pocket spending.
6. WHEN an eligible split expense contains Monthly and Weekly cadence Pockets, THE Budget_Service SHALL evaluate each Pocket_Share independently under the corresponding Pocket’s active Budget_Cadence.
7. WHEN an Active_Cadence_Allocation exists, THE Budget_Service SHALL calculate remaining amount as the allocation amount minus attributed spending.
8. WHEN no Active_Cadence_Allocation exists, THE Budget_Service SHALL use allocation amount zero, preserve attributed spending, and calculate remaining amount as zero minus attributed spending.
9. WHEN attributed spending equals an allocation amount, THE Budget_Service SHALL return remaining amount equal to zero.
10. WHEN attributed spending exceeds an allocation amount, THE Budget_Service SHALL return the negative arithmetic difference as remaining amount.
11. WHEN a valid split expense is attributed, THE Budget_Service SHALL preserve the invariant that the sum of all Pocket_Shares equals the expense amount.
12. WHEN budget spending is aggregated across Pockets, THE Budget_Service SHALL include each Eligible_Spending_Item exactly once.

### Requirement 7: Present Salary-Cycle Budget and Reporting Views

**User Story:** As a household member, I want reports to reflect salary-cycle periods and weekly selections, so that displayed totals match budget decisions.

#### Acceptance Criteria

1. WHEN the Budget_Interface displays a Budget_Month, THE Budget_Interface SHALL display the inclusive local start date and inclusive local end date of the corresponding Salary_Cycle_Period.
2. WHERE a Pocket uses Monthly Budget_Cadence, THE Budget_Interface SHALL display the active Monthly_Allocation amount, complete Salary_Cycle_Period spending, remaining amount, and percentage used.
3. WHERE a Pocket uses Weekly Budget_Cadence, THE Budget_Interface SHALL display the selected Calendar_Week identity, active Weekly_Allocation amount, spending within the intersection of that Calendar_Week and Salary_Cycle_Period, remaining amount, and percentage used.
4. WHEN Monthly Story loads a Budget_Month, THE Reporting_Service SHALL filter totals, charts, recent expenses, comparisons, and alerts by stored Budget_Month assignment.
5. WHEN Review History filters by Budget_Month, THE Reporting_Service SHALL return exactly the expenses assigned to the selected Budget_Month.
6. WHEN Reporting_Service returns an expense, THE Reporting_Service SHALL return the saved Expense_Date without replacing Expense_Date with a Salary_Cycle_Period boundary date.
7. WHEN a Budget_Month health summary is calculated, THE Budget_Service SHALL sum only allocations active under each Pocket’s Budget_Cadence for the selected Budget_Month.
8. WHEN a Budget_Month health summary is calculated, THE Budget_Service SHALL sum attributed spending without counting any single-pocket amount or Pocket_Share more than once.
9. WHEN a weekly Pocket alert is calculated, THE Reporting_Service SHALL assign warning status at 80 through 99 percent used and danger status at 100 percent used or greater.
10. WHEN a monthly Pocket alert is calculated, THE Reporting_Service SHALL assign warning status at 80 through 99 percent used and danger status at 100 percent used or greater.
11. WHEN Check Pockets calculates Pocket status, THE Budget_Service SHALL assign good status below 70 percent used, warning status at 70 through 89 percent used, and danger status at 90 percent used or greater.
12. WHEN Check Pockets calculates aggregate health status, THE Budget_Service SHALL assign good status below 70 percent used, warning status at 70 through 99 percent used, and danger status at 100 percent used or greater.
13. WHEN a positive active allocation is displayed, THE Budget_Service SHALL calculate percentage used as attributed spending divided by allocation amount multiplied by 100 and rounded to the nearest whole percentage point.
14. WHEN an active allocation is zero or missing, THE Budget_Service SHALL return percentage used equal to zero while preserving attributed spending and remaining amount.
15. WHEN the Budget_Month total active allocation is zero, THE Budget_Service SHALL return aggregate percentage used equal to zero.

### Requirement 8: Preserve Closing and Authorization Rules

**User Story:** As a Wife_Role user, I want closed budget periods protected, so that reviewed salary-cycle records remain stable.

#### Acceptance Criteria

1. WHEN a Wife_Role user closes an open Budget_Month, THE Budget_Service SHALL mark the named Budget_Month, corresponding Salary_Cycle_Period, cadence records, Monthly_Allocations, Weekly_Allocations, and assigned expenses as protected Closed_Budget_Month data.
2. WHILE a Budget_Month is closed, THE Budget_Service SHALL reject cadence creation, cadence update, allocation creation, allocation update, allocation deletion, and cadence deletion for the Closed_Budget_Month without mutating stored data.
3. WHILE a Budget_Month is closed, THE Transaction_Service SHALL reject expense creation, expense update, and expense deletion affecting the Closed_Budget_Month without mutating stored data.
4. IF an Expense_Date update would move an expense from an open Budget_Month into a Closed_Budget_Month, THEN THE Transaction_Service SHALL return an error identifying the destination Budget_Month without changing Expense_Date or Budget_Month.
5. IF an Expense_Date update would move an expense from a Closed_Budget_Month into another Budget_Month, THEN THE Transaction_Service SHALL return an error identifying the source Budget_Month without changing Expense_Date or Budget_Month.
6. IF an Expense_Date update would move an expense between two Budget_Months and either Budget_Month is closed, THEN THE Transaction_Service SHALL reject the complete update atomically.
7. WHEN a Wife_Role user reopens a Closed_Budget_Month, THE Budget_Service SHALL remove the closed marker without changing cadence records, allocations, expenses, Expense_Date values, or Budget_Month assignments.
8. WHEN a reopened Budget_Month is outside the editable window, THE Budget_Service SHALL continue to reject allocation and cadence changes under Requirement 9.
9. IF an authenticated user without Wife_Role requests a cadence, allocation, or closed-state change, THEN THE Budget_Service SHALL return an authorization error without mutating stored data.
10. WHEN an authenticated household member requests salary-cycle budget information, THE Money_Journal SHALL permit access subject to existing authenticated route rules.
11. IF an unauthenticated client requests salary-cycle budget information or a budget mutation, THEN THE Money_Journal SHALL return an authentication error without disclosing household budget data or mutating stored data.

### Requirement 9: Align Editable Periods with the Salary Cycle

**User Story:** As a Wife_Role user, I want budget editing aligned with the active salary cycle, so that payday-boundary dates do not expose the wrong period.

#### Acceptance Criteria

1. WHEN the current local date in Household_Time_Zone is before the current calendar month’s Actual_Payday, THE Budget_Service SHALL identify the current calendar month and year as the active Budget_Month.
2. WHEN the current local date in Household_Time_Zone is equal to or after the current calendar month’s Actual_Payday, THE Budget_Service SHALL identify the immediately following calendar month and year as the active Budget_Month.
3. WHEN the current local date is equal to or after December Actual_Payday, THE Budget_Service SHALL identify January of the following year as the active Budget_Month.
4. WHILE the active Budget_Month is open, THE Budget_Service SHALL permit Wife_Role allocation and cadence edits for the active Budget_Month.
5. WHILE the Budget_Month immediately following the active Budget_Month is open, THE Budget_Service SHALL permit Wife_Role allocation and cadence edits for that immediately following Budget_Month.
6. IF a requested Budget_Month is earlier than the active Budget_Month, THEN THE Budget_Service SHALL return an editable-window error without changing cadence or allocation data.
7. IF a requested Budget_Month is later than the Budget_Month immediately following the active Budget_Month, THEN THE Budget_Service SHALL return an editable-window error without changing cadence or allocation data.
8. IF the active Budget_Month or immediately following Budget_Month is closed, THEN THE Budget_Service SHALL reject allocation and cadence edits for the closed Budget_Month without changing stored data.
9. WHEN the active Budget_Month advances, THE Budget_Service SHALL evaluate the editable window from the newly active Budget_Month and the immediately following Budget_Month.

### Requirement 10: Migrate Existing Data Safely

**User Story:** As a household member, I want existing data converted predictably, so that salary-cycle budgeting does not lose financial history.

#### Acceptance Criteria

1. WHEN an existing Pocket budget has no Budget_Cadence, THE Migration_Process SHALL propose Monthly Budget_Cadence and conversion of the existing budget amount to Monthly_Allocation.
2. WHEN an existing Pocket budget is converted to Monthly_Allocation, THE Migration_Process SHALL preserve the Pocket, budget amount, month, year, creator, record identifier, creation timestamp, and update timestamp.
3. WHEN Migration_Process runs in dry-run mode, THE Migration_Process SHALL perform zero persistent writes.
4. WHEN Migration_Process generates a Migration_Preview, THE Migration_Process SHALL report the identifier and exact before-and-after values for every proposed budget conversion, cadence assignment, transaction Budget_Month change, and closed-month preservation.
5. WHEN Migration_Process generates a Migration_Preview, THE Migration_Process SHALL report total scanned records, unchanged records, proposed changes by type, invalid records, duplicate Allocation_Composite_Keys, and unresolvable conflicts.
6. WHILE Historical_Reassignment_Approval is unconfirmed, THE Migration_Process SHALL report proposed Expense_Date-derived Budget_Month changes without persistently changing historical transaction assignments.
7. WHERE Historical_Reassignment_Approval is confirmed, WHEN an authorized operator explicitly approves a valid Migration_Preview, THE Migration_Process SHALL derive each migrated transaction Budget_Month from Expense_Date and Household_Time_Zone.
8. WHEN an existing transaction is migrated after approval, THE Migration_Process SHALL preserve the transaction identifier, Expense_Date, amount, category, note, submitter, payer, Pocket, source type, Pocket_Shares, creation timestamp, and update timestamp.
9. WHEN an existing closed-month record is migrated, THE Migration_Process SHALL preserve the named month, year, closing user, record identifier, creation timestamp, and update timestamp as Closed_Budget_Month data.
10. IF a dry-run preview contains an invalid Expense_Date, invalid Pocket, duplicate allocation composite key, or unresolvable conflict, THEN THE Migration_Process SHALL perform zero persistent writes and report every affected record identifier with the blocking reason.
11. IF source data changes after preview generation and before migration execution, THEN THE Migration_Process SHALL reject the stale preview without persistent writes and require a new preview.
12. WHEN an approved migration executes, THE Migration_Process SHALL apply exactly the before-and-after transformations recorded in the approved preview.
13. IF migration execution fails before every approved transformation commits, THEN THE Migration_Process SHALL leave every affected persistent record equal to the corresponding before-value in the approved Migration_Preview.
14. WHEN Migration_Process reruns against successfully migrated data, THE Migration_Process SHALL report zero additional transformations and leave persistent data unchanged.
15. WHEN migration completes successfully, THE Migration_Process SHALL preserve access to converted monthly budgets, closed-month history, and transaction history through the existing authenticated application routes.

### Requirement 11: Use Consistent Date and Time-Zone Semantics

**User Story:** As a household member, I want date classification independent of device and server location, so that an expense does not move between budgets unexpectedly.

#### Acceptance Criteria

1. THE Money_Journal SHALL use one configured Household_Time_Zone for Actual_Payday, Salary_Cycle_Period, active Budget_Month, Expense_Date, and Calendar_Week calculations.
2. IF Household_Time_Zone configuration is absent, THEN THE Money_Journal SHALL use `Asia/Jakarta`.
3. WHEN Expense_Date is received in `YYYY-MM-DD` form, THE Transaction_Service SHALL parse Expense_Date as a local calendar date in Household_Time_Zone without constructing or converting through UTC midnight.
4. WHEN the same valid Expense_Date is submitted from clients with different device time zones, THE Transaction_Service SHALL derive the same Budget_Month.
5. WHEN the same valid Budget_Month is requested from servers with different host time zones, THE Budget_Service SHALL return the same Salary_Cycle_Period boundaries and Calendar_Week identities.
6. WHEN a saved expense is returned for editing, THE Budget_Interface SHALL display the same `YYYY-MM-DD` Expense_Date that was saved.
7. IF configured Household_Time_Zone is not a recognized IANA time zone, THEN THE Money_Journal SHALL reject application startup with a configuration error identifying Household_Time_Zone.
8. IF Expense_Date does not match `YYYY-MM-DD` exactly or does not identify an existing local calendar date, THEN THE Transaction_Service SHALL return a field-specific validation error without creating or updating an expense.
9. IF a Budget_Month date calculation receives a month or year that cannot form the requested local calendar date, THEN THE Salary_Cycle_Resolver SHALL return a field-specific validation error without returning cycle output.
10. WHEN a valid date-only value is formatted for storage, retrieval, preview, or editing, THE Money_Journal SHALL preserve the calendar year, month, and day components.

### Requirement 12: Maintain API and Data Integrity

**User Story:** As a maintainer, I want explicit salary-cycle and cadence data contracts, so that current pages and future clients receive consistent results.

#### Acceptance Criteria

1. WHEN budget data is requested for a valid Budget_Month, THE Budget_Service SHALL return Budget_Month, Household_Time_Zone, inclusive Salary_Cycle_Period start date, and inclusive Salary_Cycle_Period end date.
2. WHEN budget data is requested for a valid Budget_Month, THE Budget_Service SHALL return each Pocket identifier, active Budget_Cadence, active allocation identifier or missing-allocation marker, allocation amount, attributed spending, remaining amount, and percentage used.
3. WHERE a Pocket uses Weekly Budget_Cadence, THE Budget_Service SHALL return the exact intersecting Calendar_Week list, selected ISO week identity, selected week start and end dates, and selected Weekly_Allocation details.
4. WHERE a Pocket uses Monthly Budget_Cadence, THE Budget_Service SHALL return Monthly_Allocation details without requiring or returning a selected Calendar_Week.
5. WHEN budget data is requested for a valid Budget_Month, THE Budget_Service SHALL return aggregate active allocation, attributed spending, remaining amount, percentage used, and health status for the selected Budget_Month.
6. IF requested Budget_Month does not match `YYYY-MM` exactly or does not identify a valid calendar month, THEN THE Budget_Service SHALL return a field-specific validation error.
7. IF requested Calendar_Week does not match `YYYY-Www` exactly, uses a week number outside 01 through 53, or does not identify an existing ISO Calendar_Week in the supplied ISO week-year, THEN THE Budget_Service SHALL return a field-specific validation error.
8. IF Pocket identifier, Budget_Cadence, allocation amount, Expense_Date, Budget_Month identifier, Calendar_Week identifier, allocation identifier, or transaction identifier is invalid, THEN THE Money_Journal SHALL return a field-specific validation error before any persistent mutation.
9. WHEN a valid Monthly_Allocation write targets an existing Pocket and Budget_Month composite key, THE Budget_Service SHALL atomically update the matching record without creating another record.
10. WHEN a valid Weekly_Allocation write targets an existing Pocket, Budget_Month, ISO week-year, and ISO week-number composite key, THE Budget_Service SHALL atomically update the matching record without creating another record.
11. WHEN a valid allocation write targets a composite key that does not exist, THE Budget_Service SHALL atomically create exactly one allocation record for the composite key.
12. WHEN concurrent allocation writes target the same composite key, THE Budget_Service SHALL enforce persistent uniqueness so that at most one allocation record exists for the composite key after all writes complete.
13. WHEN concurrent valid updates to one allocation are accepted, THE Budget_Service SHALL persist a complete amount and metadata set from one accepted request without combining partial field values from different requests.
14. IF the selected concurrent-write policy rejects an allocation update, THEN THE Budget_Service SHALL return a conflict error without partially applying the rejected update.
15. THE Money_Journal SHALL preserve authenticated access to Check Pockets, Log Spending, Monthly Story, Review History, budget APIs, and transaction APIs while adding salary-cycle fields.
16. IF an unauthenticated client requests an authenticated page, budget API, or transaction API, THEN THE Money_Journal SHALL return an authentication error without disclosing household data or performing a persistent mutation.

## Testable Correctness Properties

The following properties refine the acceptance criteria and are suitable for automated property-based tests because each property exercises Money Journal date or aggregation logic across many generated inputs. External database wiring, session middleware, rendered pages, and route availability should use representative integration or smoke tests instead of high-volume property tests.

1. **Payday weekend mapping**: For generated month and year values, Actual_Payday is the 25th for weekday Nominal_Payday, the 24th for Saturday Nominal_Payday, and the 23rd for Sunday Nominal_Payday. Each weekend adjustment produces a Friday Actual_Payday. Covers Requirement 1.
2. **Cycle partition invariant**: For generated consecutive Budget_Month values, the later Salary_Cycle_Period starts exactly one local date after the earlier Salary_Cycle_Period ends. No generated local date belongs to zero periods or two periods. Covers Requirement 2.
3. **Boundary assignment**: For every generated month, the day before Actual_Payday maps to the same named calendar month, while Actual_Payday and every later date in that calendar month map to the following Budget_Month. Covers Requirements 1 and 2.
4. **Year-boundary assignment**: Dates from December Actual_Payday through December 31 map to January of the next year, and the January Salary_Cycle_Period begins on December Actual_Payday. Covers Requirements 2 and 9.
5. **Assignment idempotence**: Repeated Budget_Month derivation for the same Expense_Date and Household_Time_Zone produces the same result. Covers Requirements 2, 3, and 11.
6. **Time-zone independence for date-only input**: Generated `YYYY-MM-DD` values produce the same Budget_Month regardless of simulated client or host UTC offset when Household_Time_Zone is unchanged. Covers Requirement 11.
7. **Calendar-week partition invariant**: Within a generated Budget_Month, every local date belongs to exactly one listed Calendar_Week, including Calendar_Weeks crossing month, year, or Actual_Payday boundaries. Covers Requirement 5.
8. **Salary-cycle precedence in crossing weeks**: For a generated Calendar_Week crossing Actual_Payday, pre-payday Pocket_Shares appear only in the earlier Budget_Month and on-or-after-payday Pocket_Shares appear only in the following Budget_Month. Covers Requirements 5 and 6.
9. **Pocket-share conservation**: For generated valid single-pocket and multi-pocket expenses, the sum attributed across Pockets equals the sum of expense amounts, and no Pocket_Share is counted twice. Covers Requirement 6.
10. **Cadence isolation**: Updating a generated Weekly_Allocation changes no Monthly_Allocation, other Calendar_Week, other Pocket, or other Budget_Month. Updating a generated Monthly_Allocation changes no Weekly_Allocation. Covers Requirements 4 and 5.
11. **Remaining-balance invariant**: For generated valid allocations and included Pocket_Shares, displayed remaining amount equals allocation amount minus included spending, including negative remaining values. Covers Requirement 6.
12. **Migration idempotence**: Applying the migration transformation twice produces data equivalent to applying the migration transformation once. Covers Requirement 10.

## Representative Boundary Examples

| Nominal payday | Weekday | Actual payday | First following Budget_Month date | Resulting Budget_Month |
|---|---|---|---|---|
| 2026-04-25 | Saturday | 2026-04-24 | 2026-04-24 | May 2026 |
| 2027-07-25 | Sunday | 2027-07-23 | 2027-07-23 | August 2027 |
| 2026-06-25 | Thursday | 2026-06-25 | 2026-06-25 | July 2026 |
| 2027-12-25 | Saturday | 2027-12-24 | 2027-12-24 | January 2028 |

For the April 2026 example, an expense on 2026-04-23 belongs to April 2026, while an expense on 2026-04-24 belongs to May 2026. The May 2026 Salary_Cycle_Period runs from 2026-04-24 through the day before the May 2026 Actual_Payday.

## Current Codebase Impact to Address During Design

| Current area | Existing behavior requiring design follow-up |
|---|---|
| `models/transaction.js` | Requires explicit `budgetMonth` and `budgetYear`; stores Expense_Date as JavaScript `Date`; has no salary-cycle metadata. |
| `models/pocketBudget.js` | Enforces one record per Pocket, month, and year; has no Budget_Cadence or Calendar_Week key. |
| `models/closedMonth.js` | Closes a month/year pair and can continue representing a named Budget_Month after semantics are updated. |
| `controllers/transactionController.js` | Trusts supplied budget month values; create checks closed state, while update and delete do not enforce closed state. |
| `controllers/budgetController.js` | Aggregates by explicit budget month, restricts editing by calendar month, and contains unused calendar date-range variables. |
| `routes/transactions.js` and `routes/budget.js` | Existing authenticated endpoints must retain access while accepting or returning salary-cycle metadata. |
| `views/log-spending.hbs` and `public/js/log-spending.js` | Provide an editable prior/current/next Budget Month selector and include local/UTC date conversions. |
| `views/check-pockets.hbs` and `public/js/check-pockets.js` | Provide only month navigation and one allocation per Pocket; weekly selection and salary-cycle date ranges are absent. |
| `public/js/monthly-story.js` and `public/js/review-history.js` | Filter by explicit Budget_Month but initialize month values through UTC-based `toISOString` calls and group dates inconsistently. |
| `scripts/migrate-budget-month.js` | Assigns missing transaction budget fields to March 2026 rather than deriving classification from Expense_Date. |
| `package.json` | Defines no functioning test suite; design must select test tooling before correctness properties can be automated. |
