## 2023-10-27 - Map optimization for nested dictionaries
**Learning:** In V8, standard object-based dictionaries `Object.create(null)` can introduce significant overhead during high-volume insertion/lookups inside hot loops due to string hash calculations and object property management.
**Action:** Use `new Map()` for dynamic dictionaries in data aggregation loops to achieve faster lookup/insertion, and use `Map.prototype.entries()` to bypass `Object.entries()` array allocations.
