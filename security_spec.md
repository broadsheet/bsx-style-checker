# Security Specification for Broadsheet Copy-Editor DB & Data Protection

## 1. Enterprise Data Protection & AI Model Training Opt-Out Safeguards
- **Zero Third-Party AI Model Training**: All API transactions with Google GenAI models incorporate non-negotiable system directives (`[BROADSHEET DATA PRIVACY & ZERO THIRD-PARTY MODEL TRAINING DIRECTIVE]`) and enterprise HTTP headers (`X-Data-Privacy-Policy: Enterprise-Zero-Training`, `X-No-Data-Retention: true`). Under Broadsheet policy, proprietary articles, draft copy, style guides, and audit logs MUST NOT be cached, logged externally, or used for training or fine-tuning third-party foundation models under any circumstances.
- **Server-Side API Proxy Isolation**: All API keys, credentials, and third-party tokens reside exclusively on the server (`server.ts`). Client applications invoke `/api/*` endpoints; raw API keys are never exposed to browser context or client JavaScript runtime.
- **Automated PII & Credential Sanitizer Engine**: All incoming copy and payloads undergo server-side redaction (`redactSensitiveData`) prior to AI model execution and log storage. API tokens, secrets, auth headers, card numbers, and tax identifiers are automatically replaced with safe redaction placeholders.
- **Anti-Leakage Cache-Control HTTP Headers**: All `/api/*` responses enforce strict response headers (`Cache-Control: no-store, no-cache, must-revalidate`, `Pragma: no-cache`, `Permissions-Policy: interest-cohort=()`) to prevent CDN, ISP, or browser caching of confidential editorial text.
- **Live Safeguard Verification API**: The `/api/security/privacy-status` endpoint provides real-time verification of active privacy safeguards, proxy isolation, and opt-out directives.

## 2. Data Invariants
- A `crossCheckLog` must have a unique `id`.
- The `timestamp` must be a valid date-time string.
- Crucial comparison strings including `originalCopy`, `aiCorrected`, and `humanFinalized` must be non-empty strings.
- The `accuracyScore` must be a numeric integer between 0 and 100 inclusive.
- All requests are proxied securely via our backend which holds the system authority; however, direct Firestore access is restricted by zero-trust Firestore Security Rules.

## 3. Invalidation Test Cases ("Dirty Dozen" Threat Vectors)
1. **Third-Party Model Ingestion**: Attempting to log or send un-sanitized draft text to external model training pipelines. Blocked via Enterprise Zero-Training prompt directives, `X-No-Data-Retention` headers, and server-side proxying.
2. **Client-Side API Key Exposure**: Client attempting to extract Gemini API keys. Blocked by server-only key storage.
3. **Empty ID**: Creating log with no `id` field.
4. **Missing Timestamp**: Creating log with missing `timestamp`.
5. **Invalid Score Type**: Log with string `accuracyScore` instead of integer.
6. **Out of Bound Score**: Log with `accuracyScore = 150`.
7. **No Original Copy**: Log with missing or empty `originalCopy`.
8. **No AI Corrected Copy**: Log with missing `aiCorrected` copy.
9. **No Human Finalized Copy**: Log with missing `humanFinalized` copy.
10. **Shadow Field Injection**: Inserting field `isAdmin: true` into the log document.
11. **Mismatched Path ID**: Creating document under log path `/crosscheck_logs/differentId` where document's inner `id` is `someOtherId`.
12. **Tampering with Historic Logs**: Standard users trying to update a created log.

## 4. Security Rules
The security rules defined in `firestore.rules` strictly enforce schema constraints for database creation and prevent unsolicited direct client manipulation.
