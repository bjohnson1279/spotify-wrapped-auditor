## 2023-10-27 - Map optimization for nested dictionaries
**Learning:** In V8, standard object-based dictionaries `Object.create(null)` can introduce significant overhead during high-volume insertion/lookups inside hot loops due to string hash calculations and object property management.
**Action:** Use `new Map()` for dynamic dictionaries in data aggregation loops to achieve faster lookup/insertion, and use `Map.prototype.entries()` to bypass `Object.entries()` array allocations.

## 2023-10-27 - Object Allocation in Deduplication Loops
**Learning:** Repeatedly creating wrapper objects (e.g., `{ e, startTime, endTime }`) and pushing to dynamically resizing arrays inside a hot processing loop across 500,000+ elements creates measurable garbage collection spikes and CPU overhead.
**Action:** Pre-allocate maximum bounds arrays (`new Array(length)`) tracking with a count index, and destructure ephemeral wrapper objects into flat scalar variables in the outer loop scope.
