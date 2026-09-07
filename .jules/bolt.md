## 2025-02-18 - Avoid Spread Operator on Large JSON Arrays
**Learning:** Using the spread operator (`...`) to push large arrays parsed from JSON (e.g., `rawEvents.push(...JSON.parse(raw))`) causes a `RangeError: Maximum call stack size exceeded` when processing hundreds of thousands of events.
**Action:** Use a `for...of` loop or `.concat()` instead of the spread operator when appending large datasets in Node.js.

## 2025-02-18 - Optimize Sorting for ISO 8601 Date Strings
**Learning:** Sorting massive arrays by parsing ISO date strings into Date objects (`new Date(ts).getTime()`) introduces a significant performance bottleneck due to the parsing overhead for every comparison.
**Action:** Since ISO 8601 strings maintain chronological order lexicographically, use direct string comparison (`a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0`) to sort date strings much faster.
