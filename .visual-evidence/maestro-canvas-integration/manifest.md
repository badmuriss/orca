# Maestro canvas integration

Visual-Scope: MaestroWorkspaceCanvas | populated with Harness panel expanded | desktop,notebook | Electron desktop-only surface
Visual-Scope: MaestroWorkspaceCanvas | populated with Harness panel compact | desktop,notebook | Electron desktop-only surface

Visual: maestro-canvas-desktop-expanded | MaestroWorkspaceCanvas | desktop | 1920x1080 | populated, Harness expanded
Visual: maestro-canvas-desktop-compact | MaestroWorkspaceCanvas | desktop | 1920x1080 | populated, Harness compact
Visual: maestro-canvas-notebook-expanded | MaestroWorkspaceCanvas | notebook | 1366x768 | populated, Harness expanded
Visual: maestro-canvas-notebook-compact | MaestroWorkspaceCanvas | notebook | 1366x768 | populated, Harness compact

| Visual | File | SHA-256 | Review |
| --- | --- | --- | --- |
| maestro-canvas-desktop-expanded | `desktop-expanded.png` | `a0ef95aa5be428f4a7aca20ec2dbf10f9557386383bdf1be29f0f597c0df0886` | Panel begins about 15 px below the canvas top, stays clear of the tab strip and sidebar, and has no clipping or horizontal overflow. A restored terminal card is visible immediately after opening Maestro. |
| maestro-canvas-desktop-compact | `desktop-compact.png` | `1e68b3ab13a830c8126f629d491a14501b857bb6f895bd7c0fd11b143e9d5e3b` | Compact controls remain legible and aligned without overlapping the canvas card or application chrome. |
| maestro-canvas-notebook-expanded | `notebook-expanded.png` | `c4de97ced93bcbd6cb6ba435b23069ee6a104c5b506991f9b23153fcbd8e8d65` | Expanded content remains contained at the supported notebook size, with an internal scrollbar and no lateral clipping. |
| maestro-canvas-notebook-compact | `notebook-compact.png` | `9f754d63a1e6f72e879204494794e6ed121bd741df3955a32fa18c88cb9777c4` | Compact state preserves spacing, hierarchy, and readable status text at notebook size. |

Reviewer: Codex vision review through Playwright CDP screenshots and image inspection.

The bottom status bar displays an unrelated existing error in every capture. It does not overlap the changed Maestro surface and is recorded here rather than treated as part of this change.
