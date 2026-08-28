# OCH-PAIRING visual evidence

Visual-Scope: Mobile pairing | stage-coded Metro or transport failure with retry dark | Android phone, Android tablet, web | Users must know which stage failed and how to recover without exposing pairing credentials.

Visual-Scope: Mobile pairing | successful host persistence and destination route dark | Android phone, web | Success evidence must prove the client leaves the scan route, not merely that desktop authenticated it.

## Captures

Visual: och-pairing-error-phone | Mobile pairing | Android phone | 390x664 | stage-coded Metro or transport failure with retry dark

- File: `och-pairing-error-phone.png`
- SHA-256: `14b96846fd63325a5571a2d759de3d292f8e27b2d8e8d434504adf4e5ef0ab9e`
- Grade: observed
- Capture: Android development build after the real 25-second transport timeout against an unreachable loopback endpoint.
- Vision review: The red timeout summary is fully visible, the bordered log remains within the viewport, monospaced stage rows wrap without horizontal overflow, and the primary retry and secondary home actions preserve a clear hierarchy. The oldest visible row is intentionally clipped by the bounded scroll region, while the failed stage and provider code remain readable.

Visual: och-pairing-error-tablet | Mobile pairing | Android tablet | 810x1080 | stage-coded Metro or transport failure with retry dark

- File: `och-pairing-error-tablet.png`
- SHA-256: `3e5933f1eba5c3a146973e0b9868c3a957027a44e84f8460ce29240d130dced0`
- Grade: observed
- Capture: The same real timeout state re-rendered at the declared Android tablet profile.
- Vision review: The diagnostic card expands across the wider canvas without excessive line lengths, clipping, or horizontal overflow. The timeout summary, failed stage, provider code, and actions remain centered and visually ordered, with ample separation from system navigation.

Visual: och-pairing-error-web | Mobile pairing | web | 381x840 | stage-coded persistence or navigation failure with retry dark

- File: `och-pairing-error-web.png`
- SHA-256: `a0513dafc80fb68001fdf5c31186a7f5d5445890388c1e662946a34d53d628fd`
- Grade: observed
- Capture: Live browser pairing with a capture-only fault injected at the route-commit boundary after transport, authentication, persistence, and cached-client refresh succeeded; the injection was removed immediately after capture.
- Vision review: The route failure summary, bounded log card, retry button, and home action fit without clipping or horizontal overflow. The monospace log keeps the preceding successful persistence and refresh stages visible beside the failed destination stage and redacted provider code, so authenticated desktop state cannot be mistaken for client completion.

Visual: och-pairing-success-phone | Mobile pairing destination | Android phone | 390x664 | successful persisted host after route commit dark

- File: `och-pairing-success-phone.png`
- SHA-256: `9b6ce676072d1fd8685d459505857360a5f47028080a3073ee39fe5a18321f36`
- Grade: observed
- Capture: Android development build after a live mock-host pairing completed persistence, client refresh, and route commit.
- Vision review: The session-view onboarding destination renders with no stale pairing overlay or loading state. Heading, explanatory copy, illustration, and actions are legible and vertically balanced, with no clipping or overflow at the phone profile.

Visual: och-pairing-success-web | Mobile pairing destination | web | 381x840 | successful persisted host after route commit dark

- File: `och-pairing-success-web.png`
- SHA-256: `4d1544214fd1fe733c515effa435e86bd1d148514c8db391972a07e409b919d6`
- Grade: observed
- Capture: Browser development build after a live mock-host pairing completed authentication, profile persistence, cached-client refresh, and route commit.
- Vision review: The destination state has no residual pairing diagnostics, and its heading, copy, illustration, and actions remain centered without clipping or horizontal overflow. The compact type scale and bottom actions retain clear hierarchy across the tall viewport.
