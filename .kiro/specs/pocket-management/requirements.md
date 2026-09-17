# Requirements Document

## Introduction

Pocket Management replaces Money Journal’s fixed pocket list with managed pocket definitions and a per-Budget_Month setup workflow. A Wife_Role user can create and maintain pockets with an emoji, name, monthly or weekly cadence, and default amount; select the pockets used in each Budget_Month; and apply default amounts or enter custom allocations. Household members continue to see pocket budgets and historical spending through the existing Check Pockets and transaction experiences.

These requirements preserve current repository behavior: Budget_Month follows the salary-cycle definition, Weekly allocations use intersecting ISO Calendar_Weeks, Wife_Role controls budget mutations, the active and immediately following Budget_Month form the Editable_Window, and Closed_Budget_Month data is protected. Existing pocket and allocation history remains readable while fixed pocket constants transition to managed records.

## Glossary

- **Money_Journal**: The complete household expense and budgeting application.
- **Pocket_Management_Feature**: The Money Journal capability for maintaining Pocket_Definitions and Pocket_Assignments.
- **Pocket_Management_Service**: The server-side capability that validates, stores, retrieves, archives, restores, and assigns pockets.
- **Pocket_Interface**: The browser interface for viewing and managing Pocket_Definitions and configuring Pocket_Assignments.
- **Budget_Service**: The existing server-side capability that retrieves, protects, calculates, and summarizes pocket budgets.
- **Transaction_Service**: The existing server-side capability that validates and stores expenses and Pocket references.
- **Pocket_Definition**: A reusable pocket record containing an immutable Pocket_Identifier, Pocket_Name, Pocket_Emoji, Pocket_Cadence, Default_Amount, lifecycle status, audit identity, and timestamps.
- **Pocket_Identifier**: A system-generated immutable value that identifies one Pocket_Definition independently of Pocket_Name.
- **Pocket_Name**: A trimmed, human-readable label containing 1 through 50 characters.
- **Normalized_Pocket_Name**: A Pocket_Name after trimming surrounding whitespace, converting letters to lowercase, and replacing each sequence of internal whitespace with one space for uniqueness comparison.
- **Pocket_Emoji**: Exactly one user-perceived emoji, including an emoji with skin-tone modifiers or joined emoji components.
- **Pocket_Cadence**: The planning frequency of a Pocket_Definition; permitted values are Monthly and Weekly.
- **Rupiah_Amount**: A non-negative whole-number amount from 0 through 999,999,999,999 inclusive.
- **Default_Amount**: The Rupiah_Amount proposed when a Pocket_Definition is assigned to a Budget_Month.
- **Active_Pocket**: A Pocket_Definition available for new Pocket_Assignments and expense selection.
- **Archived_Pocket**: A Pocket_Definition excluded from new Pocket_Assignments and new expense selection while retained for historical records.
- **Budget_Month**: The existing named month and year whose budget covers one salary-cycle period, represented as `YYYY-MM`.
- **Calendar_Week**: An existing Monday-through-Sunday ISO week identified as `YYYY-Www` that contains at least one date in a Budget_Month salary-cycle period.
- **Pocket_Assignment**: The association of one Pocket_Definition with one Budget_Month, including a snapshot of Pocket_Name, Pocket_Emoji, Pocket_Cadence, Amount_Mode, and resulting allocation values.
- **Amount_Mode**: The source selected for a Pocket_Assignment; permitted values are Use_Default and Customize.
- **Monthly_Allocation**: One Rupiah_Amount for a Monthly Pocket_Assignment across the complete Budget_Month salary-cycle period.
- **Weekly_Allocation**: One Rupiah_Amount for a Weekly Pocket_Assignment and one Calendar_Week.
- **Assignment_Setup**: The workflow for selecting pockets and allocation values for one Budget_Month before confirming the complete selection.
- **Assignment_Summary**: The Pocket_Interface preview listing selected pockets, cadence, amount source, allocation values, and combined allocation total before confirmation.
- **Unassigned_Pocket**: An Active_Pocket without a Pocket_Assignment in the selected Budget_Month.
- **Editable_Window**: The existing rule permitting budget edits for the active Budget_Month and immediately following Budget_Month when each Budget_Month is open.
- **Closed_Budget_Month**: A Budget_Month protected by the existing month-close workflow.
- **Wife_Role**: The existing authenticated role authorized to manage pockets and budget assignments.
- **Household_Member**: Any authenticated Money Journal user authorized to view household budget information.
- **Historical_Record**: A saved expense, Pocket_Assignment, allocation, report, or Closed_Budget_Month record from the selected or an earlier Budget_Month.
- **Version_Conflict**: A response indicating that another accepted update changed the target record after the user loaded the record.
- **Record_Version**: A whole-number revision value incremented after each accepted change to a Pocket_Definition or Pocket_Assignment.
- **Responsive_Layout**: A Pocket_Interface layout that adapts content and controls to the available viewport width.
- **Reduced_Motion_Preference**: A browser or operating-system setting requesting reduced nonessential animation.
- **Legacy_Pocket**: A pocket originating from the existing fixed pocket-name-to-emoji configuration.
- **Migration_Process**: The controlled conversion of Legacy_Pockets to Pocket_Definitions and the association of existing budget data with Pocket_Identifiers.
- **Accessibility_Standard**: Web Content Accessibility Guidelines 2.2 Level AA requirements applicable to the Pocket_Interface.

## Product Assumptions Applied in This Draft

1. Pocket_Cadence and Default_Amount are reusable defaults on a Pocket_Definition. Each Pocket_Assignment snapshots the values used for one Budget_Month, so later Pocket_Definition edits do not rewrite history.
2. Assignment_Setup is initiated by the Wife_Role user for each Budget_Month; Money_Journal does not automatically assign every Active_Pocket.
3. Use_Default creates one Monthly_Allocation for Monthly cadence and one Weekly_Allocation with Default_Amount for every Calendar_Week in Weekly cadence.
4. Customize accepts one amount for Monthly cadence and an independent amount for every Calendar_Week in Weekly cadence.
5. Archive is the supported removal lifecycle because pocket names can be referenced by expenses and reports. Archived data remains visible in historical contexts.
6. Pocket management follows the existing role, Editable_Window, Closed_Budget_Month, salary-cycle, ISO week, and Indonesian rupiah conventions.
7. Legacy_Pockets become Active_Pockets. The most recent saved cadence becomes the reusable Pocket_Cadence, with Monthly used when no cadence exists; Default_Amount is zero because current data has no authoritative reusable default.

## Requirements

### Requirement 1: Create Pocket Definitions

**User Story:** As a Wife_Role user, I want to create reusable pockets, so that household budgets can reflect changing spending needs.

#### Acceptance Criteria

1. WHEN an authenticated Wife_Role user submits valid Pocket_Name, Pocket_Emoji, Pocket_Cadence, and Default_Amount values, THE Pocket_Management_Service SHALL create exactly one Active_Pocket with a Pocket_Identifier that differs from every existing Pocket_Identifier.
2. WHEN the Pocket_Management_Service creates a Pocket_Definition, THE Pocket_Management_Service SHALL assign an immutable Pocket_Identifier and an initial Record_Version of 1.
3. WHEN the Pocket_Management_Service creates a Pocket_Definition, THE Pocket_Management_Service SHALL record the authenticated Wife_Role identity as creator and updater and record the creation timestamp as the update timestamp.
4. WHEN pocket creation succeeds, THE Pocket_Management_Service SHALL return Pocket_Identifier, trimmed Pocket_Name, Pocket_Emoji, Pocket_Cadence, Default_Amount, Active_Pocket status, creator identity, updater identity, creation timestamp, update timestamp, and Record_Version from the persisted Pocket_Definition.
5. WHEN pocket creation succeeds, THE Pocket_Management_Service SHALL preserve the count, field values, relationships, and Record_Versions of every Pocket_Definition, Pocket_Assignment, allocation, expense, and Historical_Record that existed before the request.
6. IF an authenticated Household_Member without Wife_Role submits a pocket creation request, THEN THE Pocket_Management_Service SHALL return an authorization error and preserve the complete pre-request persisted state.
7. IF an unauthenticated client submits a pocket creation request, THEN THE Pocket_Management_Service SHALL return an authentication error without disclosing household pocket data and preserve the complete pre-request persisted state.
8. IF any persistence operation for pocket creation fails, THEN THE Pocket_Management_Service SHALL return a persistence error and restore Pocket_Definitions, Pocket_Assignments, allocations, expenses, and Historical_Records to the complete pre-request persisted state.

### Requirement 2: Validate Pocket Attributes

**User Story:** As a Wife_Role user, I want clear pocket validation, so that saved pockets remain identifiable and usable.

#### Acceptance Criteria

1. IF Pocket_Name, Pocket_Emoji, Pocket_Cadence, or Default_Amount is omitted or null, THEN THE Pocket_Management_Service SHALL return a required-field validation error for each omitted or null field and preserve pocket data.
2. WHEN Pocket_Name contains 1 through 50 characters after trimming surrounding whitespace, THE Pocket_Management_Service SHALL use the trimmed value for validation, persistence, normalization, and responses.
3. IF Pocket_Name contains fewer than 1 character or more than 50 characters after trimming surrounding whitespace, THEN THE Pocket_Management_Service SHALL return a Pocket_Name validation error containing the permitted range and preserve pocket data.
4. IF Normalized_Pocket_Name matches the Normalized_Pocket_Name of a different Active_Pocket or Archived_Pocket, THEN THE Pocket_Management_Service SHALL return a Pocket_Name conflict and preserve pocket data.
5. IF Pocket_Emoji does not contain exactly one user-perceived emoji, THEN THE Pocket_Management_Service SHALL return a Pocket_Emoji validation error and preserve pocket data.
6. IF Pocket_Cadence is a value other than Monthly or Weekly, THEN THE Pocket_Management_Service SHALL return a Pocket_Cadence validation error and preserve pocket data.
7. IF Default_Amount is not a whole-number numeric value from 0 through 999,999,999,999 inclusive, THEN THE Pocket_Management_Service SHALL return a Default_Amount validation error containing the permitted numeric range and preserve pocket data.
8. IF a pocket request contains two or more invalid fields, THEN THE Pocket_Management_Service SHALL return one field-specific validation error for every invalid field in the same response and preserve pocket data.
9. WHEN two sequential creation requests contain Pocket_Names with the same Normalized_Pocket_Name, THE Pocket_Management_Service SHALL persist the first accepted Pocket_Definition and reject the second request with a Pocket_Name conflict.

### Requirement 3: View and Update Pocket Definitions

**User Story:** As a household member, I want to view pocket details, and as a Wife_Role user, I want to update active pockets, so that future budgets use current pocket settings.

#### Acceptance Criteria

1. WHEN an authenticated Household_Member requests active pocket definitions, THE Pocket_Management_Service SHALL return every Active_Pocket ordered by Normalized_Pocket_Name ascending and then Pocket_Identifier ascending.
2. WHERE archived-pocket viewing is selected, WHEN an authenticated Household_Member requests pocket definitions, THE Pocket_Management_Service SHALL return Archived_Pockets in a collection separate from Active_Pockets with each collection ordered by Normalized_Pocket_Name ascending and then Pocket_Identifier ascending.
3. WHEN the Pocket_Management_Service returns a Pocket_Definition, THE Pocket_Management_Service SHALL include Pocket_Identifier, trimmed Pocket_Name, Pocket_Emoji, Pocket_Cadence, Default_Amount, lifecycle status, creator identity, updater identity, creation timestamp, update timestamp, and Record_Version.
4. WHEN an authenticated Wife_Role user submits a valid update request for an Active_Pocket, THE Pocket_Management_Service SHALL replace only the submitted mutable fields among Pocket_Name, Pocket_Emoji, Pocket_Cadence, and Default_Amount.
5. WHEN an authenticated Wife_Role user submits a valid update request that omits a mutable field, THE Pocket_Management_Service SHALL preserve the stored value of the omitted field.
6. WHEN an accepted update request changes at least one mutable field, THE Pocket_Management_Service SHALL preserve Pocket_Identifier, creator identity, and creation timestamp and increment Record_Version by exactly 1.
7. WHEN an accepted update request changes at least one mutable field, THE Pocket_Management_Service SHALL record the authenticated Wife_Role identity as updater and record the acceptance time as update timestamp.
8. WHEN a valid update request submits values equal to all corresponding stored values, THE Pocket_Management_Service SHALL return the stored Pocket_Definition without changing Record_Version, updater identity, or update timestamp.
9. IF a submitted mutable field fails Requirement 2 validation, THEN THE Pocket_Management_Service SHALL return every applicable field-specific error and preserve the complete Pocket_Definition.
10. IF a update request contains an unknown Pocket_Identifier, THEN THE Pocket_Management_Service SHALL return a not-found error and preserve pocket data.
11. IF an authenticated Wife_Role user submits a update request for an Archived_Pocket, THEN THE Pocket_Management_Service SHALL return an archived-lifecycle conflict and preserve the complete Pocket_Definition.
12. IF an authenticated Household_Member without Wife_Role submits a pocket update request, THEN THE Pocket_Management_Service SHALL return an authorization error and preserve pocket data.
13. WHEN a Pocket_Definition update succeeds, THE Pocket_Management_Service SHALL apply updated values only to Pocket_Assignments confirmed after the update acceptance time.
14. WHEN a Pocket_Definition update succeeds, THE Pocket_Management_Service SHALL preserve every previously confirmed Pocket_Assignment snapshot and Historical_Record.

### Requirement 4: Manage Pocket Lifecycle

**User Story:** As a Wife_Role user, I want to archive and restore pockets, so that obsolete pockets leave active workflows without losing financial history.

#### Acceptance Criteria

1. WHEN an authenticated Wife_Role user selects archive for an Active_Pocket, THE Pocket_Interface SHALL present a confirmation that identifies the Pocket_Name and Pocket_Emoji and offers separate confirm and cancel actions.
2. WHEN the authenticated Wife_Role user cancels archive confirmation, THE Pocket_Interface SHALL close the confirmation, retain Active_Pocket status, and omit the archive request.
3. IF an archive request lacks explicit confirmation for the identified Pocket_Identifier, THEN THE Pocket_Management_Service SHALL reject the request with a confirmation-required error and preserve lifecycle status.
4. WHEN an authenticated Wife_Role user confirms archive for an Active_Pocket, THE Pocket_Management_Service SHALL change lifecycle status to Archived_Pocket, record the authenticated Wife_Role identity and acceptance time as update audit data, and increment Record_Version by exactly 1.
5. WHEN archive succeeds, THE Pocket_Management_Service SHALL return Pocket_Identifier, Archived_Pocket status, updater identity, update timestamp, and incremented Record_Version.
6. WHEN a Pocket_Definition becomes an Archived_Pocket, THE Pocket_Management_Service SHALL exclude the Pocket_Identifier from new Pocket_Assignment selection for every Budget_Month.
7. WHEN a Pocket_Definition becomes an Archived_Pocket, THE Transaction_Service SHALL include the Pocket_Identifier in new expense selection only for a Budget_Month containing an existing Pocket_Assignment for the Pocket_Identifier.
8. WHEN a Pocket_Definition becomes an Archived_Pocket, THE Pocket_Management_Service SHALL preserve all existing Pocket_Assignments, allocations, expenses, and Historical_Records referencing the Pocket_Identifier.
9. WHEN an authenticated Wife_Role user restores an Archived_Pocket, THE Pocket_Management_Service SHALL change lifecycle status to Active_Pocket, record the authenticated Wife_Role identity and acceptance time as update audit data, and increment Record_Version by exactly 1.
10. WHEN restore succeeds, THE Pocket_Management_Service SHALL return Pocket_Identifier, Active_Pocket status, updater identity, update timestamp, and incremented Record_Version.
11. WHEN restore succeeds, THE Pocket_Management_Service SHALL include the restored Pocket_Identifier in new Pocket_Assignment selection.
12. IF an unauthenticated client submits an archive or restore request, THEN THE Pocket_Management_Service SHALL return an authentication error without disclosing pocket data and preserve lifecycle status.
13. IF an authenticated Household_Member without Wife_Role submits an archive or restore request, THEN THE Pocket_Management_Service SHALL return an authorization error and preserve lifecycle status.
14. IF an archive or restore request contains an unknown Pocket_Identifier, THEN THE Pocket_Management_Service SHALL return a not-found error and preserve pocket data.

### Requirement 5: Configure Budget Month Pocket Assignments

**User Story:** As a Wife_Role user, I want to choose the pockets used in each Budget_Month, so that each salary cycle has an intentional plan.

#### Acceptance Criteria

1. WHEN an authenticated Wife_Role user opens Assignment_Setup for a Budget_Month in the Editable_Window, THE Pocket_Management_Service SHALL return every Active_Pocket exactly once with assigned or Unassigned_Pocket status for the selected Budget_Month.
2. WHEN Assignment_Setup displays an existing Pocket_Assignment, THE Pocket_Management_Service SHALL return the stored Amount_Mode, Pocket_Cadence snapshot, allocation values, Calendar_Week identities, and Record_Version for the selected Budget_Month.
3. WHEN an authenticated Wife_Role user selects an Unassigned_Pocket, THE Pocket_Interface SHALL add the Pocket_Identifier exactly once to pending Assignment_Setup state without changing persisted data.
4. WHEN an authenticated Wife_Role user removes a pending selection before confirmation, THE Pocket_Interface SHALL remove the Pocket_Identifier from pending Assignment_Setup state without changing persisted data.
5. WHEN the authenticated Wife_Role user confirms valid Assignment_Setup, THE Pocket_Management_Service SHALL persist exactly one Pocket_Assignment for each selected Pocket_Identifier and the selected Budget_Month.
6. WHEN the Pocket_Management_Service creates a Pocket_Assignment, THE Pocket_Management_Service SHALL snapshot the current Pocket_Name, Pocket_Emoji, Pocket_Cadence, selected Amount_Mode, and resulting allocation values.
7. WHEN confirmed Assignment_Setup contains an existing Pocket_Assignment with changed Amount_Mode or allocation values, THE Pocket_Management_Service SHALL update the changed Pocket_Assignment and increment Record_Version by exactly 1.
8. WHEN confirmed Assignment_Setup contains an existing Pocket_Assignment with values equal to stored values, THE Pocket_Management_Service SHALL preserve the Pocket_Assignment Record_Version, updater identity, and update timestamp.
9. WHEN Assignment_Setup confirmation succeeds, THE Pocket_Management_Service SHALL return every Pocket_Assignment for the selected Budget_Month exactly once.
10. WHEN Assignment_Setup confirmation succeeds, THE Pocket_Management_Service SHALL return a combined allocation total equal to the sum of every Monthly_Allocation and Weekly_Allocation returned for the selected Budget_Month.
11. IF confirmed Assignment_Setup contains a duplicate Pocket_Identifier, THEN THE Pocket_Management_Service SHALL return a conflict identifying the duplicate Pocket_Identifier and preserve all Pocket_Assignments and allocations at pre-request values.
12. IF confirmed Assignment_Setup references an Archived_Pocket or unknown Pocket_Identifier, THEN THE Pocket_Management_Service SHALL return one validation or not-found error for every invalid Pocket_Identifier and preserve all Pocket_Assignments and allocations at pre-request values.
13. IF any selection, amount, version, authorization, Budget_Month, or lifecycle validation fails during Assignment_Setup confirmation, THEN THE Pocket_Management_Service SHALL reject the complete confirmation and preserve all Pocket_Assignments and allocations at pre-request values.
14. WHEN a Household_Member views a Budget_Month containing zero Pocket_Assignments, THE Pocket_Interface SHALL display zero assigned pockets and a combined allocation total of zero without substituting Active_Pockets.
15. WHEN the active Budget_Month contains zero Pocket_Assignments, THE Pocket_Interface SHALL present an action to start Assignment_Setup for the active Budget_Month.
16. WHEN the selected Budget_Month contains one or more Unassigned_Pockets, THE Pocket_Interface SHALL display an incomplete-setup indicator equal to the count of Active_Pockets without a Pocket_Assignment in the selected Budget_Month.
17. WHEN identical valid Assignment_Setup confirmations are accepted sequentially, THE Pocket_Management_Service SHALL return equivalent Pocket_Assignments and totals without creating duplicate assignments, changing allocations, or incrementing Record_Versions after the first acceptance.
18. WHEN Assignment_Setup confirmation succeeds, THE Pocket_Management_Service SHALL make all resulting Pocket_Assignment and allocation changes observable together as one persisted result.
19. IF persistence fails during Assignment_Setup confirmation, THEN THE Pocket_Management_Service SHALL return a persistence error and restore all Pocket_Assignments and allocations to pre-request values.

### Requirement 6: Apply Default or Custom Amounts

**User Story:** As a Wife_Role user, I want to use pocket defaults or customize allocations, so that setup is fast without removing month-specific control.

#### Acceptance Criteria

1. WHERE Amount_Mode is Use_Default and the Pocket_Cadence snapshot is Monthly, WHEN Assignment_Setup is confirmed, THE Pocket_Management_Service SHALL persist exactly one Monthly_Allocation equal to the Pocket_Definition Default_Amount at confirmation time.
2. WHERE Amount_Mode is Use_Default and the Pocket_Cadence snapshot is Weekly, WHEN Assignment_Setup is confirmed, THE Pocket_Management_Service SHALL persist exactly one Weekly_Allocation equal to the Pocket_Definition Default_Amount at confirmation time for each Calendar_Week intersecting the selected Budget_Month salary-cycle period.
3. WHERE Amount_Mode is Customize and the Pocket_Cadence snapshot is Monthly, WHEN Assignment_Setup is submitted, THE Pocket_Management_Service SHALL require exactly one custom Rupiah_Amount identified as the Monthly_Allocation.
4. WHERE Amount_Mode is Customize and the Pocket_Cadence snapshot is Weekly, WHEN Assignment_Setup is submitted, THE Pocket_Management_Service SHALL require exactly one custom Rupiah_Amount for every Calendar_Week intersecting the selected Budget_Month salary-cycle period.
5. WHERE Amount_Mode is Customize and the Pocket_Cadence snapshot is Weekly, WHEN Assignment_Setup is submitted, THE Pocket_Management_Service SHALL reject a custom allocation whose Calendar_Week does not intersect the selected Budget_Month salary-cycle period.
6. WHEN an authenticated Wife_Role user changes Amount_Mode from Use_Default to Customize, THE Pocket_Interface SHALL prefill each custom amount field with the displayed Default_Amount without persisting the mode or prefilled values.
7. WHEN an authenticated Wife_Role user changes Amount_Mode from Customize to Use_Default, THE Pocket_Interface SHALL replace each displayed pending custom amount with the current Pocket_Definition Default_Amount without persisting the mode or displayed values.
8. WHEN valid customized Monthly allocation data is confirmed, THE Pocket_Management_Service SHALL persist the submitted Rupiah_Amount as the sole Monthly_Allocation for the Pocket_Assignment.
9. WHEN valid customized Weekly allocation data is confirmed, THE Pocket_Management_Service SHALL persist each submitted Rupiah_Amount with the corresponding Calendar_Week identity.
10. WHEN a Weekly Pocket_Assignment is displayed in Assignment_Summary, THE Pocket_Interface SHALL show every intersecting Calendar_Week identity and corresponding pending Weekly_Allocation exactly once.
11. IF a required custom amount is omitted, null, not a whole number, below 0, or above 999,999,999,999, THEN THE Pocket_Management_Service SHALL return a field-specific validation error for the corresponding Monthly_Allocation or Calendar_Week and preserve stored assignment data.
12. IF two or more required custom amounts are invalid, THEN THE Pocket_Management_Service SHALL return one field-specific validation error for every invalid amount in the same response and preserve stored assignment data.
13. WHEN allocation confirmation succeeds, THE Pocket_Management_Service SHALL snapshot Amount_Mode, Pocket_Cadence, each allocation identity, and each allocation value in the Pocket_Assignment.
14. WHEN allocation confirmation succeeds, THE Pocket_Management_Service SHALL preserve the Pocket_Definition Default_Amount and every Pocket_Assignment outside the selected Budget_Month.
15. WHEN Pocket_Definition Default_Amount changes after allocation confirmation, THE Pocket_Management_Service SHALL preserve the confirmed Pocket_Assignment allocation values and Historical_Records.
16. WHEN identical Use_Default or Customize allocation data is confirmed sequentially, THE Pocket_Management_Service SHALL preserve exactly one allocation per required allocation identity and preserve values and Record_Version after the first acceptance.

### Requirement 7: Protect Assignment Lifecycle and History

**User Story:** As a household member, I want month-specific pocket history preserved, so that later pocket changes do not alter past financial reports.

#### Acceptance Criteria

1. WHEN a Pocket_Assignment is created, THE Pocket_Management_Service SHALL associate the Pocket_Assignment with exactly one Pocket_Identifier and one Budget_Month.
2. WHEN the same Pocket_Identifier is assigned to two Budget_Months, THE Pocket_Management_Service SHALL persist two independent Pocket_Assignments with independent Record_Versions.
3. WHEN a Pocket_Assignment is confirmed, THE Pocket_Management_Service SHALL store Pocket_Name, Pocket_Emoji, Pocket_Cadence, Amount_Mode, allocation identities, allocation values, creator identity, updater identity, creation timestamp, update timestamp, and Record_Version in the Pocket_Assignment snapshot.
4. WHEN Amount_Mode or allocation values change for one Pocket_Assignment, THE Pocket_Management_Service SHALL preserve every field and Record_Version of Pocket_Assignments for all other Budget_Months.
5. WHEN an authenticated Wife_Role user selects removal for a Pocket_Assignment, THE Pocket_Interface SHALL present a confirmation that identifies Pocket_Name and Budget_Month and offers separate confirm and cancel actions.
6. WHEN the authenticated Wife_Role user cancels removal confirmation, THE Pocket_Interface SHALL close the confirmation and omit the removal request.
7. IF a Pocket_Assignment removal request lacks explicit confirmation for the identified Pocket_Identifier and Budget_Month, THEN THE Pocket_Management_Service SHALL return a confirmation-required error and preserve the Pocket_Assignment and allocations.
8. WHEN an authenticated Wife_Role user confirms removal of a Pocket_Assignment with zero attributed spending and an open Budget_Month in the Editable_Window, THE Pocket_Management_Service SHALL remove exactly the identified Pocket_Assignment and corresponding allocations.
9. IF a Pocket_Assignment has attributed spending from a single-pocket expense or a split-expense share, THEN THE Pocket_Management_Service SHALL return a lifecycle conflict identifying Pocket_Name and Budget_Month and preserve the Pocket_Assignment and allocations.
10. WHEN a Pocket_Assignment is removed, THE Pocket_Management_Service SHALL preserve every Pocket_Assignment, allocation, expense, and Historical_Record outside the identified Pocket_Identifier and Budget_Month.
11. WHEN the Budget_Service returns a Historical_Record, THE Budget_Service SHALL use the Pocket_Assignment snapshot stored for the Historical_Record Budget_Month.
12. WHEN a Pocket_Definition is renamed, archived, restored, assigned a different cadence, or assigned a different Default_Amount, THE Budget_Service SHALL preserve Pocket_Name, Pocket_Emoji, Pocket_Cadence, Amount_Mode, allocation identities, and allocation values in every previously confirmed Pocket_Assignment and Historical_Record.

### Requirement 8: Integrate Assignments with Budgeting and Expenses

**User Story:** As a household member, I want assigned pockets used consistently across budgets and expenses, so that spending and allocations remain aligned.

#### Acceptance Criteria

1. WHEN the Budget_Service returns a Budget_Month view, THE Budget_Service SHALL include exactly the Pocket_Assignments associated with the selected Budget_Month.
2. WHERE a Pocket_Assignment uses Monthly Pocket_Cadence, WHEN the Budget_Service calculates attributed spending, THE Budget_Service SHALL sum each single-pocket expense amount and each split-expense share for the Pocket_Identifier whose expense date falls within the selected Budget_Month salary-cycle period.
3. WHERE a Pocket_Assignment uses Weekly Pocket_Cadence, WHEN the Budget_Service calculates attributed spending for a Calendar_Week, THE Budget_Service SHALL sum each single-pocket expense amount and each split-expense share for the Pocket_Identifier whose expense date falls within the intersection of the Calendar_Week and selected Budget_Month salary-cycle period.
4. WHEN the Budget_Service calculates a pocket result, THE Budget_Service SHALL calculate remaining amount as allocation minus attributed spending.
5. WHEN the Budget_Service calculates a pocket result with allocation greater than zero, THE Budget_Service SHALL calculate percentage used as attributed spending divided by allocation multiplied by 100 and rounded to the nearest whole number.
6. WHEN the Budget_Service calculates a pocket result with allocation equal to zero, THE Budget_Service SHALL return percentage used equal to zero.
7. IF a requested Calendar_Week does not intersect the selected Budget_Month salary-cycle period, THEN THE Budget_Service SHALL return a Calendar_Week validation error without returning weekly budget metrics.
8. WHEN the Transaction_Service presents pockets for a new expense, THE Transaction_Service SHALL return each Pocket_Definition with a Pocket_Assignment in the expense Budget_Month exactly once regardless of current lifecycle status.
9. WHEN the Transaction_Service reads an existing expense, THE Transaction_Service SHALL resolve each stored Pocket_Identifier through the applicable Pocket_Assignment snapshot even when the Pocket_Definition is archived or renamed.
10. IF a new expense references a Pocket_Identifier without a Pocket_Assignment in the expense Budget_Month, THEN THE Transaction_Service SHALL return a Pocket_Identifier validation error and preserve expense data.
11. IF an expense update introduces a Pocket_Identifier without a Pocket_Assignment in the expense Budget_Month, THEN THE Transaction_Service SHALL return a Pocket_Identifier validation error and preserve the complete stored expense.
12. WHEN a split expense is submitted, THE Transaction_Service SHALL validate every split-expense Pocket_Identifier against Pocket_Assignments in the expense Budget_Month.
13. WHEN the Budget_Service calculates allocation totals, THE Budget_Service SHALL include each Monthly_Allocation or Weekly_Allocation for the selected result exactly once.
14. WHEN the Budget_Service calculates spending totals, THE Budget_Service SHALL include each eligible single-pocket expense amount exactly once and each eligible split-expense share exactly once without including the split expense parent amount.

### Requirement 9: Enforce Authorization, Editable Window, and Closed Month Rules

**User Story:** As a Wife_Role user, I want pocket setup to follow existing budget protections, so that reviewed periods remain stable.

#### Acceptance Criteria

1. WHEN an authenticated Household_Member requests Pocket_Definitions or Pocket_Assignments for the household, THE Pocket_Management_Service SHALL return the requested records permitted by existing household read-access rules.
2. IF an unauthenticated client requests Pocket_Definitions or Pocket_Assignments, THEN THE Pocket_Management_Service SHALL return an authentication error without returning Pocket_Definition, Pocket_Assignment, allocation, audit, or household data.
3. IF an authenticated Household_Member without Wife_Role submits a Pocket_Assignment creation, update, or removal request, THEN THE Pocket_Management_Service SHALL return an authorization error and preserve Pocket_Assignments and allocations.
4. WHILE an open Budget_Month is the active Budget_Month or immediately following Budget_Month, WHEN an authenticated Wife_Role user submits a valid Pocket_Assignment mutation, THE Pocket_Management_Service SHALL accept the mutation.
5. IF a selected Budget_Month is earlier than the active Budget_Month or later than the immediately following Budget_Month, THEN THE Pocket_Management_Service SHALL return an editable-window error and preserve Pocket_Assignments and allocations.
6. WHILE a Budget_Month is a Closed_Budget_Month, WHEN an authenticated Wife_Role user submits a Pocket_Assignment mutation, THE Pocket_Management_Service SHALL return a closed-month error and preserve Pocket_Assignments and allocations.
7. WHEN a Closed_Budget_Month is reopened inside the Editable_Window, THE Pocket_Management_Service SHALL preserve all Pocket_Assignments, allocations, expenses, Historical_Records, and Record_Versions during the reopen operation.
8. WHEN a previously Closed_Budget_Month is open inside the Editable_Window, THE Pocket_Management_Service SHALL accept a valid Pocket_Assignment mutation from an authenticated Wife_Role user.
9. IF one Assignment_Setup confirmation contains two or more invalid mutations, THEN THE Pocket_Management_Service SHALL return one error for every unauthorized, closed-month, editable-window, field, lifecycle, reference, uniqueness, or version failure that can be evaluated without disclosing unauthorized data.
10. IF one Assignment_Setup confirmation contains any invalid mutation, THEN THE Pocket_Management_Service SHALL reject every mutation in the confirmation and preserve all Pocket_Assignments and allocations at pre-request values.

### Requirement 10: Handle Concurrent and Failed Changes

**User Story:** As a Wife_Role user, I want pocket changes saved reliably, so that competing updates and failures do not produce partial budgets.

#### Acceptance Criteria

1. WHEN the Pocket_Management_Service accepts a Pocket_Definition or Pocket_Assignment mutation, THE Pocket_Management_Service SHALL expose the complete persisted result only after every required record change succeeds.
2. IF persistence fails before a Pocket_Definition or Pocket_Assignment mutation completes, THEN THE Pocket_Management_Service SHALL return a persistence error and restore every affected record, relationship, allocation, and Record_Version to the pre-request value.
3. IF a submitted Pocket_Definition Record_Version differs from the current stored Record_Version, THEN THE Pocket_Management_Service SHALL return a Version_Conflict containing the current Record_Version and preserve the stored Pocket_Definition.
4. IF a submitted Pocket_Assignment Record_Version differs from the current stored Record_Version, THEN THE Pocket_Management_Service SHALL return a Version_Conflict containing the current Record_Version and preserve the stored Pocket_Assignment and allocations.
5. WHEN an accepted Pocket_Definition mutation changes persisted data, THE Pocket_Management_Service SHALL increment the Pocket_Definition Record_Version by exactly 1 from the version validated for the request.
6. WHEN an accepted Pocket_Assignment mutation changes persisted data, THE Pocket_Management_Service SHALL increment the Pocket_Assignment Record_Version by exactly 1 from the version validated for the request.
7. WHEN a Version_Conflict occurs, THE Pocket_Interface SHALL retain every user-entered value and present separate actions labeled to keep the entered values or load the current stored values.
8. WHEN a user chooses to load current stored values after a Version_Conflict, THE Pocket_Interface SHALL replace the conflicting form values and Record_Version with values returned by the Pocket_Management_Service.
9. WHEN a user chooses to keep entered values after a Version_Conflict, THE Pocket_Interface SHALL preserve the entered form values without submitting another mutation.
10. WHEN concurrent valid creation requests use the same Normalized_Pocket_Name, THE Pocket_Management_Service SHALL accept only the request whose Pocket_Definition commits first and return a Pocket_Name conflict for every later request.
11. WHEN concurrent valid creation requests target the same Pocket_Identifier and Budget_Month, THE Pocket_Management_Service SHALL create exactly one Pocket_Assignment for the request that commits first.
12. WHEN a later concurrent request targets a Pocket_Identifier and Budget_Month pair created by an earlier concurrent request with different assignment values, THE Pocket_Management_Service SHALL return a Version_Conflict containing the committed Pocket_Assignment Record_Version and preserve the committed values.
13. WHEN a later concurrent request targets a Pocket_Identifier and Budget_Month pair created by an earlier concurrent request with equivalent assignment values, THE Pocket_Management_Service SHALL return the committed Pocket_Assignment without creating a duplicate or incrementing Record_Version.

### Requirement 11: Provide an Intuitive and Polished Pocket Interface

**User Story:** As a Wife_Role user, I want a clear and consistent pocket workflow, so that I can complete monthly setup with confidence.

#### Acceptance Criteria

1. WHEN an authenticated Wife_Role user opens Pocket_Interface, THE Pocket_Interface SHALL display one primary page heading and separate labeled actions for creating a Pocket_Definition, managing Pocket_Definitions, and starting Assignment_Setup.
2. WHEN Pocket_Interface displays a Pocket_Definition, THE Pocket_Interface SHALL show Pocket_Emoji, Pocket_Name, Pocket_Cadence, Default_Amount formatted as Indonesian rupiah, and lifecycle status in one card or table row.
3. WHEN an authenticated Wife_Role user opens the Pocket_Definition creation form, THE Pocket_Interface SHALL present labeled controls for Pocket_Emoji, Pocket_Name, Pocket_Cadence, and Default_Amount in that order.
4. WHEN an authenticated Wife_Role user opens the Pocket_Definition edit form, THE Pocket_Interface SHALL prepopulate Pocket_Emoji, Pocket_Name, Pocket_Cadence, and Default_Amount controls with the stored values.
5. WHEN an authenticated Wife_Role user performs Assignment_Setup, THE Pocket_Interface SHALL present Budget_Month selection, pocket selection, Amount_Mode selection, allocation entry, Assignment_Summary, and confirmation in that order.
6. WHEN Assignment_Summary is displayed, THE Pocket_Interface SHALL show selected Budget_Month, every selected Pocket_Name and Pocket_Emoji, Pocket_Cadence, Amount_Mode, each allocation identity and value, and combined allocation total before confirmation.
7. WHEN a form field fails client-side or server-side validation, THE Pocket_Interface SHALL display the field-specific error adjacent to the corresponding field and associate the error programmatically with the field.
8. WHEN a mutation request is pending, THE Pocket_Interface SHALL disable repeat submission for the pending action and display a text progress status until a success or failure response is received.
9. WHEN the Pocket_Interface receives a successful mutation response, THE Pocket_Interface SHALL replace pending state with the returned saved state and display a text success status within 200 milliseconds.
10. IF the Pocket_Interface receives a failed mutation response, THEN THE Pocket_Interface SHALL preserve user-entered form values and display the returned failure reason and a labeled retry action within 200 milliseconds.
11. WHEN Pocket_Interface contains zero Active_Pockets, THE Pocket_Interface SHALL display an empty-state message and a labeled action for an authenticated Wife_Role user to create the first Pocket_Definition.
12. WHEN Assignment_Setup contains one or more Unassigned_Pockets, THE Pocket_Interface SHALL display the exact Unassigned_Pocket count for the selected Budget_Month.
13. WHEN Pocket_Interface is displayed at a viewport width of 320 CSS pixels, THE Pocket_Interface SHALL present primary content, form fields, Assignment_Summary values, and actions without horizontal page scrolling.
14. WHEN Pocket_Interface is displayed at viewport widths from 321 through 767 CSS pixels, THE Pocket_Interface SHALL present primary content and actions without horizontal page scrolling.
15. WHEN Pocket_Interface is displayed at viewport widths of 768 CSS pixels or greater, THE Pocket_Interface SHALL preserve the interaction order defined in criteria 3 through 6.
16. THE Pocket_Interface SHALL provide a visible text label or programmatic accessible name for every input, selector, icon-only action, status message, and dialog control.
17. THE Pocket_Interface SHALL permit keyboard focus to reach and activate every interactive control in the same sequence as the visible workflow.
18. WHEN a dialog opens, THE Pocket_Interface SHALL move focus into the dialog and contain keyboard focus within the dialog until the dialog closes.
19. WHEN a dialog closes, THE Pocket_Interface SHALL return focus to the control that opened the dialog.
20. THE Pocket_Interface SHALL display a visible focus indicator for every keyboard-focusable control.
21. WHEN Pocket_Interface is displayed at viewport widths from 320 through 767 CSS pixels, THE Pocket_Interface SHALL provide a minimum 44 by 44 CSS pixel activation area for every primary action.
22. THE Pocket_Interface SHALL provide a contrast ratio of at least 4.5:1 for normal text, including error and status text, and at least 3:1 for large text, controls, focus indicators, and non-text status indicators.
23. WHERE Reduced_Motion_Preference is active, THE Pocket_Interface SHALL present state changes without decorative animation.
24. WHERE Reduced_Motion_Preference is inactive, THE Pocket_Interface SHALL complete each decorative state-transition animation within 200 milliseconds.
25. THE Pocket_Interface SHALL use the Money_Journal typography scale, spacing scale, color tokens, control shapes, card corner radius, dialog treatment, and status-feedback patterns used by the existing Check Pockets interface.

### Requirement 12: Migrate Legacy Pockets and Preserve Compatibility

**User Story:** As a household member, I want existing pockets and financial history preserved, so that Pocket Management can launch without losing prior data.

#### Acceptance Criteria

1. WHEN Migration_Process encounters a distinct Legacy_Pocket that can be mapped without ambiguity, THE Migration_Process SHALL create exactly one Active_Pocket with the existing Pocket_Name and Pocket_Emoji.
2. WHEN Migration_Process assigns a Pocket_Identifier to a Legacy_Pocket, THE Migration_Process SHALL derive the same Pocket_Identifier from the Legacy_Pocket Normalized_Pocket_Name regardless of source-record order or Migration_Process execution count.
3. WHEN a Legacy_Pocket has one or more saved cadence records and the chronologically latest Budget_Month contains exactly one Pocket_Cadence value, THE Migration_Process SHALL set Pocket_Cadence to that value.
4. IF the chronologically latest Budget_Month contains conflicting cadence values for the same Legacy_Pocket, THEN THE Migration_Process SHALL report every conflicting source record and omit migration changes for that Legacy_Pocket.
5. WHEN a Legacy_Pocket has no saved cadence record, THE Migration_Process SHALL set Pocket_Cadence to Monthly.
6. WHEN Migration_Process creates a Pocket_Definition from a Legacy_Pocket, THE Migration_Process SHALL set Default_Amount to zero.
7. WHEN Migration_Process encounters an existing monthly budget record, THE Migration_Process SHALL associate the record with the corresponding Pocket_Identifier and preserve Budget_Month, cadence, amount, creator identity, updater identity, creation timestamp, and update timestamp.
8. WHEN Migration_Process encounters an existing weekly budget record, THE Migration_Process SHALL associate each allocation with the corresponding Pocket_Identifier and Calendar_Week and preserve Budget_Month, cadence, amount, creator identity, updater identity, creation timestamp, and update timestamp.
9. WHEN Migration_Process encounters an existing single-pocket expense, THE Migration_Process SHALL associate the expense with the corresponding Pocket_Identifier and preserve amount, expense date, Budget_Month, payer, note, creator identity, updater identity, creation timestamp, and update timestamp.
10. WHEN Migration_Process encounters an existing split expense, THE Migration_Process SHALL associate each split-expense share with the corresponding Pocket_Identifier and preserve parent amount, share amounts, expense date, Budget_Month, payer, note, creator identity, updater identity, creation timestamp, and update timestamp.
11. WHEN Migration_Process encounters a Historical_Record, THE Migration_Process SHALL preserve Pocket_Name, Pocket_Emoji, Pocket_Cadence, allocation values, spending values, totals, and Budget_Month presentation.
12. WHEN Migration_Process runs more than once over unchanged source data, THE Migration_Process SHALL preserve the same Pocket_Identifiers and associations without creating duplicate Pocket_Definitions, Pocket_Assignments, allocations, or expense references.
13. IF Migration_Process cannot map a source pocket reference to exactly one Pocket_Definition, THEN THE Migration_Process SHALL report the source-record identifier and source pocket value and preserve the complete source record.
14. IF Migration_Process cannot map one source record, THEN THE Migration_Process SHALL continue migrating source records that have unambiguous mappings without changing the unmappable source record.
15. WHEN Pocket_Management_Feature is enabled after successful migration, THE Money_Journal SHALL use Pocket_Definitions and Pocket_Assignments for active pocket, budget, transaction, and reporting workflows without requiring the fixed pocket-name-to-emoji configuration.
16. WHEN the same historical budget, transaction, or report query is executed immediately before and after migration, THE Money_Journal SHALL return identical Pocket_Name, Pocket_Emoji, Pocket_Cadence, allocation, spending, remaining amount, percentage, and total values.
17. WHEN Pocket_Management_Feature is enabled after migration, THE Money_Journal SHALL return every pre-migration Historical_Record through the corresponding existing budget, transaction, and reporting view.
