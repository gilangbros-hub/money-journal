'use strict';

function monthKey(value) {
    if (typeof value === 'string') return value;
    return `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}`;
}

function weeklyKey(value) {
    return `${value.pocket}:${monthKey(value)}:${value.isoWeekYear}-W${String(value.isoWeekNumber).padStart(2, '0')}`;
}

function monthlyKey(value) {
    return `${value.pocket}:${monthKey(value)}`;
}

function cloneState(state) {
    return {
        cadences: (state.cadences || []).map(entry => ({ ...entry })),
        monthlyAllocations: (state.monthlyAllocations || []).map(entry => ({ ...entry })),
        weeklyAllocations: (state.weeklyAllocations || []).map(entry => ({ ...entry }))
    };
}

function applyCadenceChange(state, command) {
    const next = cloneState(state);
    const key = monthlyKey(command);
    const existing = next.cadences.find(entry => monthlyKey(entry) === key);
    if (existing) existing.cadence = command.cadence;
    else next.cadences.push({ pocket: command.pocket, month: command.month, year: command.year, cadence: command.cadence });
    return next;
}

function applyMonthlyAllocation(state, command) {
    const next = cloneState(state);
    const key = monthlyKey(command);
    const existing = next.monthlyAllocations.find(entry => monthlyKey(entry) === key);
    if (existing) existing.budget = command.budget;
    else next.monthlyAllocations.push({ pocket: command.pocket, month: command.month, year: command.year, budget: command.budget });
    return next;
}

function applyWeeklyAllocation(state, command) {
    const next = cloneState(state);
    const key = weeklyKey(command);
    const existing = next.weeklyAllocations.find(entry => weeklyKey(entry) === key);
    if (existing) existing.budget = command.budget;
    else next.weeklyAllocations.push({ ...command });
    return next;
}

function activeAllocation(state, pocket, month) {
    const cadence = state.cadences.find(entry => monthlyKey(entry) === monthlyKey({ pocket, ...month }))?.cadence || 'Monthly';
    if (cadence === 'Weekly') {
        return state.weeklyAllocations
            .filter(entry => entry.pocket === pocket && monthKey(entry) === monthKey(month))
            .reduce((sum, entry) => sum + entry.budget, 0);
    }
    return state.monthlyAllocations.find(entry => monthlyKey(entry) === monthlyKey({ pocket, ...month }))?.budget || 0;
}

module.exports = { activeAllocation, applyCadenceChange, applyMonthlyAllocation, applyWeeklyAllocation, cloneState, monthlyKey, weeklyKey };
