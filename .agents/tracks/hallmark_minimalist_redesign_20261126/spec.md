# Spec: Hallmark Minimalist Redesign (`hallmark_minimalist_redesign_20261126`)

## Goal
Redesign `web/style.css` and `web/index.html` in an austere, hairline-ruled minimalist style under `DESIGN.md` and Hallmark's disciplines, preserving 100% of existing JS functionality and element IDs.

## Requirements
- **Locked Tokens**: All colors and font-families defined in `:root` and referenced via `var(--...)`.
- **`DESIGN.md` Compliance**: `24px` page title, `16px` section titles, `14px` card titles & outer body, `13px` card text & outer buttons, `12px` card buttons, `400`/`500` weights, straight titles, `text-wrap: balance`, generous section spacing.
- **Mobile Safe**: `overflow-x: clip` on `html, body`, `white-space: nowrap` on buttons, `minmax(0, 1fr)` on grids, responsive at 320px–768px+.
- **Pre-emit Critique**: Stamp Hallmark critique comment at top of `web/style.css`.
