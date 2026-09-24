## 2023-10-27 - Map optimization for nested dictionaries
**Learning:** In V8, standard object-based dictionaries `Object.create(null)` can introduce significant overhead during high-volume insertion/lookups inside hot loops due to string hash calculations and object property management.
**Action:** Use `new Map()` for dynamic dictionaries in data aggregation loops to achieve faster lookup/insertion, and use `Map.prototype.entries()` to bypass `Object.entries()` array allocations.
## 2023-10-27 - Array Reallocation GC Overhead
**Learning:** Using `.push()` on very large arrays (e.g., 500k elements) inside hot loops triggers continuous array resizing in V8, causing significant Garbage Collection overhead. Furthermore, creating intermediate wrapper objects (like `prev = { e, startTime, endTime }`) purely for loop state tracking also generates massive GC pressure.
**Action:** When the maximum bounds of an array are known, pre-allocate it (`new Array(maxLength)`), assign values via index tracking (`arr[idx++] = val`), and manually truncate it (`arr.length = idx`). Additionally, flatten short-lived loop wrapper objects into scalar variables.
