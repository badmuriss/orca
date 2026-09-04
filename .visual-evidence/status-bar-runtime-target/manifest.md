# Status bar runtime target

Visual-Scope: AppRootSurfaces status bar | populated after clean remount | desktop,notebook | Electron is a desktop-only surface and supports both canonical wide profiles

Visual: status-bar-desktop | AppRootSurfaces status bar | desktop | 1920x1080 | populated after clean remount
Visual: status-bar-notebook | AppRootSurfaces status bar | notebook | 1366x768 | populated after clean remount

| Visual | File | SHA-256 | Review |
| --- | --- | --- | --- |
| status-bar-desktop | `desktop.png` | `2e1d27e6d5f6fe38c4573c3203d463d41008cc5c4135f95e0e979f24d811a5dc` | The full Electron surface renders without the status-bar error fallback. Canvas, sidebar, tab strip, and bottom edge remain aligned with no new clipping or overlap. |
| status-bar-notebook | `notebook.png` | `c5a8c53d5d35e52dc3a3a04e623df8440be3976d650287d2f09839427b1b4531` | The error fallback remains absent at notebook size and the application chrome retains its hierarchy without horizontal overflow. |

Reviewer: Codex vision review through Playwright CDP screenshots and image inspection.

The rendered status-bar element measured 24 CSS px after remount and exposed its provider, resource, session, and port controls. The prior error text was absent from the DOM.
