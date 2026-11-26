# Plan: Hallmark Minimalist Redesign

1. Rewrite `web/style.css` with locked `:root` tokens (warm alabaster paper, ink, hairline rules), `DESIGN.md` type scale, mobile responsiveness, and Hallmark critique stamp.
2. Refine `web/index.html` into a clean, single-column minimalist flow while preserving every `id` and `data-*` attribute used by `web/app.js`.
3. Verify all `getElementById` references in `web/app.js` exist in `web/index.html` and run `node --check`.
