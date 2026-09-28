## 2023-10-27 - Map optimization for nested dictionaries
**Learning:** In V8, standard object-based dictionaries `Object.create(null)` can introduce significant overhead during high-volume insertion/lookups inside hot loops due to string hash calculations and object property management.
**Action:** Use `new Map()` for dynamic dictionaries in data aggregation loops to achieve faster lookup/insertion, and use `Map.prototype.entries()` to bypass `Object.entries()` array allocations.
## 2023-10-27 - Fast array generation from loops
**Learning:** Using `Array.push()` inside hot loops to populate large arrays (e.g. 500k+ elements) introduces massive dynamic array resizing overhead and garbage collection in Node V8.
**Action:** Decouple object/array mapping and generation by instead initializing a full `new Array(len)` when length bounds are known and managing the index natively by assigning items via `arr[idx++] = val` and then truncating the final array length `arr.length = validCount`.
