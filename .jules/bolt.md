## 2023-10-27 - Map optimization for nested dictionaries
**Learning:** In V8, standard object-based dictionaries `Object.create(null)` can introduce significant overhead during high-volume insertion/lookups inside hot loops due to string hash calculations and object property management.
**Action:** Use `new Map()` for dynamic dictionaries in data aggregation loops to achieve faster lookup/insertion, and use `Map.prototype.entries()` to bypass `Object.entries()` array allocations.
## 2023-10-27 - Array pre-allocation optimization
**Learning:** To radically reduce garbage collection overhead and dynamic array resizing execution time in hot loops over massive datasets (e.g., 500k+ elements), avoid repeatedly pushing to arrays (`.push()`) when the maximum bounds are known; pre-allocate the array instead (e.g., `new Array(maxLength)`) and assign values via index tracking.
**Action:** Use pre-allocated arrays where the maximum length is known before iterating over large loops, reducing array resizing.
