# geosketch — design

A free, web-based replacement for Geometer's Sketchpad (几何画板).
Resolved through a design interview on 2026-09-17. Every decision below was made
explicitly; rationale is kept so future contributors (human or agent) can tell
deliberate choices from accidents.

---

## 1. Positioning

- **Primary use (now):** teachers digitize quiz figures — they reconstruct a
  printed figure as a *dynamic* sketch, save a `.geosketch` file, and open it on
  the classroom whiteboard (a Windows touch panel) where the construction can be
  dragged, animated, measured, live.
- **Secondary use (later):** students construct/draw on their own devices.
- **Why not GeoGebra:** positioning is GSP-style constructive semantics
  (objects are *defined by* parents, never by position) fronted by a modern,
  touch-first UI; notation-first (congruence ticks, angle arcs, right-angle
  squares, parallel arrows — things GSP never had as first-class objects);
  free, zero-install, offline-capable, hosted on GitHub Pages; open source (MIT).
- **Explicit non-goals for v1:** exact/verified arithmetic (Cinderella-style
  theorem-proving), constraint solver, 3D, accounts/cloud/collaboration,
  `.gsp` import (see M3), loci, custom tools, iteration/fractals, conics.

## 2. Decision log

| # | Decision | Choice |
|---|---|---|
| D1 | Audience | Teachers digitizing quiz figures (primary); students (eventually) |
| D2 | Artifact | `.geosketch` file, human-readable versioned JSON; the file is the product |
| D3 | Platform | Web app; runs whiteboard browser / Windows / macOS / student devices |
| D4 | Stack | TypeScript (strict) + Vite + Canvas 2D; **no UI framework** |
| D5 | Hosting | Public repo, MIT, GitHub Pages; offline-capable PWA |
| D6 | Interaction | Fresh design: **selection-first + contextual actions** (no mode palette) |
| D7 | Assist layer | Freehand "auto-geometrize" — post-v1 assist, never the core |
| D8 | Semantics | Dynamic geometry DAG: objects defined by parents; dragging recomputes |
| D9 | Degeneracy | Undefined ⇒ hidden + "undefined" indicator chip (tap to explain); auto-return; branch-continuity preserved |
| D10 | Lifecycle | Cascade delete **with preview**; explicit **Detach** (freeze a dependent at current geometry) |
| D11 | Files | Save/open `.geosketch`; export SVG + PNG; browser Print→PDF; autosave/crash recovery |
| D12 | `.gsp` import | Deferred to **M3**; try JavaSketchpad-export route first; model stays an open type registry |
| D13 | v1 scope | Core constructions, notation & styling, measurements, calculations, parameters/sliders, coordinate plane + functions, transformations, animation + trace |
| D14 | Deferred | Loci, custom tools, iteration, conics, freehand assist, student mode |
| D15 | Gate | Exam figures G1–G5 below must be buildable from scratch in ≤10 min each and survive a seeded drag-storm |
| D16 | Naming | `geosketch` now; Chinese display name later |
| D17 | Static vs dynamic | **Working premise: dynamic.** The sketch is a drag-explorable construction (GSP's whole value); a static picture is the *export* path of the same document. If "digital copy" was meant as static-only, that is a scope reduction the user must say explicitly — it would cut engine budget ~10× |
| D18 | Units & scale | World unit is abstract; the optional coordinate system's draggable unit point sets screen scale. **Stated numbers (`AB=4`) are text annotations by default; enforced numbers (`AC+BD=12`) are built with number parameters driving construction geometry.** Measurements display in world units with configurable suffix/precision |

## 3. v1 feature scope

**Construction core.** Free points; point-on-object (parameterized); segments,
lines, rays, vectors; circles (center+point, **center+radius-from-measurement**);
polygons + interiors; intersections (line/circle/segment families) with branch
continuity; midpoints; perpendiculars; parallels; angle bisectors; perpendicular
bisectors; arc objects. Coordinates: single optional coordinate system per sketch
(axes + grid + draggable unit point), math coords (y-up) vs screen transform.

**Notation & styling.** Tick marks (grouped — n ticks per congruence class),
angle arcs (grouped), right-angle squares, parallel arrows; stroke
color/width/dash; point fill/hollow/size; labels (A, B, C…) with font size/color
and draggable label offsets; free text annotation; measurement-aware labels.

**Measurements as objects.** Length, distance, angle (degrees default), area
(polygon/circle), ratio, slope, coordinates, arc length; auto-updating;
configurable precision and units. Measurements are **first-class numeric
objects**: they can be displayed *and* fed into constructions (circle radius,
rotation angle, translation distance, dilation ratio) and into calculations.

**Calculations & parameters.** Expression objects over measurements/numbers
(`12 − AC`, `½·AC·BD`, `sqrt`, `sin/cos/tan`, `abs`, comparisons); free number
parameters with slider UI, usable as lengths/angles/scales.

**Transformations.** Translate, rotate (by fixed angle or angle measurement,
signed), reflect (line/point), dilate (ratio) — all as dependent constructions.

**Coordinate plane + functions.** Plot `y = f(x)` over the visible domain using
the shared expression parser; parameters usable in `f`.

**Animation + trace.** Animate a point along its path (speed/direction, play
/pause); trace leaves a persistent, clearable trail of an object's past
positions. (Loci — exact swept curves — deferred.)

**Units, scale, absolute sizes.** Geometry is stored in abstract world units.
A sketch may carry a coordinate system whose unit point (draggable) maps world
units to screen scale. Measurement readouts show world-unit values with a
configurable suffix (default none / `单位`) and precision. A stated length from
the problem text is treated as text annotation unless the teacher wants it
enforced — enforcement is built with a number parameter driving the geometry
(e.g. `t` drives `|AC|`, or a "length" parameter drives a segment). This keeps
ratio-correct scale-free figures working (most quiz figures) while allowing
absolute-size sketches when a problem's logic needs it.

**Trust surface.** Undefined-object chip (D9); dependency inspector ("defined as:
midpoint of A and B", with parents highlighted); cascade-delete preview (D10);
Detach; full undo/redo (snapshot-based; bounded history) and redo of everything,
including cascades; crash-recovery autosave.

**Touch & whiteboard.** Pointer-events unified (touch/pen/mouse); hit tolerance
scaled for finger (~10 px) vs mouse (~6 px) and by DPR; pinch zoom + two-finger
pan; no affordance that requires hover; **present mode** hides chrome and
enlarges targets.

**Opening a sketch on the whiteboard (reality check).** A browser tab can be
handed a file three ways: in-app **Open** (File System Access API on
Chromium — the board's Edge/Chrome), **drag-drop** onto the tab, or the
`<input type=file>` fallback (Safari/Firefox/old embedded browsers).
**Double-clicking a `.geosketch` file in the OS is not reliably available to
web apps** (the File Handling API is Chromium-only and may be absent on
embedded board browsers; Safari/Firefox have nothing). The only guaranteed
double-click path is a desktop wrapper (Tauri, deferred). The board may also be
offline or run an older embedded browser — **M0 verifies on the actual board**
and records browser/version, offline behavior, and File System Access support.

## 4. Gate figures (v1 acceptance)

Constructed *from scratch* in the app; each survives a seeded random drag-storm
with invariants holding within epsilon and no crashes/NaNs. Invariants are the
test oracle (see §7). G1–G3 are real exam items supplied by the user; G4–G5 are
canonical stand-ins (to be replaced by real notation-dense and graph items from
the same collections).

### G1 — 2022 硚口 (rotation, min-value)
> 正方形 ABCD 中，AB=4，H∈AB，F∈CD，BH=DF；将 HF 绕 F 顺时针旋转 90° 得 MF；连 AM，求 AM 最小值。

Recipe: square ABCD (4 segments + interior) → `H` point-on-object AB → measure
`BH` → circle(D, |BH|) ∩ segment CD = `F` (branch-continuous) → `M` = rotate(H
about F, −90°) → segments HF, FM, AM → labels → text annotation of the problem.
Invariants: `F ∈ CD`; `|DF| = |BH|`; `∠HFM = 90°`; `|FM| = |FH|`. Degeneracy
drill: at `H→B`, `|BH| → 0`, circle collapses ⇒ `F`, `M` undefined ⇒ chip
appears, everything recovers on drag-away. Pedagogy: animate H + trace M — the
trail is the line whose distance from A is the minimum (this is the figure that
earns animation+trace its place in v1).

### G2 — 2022 二中 (perpendicular diagonals, max area)
> 四边形 ABCD 的对角线 AC⊥BD，AC+BD=12，求面积最大时的 AC，BD。

Recipe — **lengths anchored to O, the diagonal intersection**, so the invariant
holds for *every* legal drag: free point `O`; line ℓ₁ through O with a free
direction point; ℓ₂ ⊥ ℓ₁ through O; parameter `t` (slider 0…12, default 6);
`A` and `C` = the two intersections of circle(O, t/2) with ℓ₁, branch hints
forcing **opposite sides**; `B` and `D` = the two intersections of
circle(O, (12−t)/2) with ℓ₂, opposite sides; polygon ABCD; measurements `|AC|`,
`|BD|`, area readout.
Invariants: `|AC| = t`; `|BD| = 12 − t`; `AC ⊥ BD`; **`O` strictly interior to
both diagonals** (betweenness ⇒ convexity ⇒ the measured area legitimately
equals `½·|AC|·|BD|·sin θ`); area max 18 at `t = 6`. Slider endpoints (t→0,
t→12) exercise the radius-0 circle degeneracy ⇒ undefined chip ⇒ recovery.

### G3 — 2022 江岸 (60° diagonals, max area)
> 对角线所成锐角为 60°，AC+BD=10，求面积最大值。

Same O-anchored recipe with ℓ₂ = rotate(ℓ₁, 60°) about O and sum 10.
Invariants: acute `angle(AC, BD) = 60°`; `|AC| = t`; `|BD| = 10 − t`; `O`
interior to both diagonals as in G2; `area = ½·t·(10−t)·sin 60°`, max `25√3/4`
at `t = 5`.

### G4 — notation-dense (canonical stand-in)
A 全等/相似-style figure exercising the whole notation layer: two triangles with
one- and two-tick congruence groups on the correct sides, angle arcs in two
groups, one right-angle square, parallel arrows on a trapezoid base, one dashed
auxiliary segment, vertex labels, and a measurement-aware label. Pass =
grouping survives edit/drag (each tick group counts independently), marks move
with their host objects, notation is exported intact to SVG.

### G5 — function graph (canonical stand-in)
Parabola `y = x² − 2x − 3` on axes with marked x-intercepts and labeled vertex;
second item: `y = k/x` with slider parameter `k` (drag slider → curve re-plots
live). Pass = domain handling over the visible viewport, parameter-driven
re-plot, label/measurement binding (intercept coordinates), SVG export with
labels.

## 5. Architecture

```
src/
  engine/      pure TS, no DOM — the whole of dynamic geometry
    kernel/    vector math, epsilons, root-continuity, projection on paths
    objects/   type registry: one module per object type (compute + metadata)
    doc.ts     document = { version, viewport, axes?, objects[] }; edits & undo
    actions.ts action registry: actionsFor(selection) -> Action[]
  render/      canvas renderer (interactive) + SVG serializer (export), both
               consume the same computed scene / draw list
  interaction/ pointer sessions, hit-testing, selection model, drag sessions,
               animation clock, trace buffers
  ui/          toolbar, contextual action bar, property sheet, dialogs,
               undefined-chip, present mode  (vanilla DOM)
  io/          schema v1 (zod-free, hand-rolled validation), save/open,
               autosave, import/export, File System Access + fallbacks
  app/         store, command wiring, keyboard shortcuts, PWA/service worker
```

**Contracts (frozen for parallel work):**

```ts
type Id = string;
interface ObjRecord { id: Id; type: string; parents: Id[]; params: Json;
                      style: Style; label?: LabelSpec; }
interface Doc { version: 1; viewport: Viewport; axes?: ObjRecord; objects: ObjRecord[] }

// object type registry
interface ObjType {
  name: string;                       // "midpoint", "circle.centerRadius", ...
  parentTypes: string[][];            // valid parent type signatures
  compute(parents: Geometry[], params: Json, env: Env): Geometry | UNDEFINED;
  // UNDEFINED carries a reason string for the chip ("radius = 0", "parallel lines")
}

// computed scene (renderer + hit-test input)
interface Scene { geoms: Map<Id, Geometry>; undefined: Map<Id, string> }

// action registry (drives the selection-first UI)
interface Action { id: string; title: string; icon: string;
                   apply(doc: Doc, selection: Id[], at?: WorldPoint): Edit }
function actionsFor(doc: Doc, selection: Id[]): Action[]
```

**Schema breadth (a `.gsp`-import constraint, decided now).** The type registry
is open and the schema **reserves namespaces for GSP's full vocabulary** —
loci, iteration, custom-tool instances, conics, arcs/interiors, animation
tracks, sliders — even though v1's UI cannot create them. Unknown types
round-trip losslessly and render as "unsupported object" placeholders instead of
being dropped. This is what keeps M3's importer from forcing a schema migration:
deferring *features* is fine; an unrepresentable *document model* is not.

**Engine rules.**
- Recompute is topological over the dirty subgraph; nothing else moves.
- Intersections store a branch hint; on recompute pick the root *nearest the
  previous solution* (continuity through tangency).
- Point-on-object stores a path parameter (ratio for segments, angle for
  circles); the parameter is re-projected, never reset.
- Numeric model: float64 with **relative** epsilons (`1e-9 · scale`); predicates
  phrased as relative quantities (no absolute `==`). Exact arithmetic is
  consciously rejected (cost ≫ benefit for quiz-figure use).
- Undefined ⇒ object and all dependents hidden; chip counts them; reason
  surfaces on tap; auto-return to defined is silent.
- Delete = cascade (preview lists every removed dependent); Detach = keep
  geometry, drop parents (object becomes free). Undo is document-snapshot based
  and restores a cascade atomically.
- Animation = advance path parameters on `requestAnimationFrame`; trace =
  bounded ring buffer of past geometries per traced object.

### 5.1 Frozen implementation contract (M1)

Geometry kinds: `point | segment | line | ray | circle | polygon | number`
(`number` carries `{value, unit?: 'deg'}`; measured numbers are first-class objects
that constructions consume — e.g. `circle.centerRadius` takes `[point, number]`).

Path parameterisation (used by `point.onObject` and intersection root ordering):
segment `P(t) = a + t(b − a)`, t ∈ [0,1]; line/ray `P(t) = at + t·dir` (unit dir,
ray t ≥ 0); circle `P(t) = center + r(cos t, sin t)`. Stored `t` is never clamped by
`compute` (proportions survive parent motion); interaction clamps while dragging via
`projectPoint`. `scene.ts` exports `evalPath`, `projectPoint`, `anchorsOf`,
`isPathGeometry`, `unitDirection`, `magnitude`.

Registry: `ObjType {name, title, parentKinds, compute}`, `GeometryKind = kind | 'path' | 'any'`,
`kindMatches()`. `title` is the Chinese UI label; registered types (name → title):
segment 线段, line 直线, ray 射线, circle.centerPoint 圆, circle.centerRadius 圆(圆心+半径),
polygon 多边形 (variadic, ≥3 points), point.onObject 对象上的点, intersection 交点,
midpoint 中点, perpendicular 垂线, parallel 平行线, angleBisector 角平分线 (vertex = middle
parent), measure.distance 距离, measure.angle 角度, measure.area 面积.

Actions (`engine/actions.ts`): `actionsFor(doc, scene, selection)` — **strict arity**
(selection length === signature length; a `[A,B,C]` selection never silently builds a
segment from two of them); the single exception is the variadic polygon. Selection
order is click order. `Action.apply()` returns `{created, select}`; the UI applies it
through `store.edit` (one undo entry), and the created objects become the selection
so constructions chain.

Selection semantics (touch-first): tap empty space creates a free point **and appends
it to the selection** (three taps + one button = triangle); tap an object toggles it in
the selection; drag selects and moves (free points by `{x,y}`, glued points by
re-projecting `{t}`); non-path objects are selectable but not draggable; ✕ / Escape
clears. `Delete` deletes with cascade **preview** (D10); `Detach` freezes a dependent
point as `point.free` at its current position.

Undefined objects (D9) are unhittable, hide with their dependents, and are listed by
the chip with their reason (`无交点`, `两直线平行`, `半径为零`, `退化`, `圆没有平行线`, …).

Number readouts render at the parents' average anchor + `label.dx/dy` (default (0,−14)),
formatted `text = value` with `unit === 'deg'` ⇒ `value.toFixed(1)°` else `toFixed(2)`;
they are hit-testable via `hitTest(scene, world, tol, anchorsOf(doc, scene))` — the
store's `pick` passes that map.

## 6. Files & IO

- `.geosketch` = UTF-8 JSON, `version` field; unknown fields and unknown object
  types are **preserved on round-trip** (forward compatibility contract).
- Save/open: File System Access API where available (Edge/Chrome — i.e. the
  whiteboard), fallback `<a download>` + `<input type=file>` (Safari/Firefox),
  and drag-drop anywhere; autosave into local storage (crash recovery prompt
  on next load).
- Export: SVG (primary vector path for Word/WPS/print; labels as `<text>` with
  font-family), PNG (1×/2×/4×, optional transparent background). Print
  stylesheet provides PDF via browser print.
- Offline: service-worker app cache; no network dependency at runtime.
- Demo sketches ship as static files in-repo, openable by URL (no file
  handling needed at all — a fallback demo path for locked-down boards).

## 7. Verification strategy

- **Unit tests (vitest)**: geometry kernel, every object type's `compute`, the
  undefined/recovery paths, expression parser, JSON round-trip, undo atomicity
  (incl. cascade restore).
- **Property / invariant tests (the crown jewel)**: each gate sketch is stored
  as a fixture; a seeded random drag-storm (N free parameters, random walks incl.
  degenerate crossings) asserts: all invariants hold within epsilon; defined ⇔
  renderable; no NaN/Inf in any geometry; nothing outside declared parentage
  moves; trace buffers stay bounded.
- **Interaction tests**: hit-testing at finger/mouse tolerances; action registry
  enumerates the full expected action set for canonical selections.
- **Visual check**: headless render of gate figures to PNG for eyeball diffs
  (screenshots, not pixel-perfect assertions).

## 8. Roadmap

- **M0 — walking skeleton.** Repo scaffold (Vite+TS strict, vitest, ESLint),
  GitHub Actions → Pages deploy, canvas + viewport (pan/zoom/DPR), free points,
  hit-test/select/drag, snapshot undo, save/load JSON, PWA shell. **Plus: test
  on the actual classroom whiteboard** — record browser engine/version, offline
  behavior, File System Access availability — and adjust the open/offline plan
  from findings.
- **M1 — the engine.** Object registry + DAG + recompute + branch continuity;
  core constructions (incl. point-on-object, polygons, circle-by-measurement);
  selection model + action registry + contextual action bar; property sheet;
  undefined chip; dependency inspector; cascade delete + Detach; measurements
  as first-class numerics.
- **M2 — the v1 product.** Calculations + parameters/sliders; notation layer;
  transformations; axes + function plotting; animation + trace; SVG/PNG export;
  present mode + touch polish; **G1–G5 pass**; docs + demo sketch files.
- **M3 — beyond.** `.gsp` importer; freehand assist layer; custom tools; loci;
  iteration; student mode (guardrails TBD).
  **Importer spike, in order:** (0) check prior art — existing open-source
  `.gsp` parsers, format documentation, or converters — before any from-scratch
  reversing (the reverse-engineering skill packs are methodology, not format
  knowledge); (1) collect a sample corpus — ≥10 `.gsp` files across GSP
  versions, deliberately including loci / custom tools / iteration cases;
  (2) decode the **JavaSketchpad export payload** (believed to be an encoded
  construction script — verify); (3) only if that fails, plan an OLE compound
  document parse; (4) map onto the registry, reporting degraded objects
  explicitly rather than dropping them.

## 9. Open questions (deliberately unresolved)

1. Chinese display name for teacher-facing UI (after M2, with real screenshots).
2. Student mode specifics: toolset locking? handed-out read-only copies? when?
3. `.gsp` route: the M3 spike above decides; needs the user to supply the sample
   corpus.
4. File association / desktop wrapper (Tauri): the only reliable double-click
   path, necessary only if real teachers demand OS-level file association.
5. Custom tools (record/replay constructions) — GSP's teacher-efficiency
   superpower; schedule once the action registry has real usage mileage.
6. **Vetoable premise (D17):** if the job is *static copies only* (draw, label,
   export — no dragging), say so explicitly; the architecture would shrink
   dramatically (no DAG recompute, no animation) and v1 would ship much sooner.
