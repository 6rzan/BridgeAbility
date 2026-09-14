# References

Every third-party snippet or tutorial pattern used in this codebase is cited inline, at the
point it is used, with the URL and the date it was checked. This file is the index of those
citations, so the acknowledgement required by the module's plagiarism policy exists in one
place as well as at the point of use. Nothing here is quoted at length; each pattern was
read, understood and re-implemented for this project's own key design and constraints.

APA 7th edition.

---

**Amazon Web Services.** (n.d.). *Time to Live: How it works.* AWS DynamoDB Developer Guide.
https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/howitworks-ttl.html
(accessed 16 August 2026)

> Used in: [`src/data/dynamo/sessionStore.js`](../src/data/dynamo/sessionStore.js) — the
> `isExpired` check. AWS documents TTL deletion as happening "typically" within a few days of
> the expiry time, not at it, which is why the session store enforces expiry itself in code
> rather than trusting an expired item to already be gone.

**Expressjs.** (n.d.). *express-session: Session Store Implementation* [README section].
GitHub. https://github.com/expressjs/session#session-store-implementation
(accessed 16 August 2026)

> Used in: [`src/data/dynamo/sessionStore.js`](../src/data/dynamo/sessionStore.js) — the
> `DynamoSessionStore` class implements the `get`/`set`/`touch`/`destroy` contract this
> document specifies for a custom `express-session` store.

**Grassi, P. A., Fenton, J. L., Newton, E. M., Perlner, R. A., Regenscheid, A. R., Burr, W. E.,
Richer, J. P., Lefkovitz, N. B., Danker, J. M., Choong, Y.-Y., Greene, K. K., & Theofanos,
M. F.** (2017). *Digital identity guidelines: Authentication and lifecycle management*
(NIST Special Publication 800-63B). National Institute of Standards and Technology.
https://pages.nist.gov/800-63-3/sp800-63b.html
(accessed 16 August 2026)

> Used in: [`src/validation/authSchemas.js`](../src/validation/authSchemas.js) — the password
> policy. Section 5.1.1.2 recommends a minimum length with no mandatory character-class
> composition rules, which is why the registration schema enforces a 12-character floor and a
> 128-character ceiling (to bound bcrypt cost) and nothing else.

**OWASP Foundation.** (n.d.). *Cross-Site Request Forgery Prevention Cheat Sheet.*
OWASP Cheat Sheet Series.
https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
(accessed 16 August 2026)

> Used in: [`src/middleware/csrf.js`](../src/middleware/csrf.js) — the hand-rolled
> double-submit CSRF token, implementing the sheet's "Naive Double-Submit Cookie" pattern
> hardened with an `HttpOnly` cookie and a server-rendered token, in place of the deprecated
> `csurf` package (see `CLAUDE.md`, "Deliberately rejected").
