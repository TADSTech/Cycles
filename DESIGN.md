# Cycles2 Design Guidelines

These 13 rules govern every screen, component, and platform port of Cycles2.

## Principles
1. **Use a small, consistent type scale.**
   - Page title: `24px`
   - Section title: `16px`
   - Card title / Body text: `14px`
   - Card text / Outer button text: `13px`
   - Card button text: `12px`
2. **Make card titles smaller than section titles.** (`14px` vs `16px`).
3. **Use `400` for body text and `400` or `500` for titles.** Never use `600`, `700`, or bold weights for headings or body.
4. **Straight titles. No italics.** (`font-style: normal` on all headings).
5. **Card text, 1 px smaller than similar text outside cards.** (`13px` inside cards vs `14px` outside).
6. **Button text, 1 px smaller than the surrounding text.** (`13px` outside cards, `12px` inside cards).
7. **The larger the font, the tighter the letter spacing.**
   - `24px`: `-0.03em`
   - `16px`: `-0.015em`
   - `14px`: `-0.005em`
   - `13px` / `12px`: `0`
8. **Tight line height on large titles.** (`1.12` on `24px`, `1.25` on `16px`, `1.5` on body copy).
9. **Leave breathing room between sections.** (`36px` / `2.25rem` minimum vertical gap between major sections).
10. **Balance titles that span multiple lines. No orphan words on the last line.** (`text-wrap: balance` on all headings and multi-line titles).
11. **Remove decorative labels, badges, and redundant buttons.** Every control must earn its space.
12. **One sans serif for body text and a single family for all titles.** (`system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`).
13. **Real, high-quality photos are better.** Avoid fake illustrations, decorative icons, or placeholder graphics.
