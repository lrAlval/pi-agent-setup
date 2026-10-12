# pi-eta in pi-footer (zero config)

pi-eta publishes its one-line status via ctx.ui.setStatus("pi-eta", ...).
pi-footer renders every non-empty extension status automatically in its
extension-status row (sorted by key). Nothing to configure.

Example row: `ETA ~14m - 2/5` (key pi-eta).

## Hide it

Via /footer config -> extension status row -> hide key `pi-eta`.
Or keep it and hide noisier keys instead.

## Empty state

No todos -> pi-eta publishes `ETA: no plan`. To hide the row until a plan
exists, add `pi-eta` to knownKeys (shows `[Empty status]` placeholder) or
hiddenKeys. Note: pi-eta currently always publishes; null-publish on empty
plan is a possible future tweak (see TODOS 3.6).

## Rich widget path (future)

pi-footer supports event widgets via `pi-footer:update-widget`
{widgetId, value}. Wiring that needs a pi-eta-side setting for the footer
widgetId, which pi-eta does not have yet. Status row covers v1.
