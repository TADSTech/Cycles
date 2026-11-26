# Spec: Design System & Redesign (`design_system_redesign_20261126`)

## Goal
Codify the 13 design principles in `DESIGN.md` and apply them across `web/style.css`, `web/index.html`, and `web/app.js` without breaking any existing transfer functionality.

## Acceptance Criteria
- `DESIGN.md` exists at repo root with all 13 guidelines and concrete CSS token values.
- `web/style.css` enforces the exact type scale (`24px` page title, `16px` section title, `14px` card title & body text, `13px` card text & outer buttons, `12px` card buttons), weights (`400` body, `400`/`500` titles), straight titles, `text-wrap: balance`, tight letter-spacing & line-height on large titles, and generous section spacing.
- Decorative pills, status chip bars, and redundant buttons are removed from `web/index.html` and `web/app.js`.
