# Token specification (Week 9)

Single source: `web/src/index.css`. This document explains what's already
there, what was added this week, and what's explicitly deferred - it does
not define tokens that don't exist in the CSS, so it can't drift from it.

## Color

CSS custom properties in OKLCH, defined once in `:root` and overridden in
`.dark` - `--background`, `--foreground`, `--card`, `--popover`,
`--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`,
`--success`, `--warning`, `--border`, `--input`, `--ring`, `--chart-1`
through `--chart-5`, `--sidebar*`. Consumed via Tailwind v4's `@theme
inline` block, which maps every `--color-*` Tailwind utility
(`bg-primary`, `text-muted-foreground`, etc.) straight to the matching CSS
variable - there is no second color palette anywhere in `web/`.
`lib/workspace.js`'s `statusBadgeVariant()` and the `metric-icon-*` classes
are the two places semantic-color mapping happens (status -> variant,
KPI tone -> icon color); both already route through these tokens, not
hard-coded hex values.

## Typography

No custom type-scale tokens - Tailwind v4's default scale (`text-xs`
through `text-4xl`) plus `font-family: Inter, 'Segoe UI', sans-serif` set
once on `body` in `index.css`. Documented here as the canonical scale
rather than introducing a parallel one: every new shared component should
use Tailwind's default text-size utilities, not a custom `--font-size-*`
token set, since the app has never needed more than that scale provides.

## Spacing

Tailwind v4's default spacing scale (the `p-*`/`gap-*`/`m-*` utilities),
used consistently throughout `web/src/components/`. No custom spacing
tokens exist or are added this week - same reasoning as typography.

## Radius

`--radius: 0.65rem` in `:root`, with `--radius-sm/md/lg/xl` derived from it
in the `@theme inline` block (`calc(var(--radius) - 4px)` etc.) - one base
value controls every rounded-corner size in the app.

## Elevation

Tailwind's built-in `shadow-sm`/`shadow-md`/`shadow-lg`/`shadow-xl`
utilities are the elevation system - `Card` uses `shadow-sm`,
`WorkspaceChrome`'s sidebar and header use `shadow-sm`/`shadow-primary/25`
for accent glows. No new elevation tokens were added: Tailwind's shadow
scale already is the one system, it just wasn't written down as a decision
before now.

## Focus (new this week)

Added to `index.css`:
```css
--focus-ring-width: 2px;
--focus-ring-offset: 2px;
--focus-ring-color: var(--ring);
```
applied globally via:
```css
:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}
```
This is a real gap closed, not just documented: before this week there was
`--ring` (a color token, used for Radix's own focus rings on components
that supported it) but no single, explicit `:focus-visible` contract
applied at the base layer - individual components could vary in ring width
or omit one from a native HTML element outside a styled component wrapper.
Every new shared component (feedback states, and whatever comes next in
the catalog) relies on this one rule rather than its own outline style;
`feedback-states.test.jsx` and `Workspace.test.jsx` assert real elements
are keyboard-focusable, which exercises this path.

## Density (new this week, defined but not adopted)

```css
--density-scale: 1;
--density-scale-compact: 0.85;
```
Defined so a future compact-density mode has a single multiplier to key
off, but **nothing reads `--density-scale` yet** - no component switches
on it, there is no density toggle in the UI. Recorded here as "defined, not
adopted" rather than silently wired into a few components and not others,
which would be a worse state than not having it yet. Adopting it (e.g., a
Warehouse Picker's tablet view wanting a denser `SmartDataTable`) is
page-rebuild-phase work once the component catalog exists to apply it to.

## Responsive breakpoints

Tailwind v4 defaults: `sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px,
`2xl` 1536px. Already used throughout (`WorkspaceChrome.jsx`'s
`lg:flex`/`lg:hidden` split between the desktop sidebar and the mobile
sheet-based nav is the primary example). No custom breakpoints exist or
are added.

## `web/` vs `admin-panel/` (explicitly not consolidated this week)

`admin-panel/` is a separate deployable with its own build and, per this
week's research, no evidence of importing `web/src/index.css` or sharing
its OKLCH token set. Guide scope says "consolidate one token source... 
across web/admin" - not done this week: the two apps would need either a
shared package (a real structural change - new workspace/package
boundary) or a copy-and-sync approach (a maintenance burden the guide's
own "one token source" goal is trying to avoid). Recorded as backlog for
whichever week does the actual `admin-panel` UI work, rather than a
partial sync now that would need redoing.
