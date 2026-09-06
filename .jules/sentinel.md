## 2025-02-15 - Prototype Pollution in Artist Stats
**Vulnerability:** A malicious Spotify data export containing an artist named `__proto__` can pollute the global object prototype because `artistStats` is initialized as `{}` instead of `Object.create(null)`.
**Learning:** Using untrusted user data (like parsed JSON files from a third-party export) directly as keys in plain objects can lead to prototype pollution, which might break the application or lead to unexpected behavior in other parts of the code.
**Prevention:** Use `Object.create(null)` for dictionaries/maps built from user input, or use the `Map` object instead of a plain object.
