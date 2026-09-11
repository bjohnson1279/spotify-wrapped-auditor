## 2024-05-24 - Avoid Max Call Stack and Optimize Sorting
**Learning:** `Array.prototype.push(...largeArray)` triggers a `RangeError: Maximum call stack size exceeded` for large datasets (e.g. 500k objects), which happens when loading raw Spotify exports. Also, parsing ISO 8601 timestamps into `Date` objects in a sort callback is highly inefficient.
**Action:** Use a `for` loop to push items to avoid call stack limits. Compare ISO 8601 string representations lexicographically for sorting instead of using `new Date().getTime()` to improve speed.
