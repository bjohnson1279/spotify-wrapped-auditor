## 2025-02-14 - Prototype Pollution via Untrusted Object Keys
**Vulnerability:** The application used standard JavaScript objects (`{}`) to aggregate statistics using untrusted string keys from Spotify data (track names and artist names). If a track or artist was maliciously named `__proto__` or `constructor`, it could overwrite built-in object properties or prototype methods.
**Learning:** Even internal data processing tools are susceptible to prototype pollution if external data is used directly as object keys without sanitization or safe object creation.
**Prevention:** Use `Object.create(null)` or `Map` when creating objects intended to be used purely as key-value stores or dictionaries with untrusted keys.

## 2025-10-24 - Uncaught Exceptions and Stack Trace Leaks on Malformed JSON
**Vulnerability:** Reading and parsing untrusted Spotify JSON exports directly without `try/catch` and structure validation. If a user provided a malformed JSON file or a non-array JSON structure, the application would crash and leak a full stack trace to the console.
**Learning:** File system read operations and JSON parsers must always be wrapped in `try/catch`. The type of the parsed data cannot be assumed to match the expected interface without validation.
**Prevention:** Wrap `JSON.parse` and file system reads in `try/catch`. Explicitly check data structures (e.g., `Array.isArray(parsed)`) and expected object properties before processing untrusted external files. Catch top-level errors and log secure messages without stack traces.
