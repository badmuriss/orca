# Mobile Maestro two-dimensional pan

Visual-Scope: MobileMaestroBoard | populated before pan | tablet,mobile | The native mobile client supports both phone and tablet responsive layouts
Visual-Scope: MobileMaestroBoard | populated after diagonal pan | tablet,mobile | The pan interaction must update both axes on every supported native layout

Visual: mobile-maestro-mobile-fitted | MobileMaestroBoard | mobile | 390x664 | populated before pan
Visual: mobile-maestro-mobile-diagonal | MobileMaestroBoard | mobile | 390x664 | populated after diagonal pan
Visual: mobile-maestro-tablet-before | MobileMaestroBoard | tablet | 810x1080 | populated before pan
Visual: mobile-maestro-tablet-diagonal | MobileMaestroBoard | tablet | 810x1080 | populated after diagonal pan

| Visual | File | SHA-256 | Review |
| --- | --- | --- | --- |
| mobile-maestro-mobile-fitted | `mobile-fitted.png` | `1449a83faa22bc8249a98713b471babc7b5772b49b7e411fee61dc0d326d69b9` | The terminal card is visible inside the phone canvas before interaction; toolbar, progress panel, grid, and card remain readable without lateral overflow. |
| mobile-maestro-mobile-diagonal | `mobile-diagonal-pan.png` | `3bd8557a8504b420b3c0d6f7226021b80ca60dc6f62d58699ff303db5942e810` | One diagonal swipe moves the card and grid left and upward together, confirming simultaneous X/Y motion without freezing either axis. |
| mobile-maestro-tablet-before | `tablet-before-pan.png` | `6b513537300b91d93638351638e41e2bd9eb9b78a0a1c88abf2c7d6474af0789` | The tablet split layout contains the Canvas between workspace navigation and Run progress; content is clipped only at the Canvas viewport boundary as expected. |
| mobile-maestro-tablet-diagonal | `tablet-diagonal-pan.png` | `5259f788ef16f95e40482e3e8570c3fa3057a4b92b9a862c67be93268ee27ad2` | The same gesture shifts the tablet card left and upward while both surrounding panels remain fixed and readable. |

Reviewer: Codex vision review from Android emulator screenshots and image inspection.
