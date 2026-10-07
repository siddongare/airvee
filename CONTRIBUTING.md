# Contributing to Airvee

Thank you for your interest in contributing to **Airvee**! We are building a privacy-first overhead flight tracking radar that operates 100% locally.

---

## 🏛️ Architectural Commandments

Any proposed pull request must adhere strictly to these principles:

1. **Zero Remote Backend / Zero Cost**: Airvee must remain 100% free forever. No proprietary servers, no cloud databases, no telemetry scripts, and no API keys required from users.
2. **Local Sovereignty**: All state, logs, and sighting databases are persisted strictly on-device via `IndexedDB` and `chrome.storage.local`. Nothing leaves the browser except direct bounding box requests to open data providers.
3. **Mock Data Strict Isolation**: Any mock or synthetic flight data must NEVER leak into the user's permanent logs, stats, life list, or learned schedule predictions.
4. **Cockpit Minimal Aesthetic**: Airvee's design language follows Cockpit Minimal:
   - Pitch black (`#09090B`) and surface (`#111113`) background tokens
   - Signal Orange (`#FF5A1F`) accent
   - Hairline dividers (`rgba(255, 255, 255, 0.07)`)
   - Monospace tabular numerals (`Martian Mono` / `Geist Mono`)
   - Strict `prefers-reduced-motion` compliance across all animations.
5. **Rigorous Test Coverage**: Every feature, math formula, migration, or parsing enhancement must include unit tests in `tests/` that pass with zero external dependencies (`node --test`).

---

## 🛠️ Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/siddongare/airvee.git
   cd airvee
   ```

2. **Load into Google Chrome / Chromium**:
   - Navigate to `chrome://extensions/`
   - Enable **Developer mode** (toggle in top-right)
   - Click **Load unpacked**
   - Select the `airvee` repository directory

3. **Run Unit Tests & Syntax Verification**:
   The static wiring check runs in `npm run check`.
   ```bash
   npm test       # Run unit tests
   npm run check  # Validate wiring, syntax, and run test suite
   npm run ci     # Run full verification pipeline
   ```

---

## 🧪 Pull Request Guidelines

- Ensure `npm run ci` passes cleanly with zero errors before submitting.
- Write descriptive commit messages following [Conventional Commits](https://www.conventionalcommits.org/):
  - `feat(radar): add heading-up rotation mode`
  - `fix(log): prevent distance wrap on small viewports`
  - `test(watchlist): verify cargo filter edge cases`
- Open PRs against the `main` branch.
