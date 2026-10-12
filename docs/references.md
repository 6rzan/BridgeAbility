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
> `csurf` package (see `CONVENTIONS.md`, "Deliberately rejected").

---

### Task 2 additions

**Amazon Web Services.** (n.d.). *Batch failure reporting for AWS Lambda with Amazon SQS.*
AWS Lambda Developer Guide.
https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html
(accessed 15 September 2026)

> Used in: [`services/notification/index.js`](../services/notification/index.js) — the
> `batchItemFailures` response shape and the `ReportBatchItemFailures` function response type
> set on the SQS event source mapping, so one malformed message in a batch does not force
> every message in that batch to be retried.

**Amazon Web Services.** (n.d.). *Amazon SNS dead-letter queues.* Amazon Simple Notification
Service Developer Guide.
https://docs.aws.amazon.com/sns/latest/dg/sns-dead-letter-queues.html
(accessed 15 September 2026)

> Used in: [`scripts/provision-ms1.sh`](../scripts/provision-ms1.sh) — the SQS queue's
> `RedrivePolicy` (`maxReceiveCount`, `deadLetterTargetArn`) and the queue access policy that
> lets the SNS topic deliver to it (SQS refuses messages from SNS with no policy at all).

**Amazon Web Services.** (n.d.). *Set up Lambda proxy integrations in API Gateway.*
Amazon API Gateway Developer Guide.
https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html
(accessed 15 September 2026)

> Used in: [`scripts/deploy-reports-lambda.sh`](../scripts/deploy-reports-lambda.sh) and
> [`scripts/deploy-timeline-lambda.sh`](../scripts/deploy-timeline-lambda.sh) — the
> `AWS_PROXY` integration type, under which API Gateway passes the whole request through and
> expects the Lambda's own `{statusCode, headers, body}` response shape back, with no separate
> request/response mapping template.

**Amazon Web Services.** (n.d.). *Burstable performance instances.* Amazon EC2 User Guide.
https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-performance-instances.html
(accessed 15 September 2026)

> Used in: [`docs/baselines/task2-build.md`](baselines/task2-build.md) — explains why a
> `t3.micro`'s `CPUCreditBalance` running low throttles the instance to baseline CPU, which is
> the root cause the Section 3 load test traced the gateway-call fallback behaviour to.
