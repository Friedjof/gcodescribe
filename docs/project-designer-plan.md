# Projects in the designer

Status: implemented, 19 October 2026.

## Usage

- The project name on the left opens the project overview popup. Search, create, open, rename, archive and restore projects there.
- Every new project gets its own profile. An existing profile can be copied as a template. Project settings edit that profile directly in the popup, including paper, plot bounds, pen heights, feed rates, positions and obstacles.
- The left panel shows only the current project's folders and slides. Folders can be nested, renamed, moved and deleted. Slides can move between folders or explicitly into another project. The folder tree has no separate profile groups.
- New slides capture the current project calibration. Later profile edits do not modify existing slides. The popup can explicitly apply the saved project profile to the open slide, checking that its contents fit the plot area.
- The designer does not display a stale-profile status. Listing and saving slides generate neither G-code nor a 3D preview. Those calculations start only when previewing, generating G-code or plotting, using the current project calibration.
- The designer's calibration position and contact pressure use the project profile even if another profile is globally active.

## Storage and migration

`paint_index` contains projects, folders and compact slide metadata. Slide contents remain under `paint_page_<id>`. Reading an old index for the first time creates a `paint_index_before_projects` backup and a `paint_page_before_projects_<id>` backup per slide. Existing IDs and content are preserved; previous profile groups become projects.

Each slide has `projectId`, `groupId` and a `profileSnapshot` containing calibration and a fingerprint. If the old profile is missing or its fingerprint changed, its original calibration cannot be reconstructed reliably. The user must explicitly apply the project profile before previewing or plotting that slide.

The active project currently resides in the shared document index; each project remembers its last open slide. Switching projects saves pending editor changes before loading the destination slide.

## Plotting and safety

Designer jobs store the project calibration used at generation time in job metadata. The printer checks it against current project calibration and the active machine profile's bed/Z limits. Changing project calibration requires regenerating G-code. Other jobs retain the globally active profile check. Sending to a printer was tested with a simulated client; physical validation remains outstanding.

## Designer module boundaries

`Paint.tsx` connects the interface to three controllers:

- `usePaintDocument` synchronises pages, save status and completed imports while preserving local drafts during background updates.
- `usePaintCanvasActions` turns drawing actions, fills and text insertion into object commands.
- `usePaintJobs` handles G-code generation, previews and printing. A synchronous lock prevents duplicate commands. After each preparatory step it checks that the page, project, profile revision and active tab still match the original action. Accepted print jobs are not automatically cancelled or resent.

The sidebar (`usePaintPages`) and document controller share `PageNavigation`. Navigation intentions take effect before waiting for autosave; pending writes finish in order. Only the current navigation may replace page content, selection and history. Project switching waits for started page mutations and accounts for a destination project reported early by shared context. Late page, folder or index responses cannot overwrite the latest page or another project. Renaming merges metadata only; deleting a background page preserves current edits and history.

`useObjectOps` remains the interface for the canvas, toolbars and shortcuts. `hooks/objects/` contains shared history/commit guards and separate text, geometry, selection and transform commands. Background work keeps its original page in cache. Text/style tokens include page IDs because copied pages can share object IDs. Pending text is committed to its original page during navigation.

`api/pageEdits.ts` preserves the storage API. The injectable `api/documents/pageEditStore.ts` owns drafts, queues and conflicts; `objectPatches.ts` computes and merges object changes. Save events use typed subscriptions. Browser lifecycle listeners are explicitly installed and removed. Discarding keeps local edits until the server document loads successfully and preserves any newer input made meanwhile.

In the backend, `DocumentStore` remains the public facade. `core/documents/` separates pages, projects and folders. All repositories share a `DocumentState` with the same reentrant lock, keeping revision checks and nested writes atomic. Storage keys and migrations remain compatible. Empty tombstones count as missing pages and cannot be revived by late writes.

## Direct canvas interaction

Resize/rotation handles have fixed screen sizes and larger transparent hit targets. Overlapping handles are reduced on small objects. A live display shows position and snapping while moving, millimetre dimensions while scaling, and angle/delta while rotating. It stays upright in rotated views and inside the visible canvas.

Shift preserves aspect ratio while resizing and snaps rotation in 15° increments. Alt bypasses grid, alignment and angle snapping. Escape cancels a gesture. Page/tool changes, hidden views and loss of focus also discard pending previews. Releasing commits one undo step. `canvasTransforms.ts` owns size/bounds calculations; handles, live displays and screen measurements have separate components/hooks.

At plot boundaries, multi-selection moves together and shrinks uniformly if necessary, preserving spacing, relative sizes and reflections. Handle hit areas account for the actual grab point so the first movement does not cause a size jump. Returning to the original state creates no empty undo step.

## Exact dimensions and numeric entry

The expandable measurement bar above the canvas shows X/Y, width, height, aspect ratio and rotation for one object. X/Y refer to the rotated bounding box's upper-left corner; width/height refer to the unrotated object. Its expanded state is saved locally. The old measurement fields in the right style panel are removed.

Numbers remain drafts until Enter or blur; Escape discards them. Decimal commas, decimal points and matching units are accepted. Arrow keys adjust the draft, with larger steps using Shift. This also applies to text size, line and fill settings. Different objects/pages get separate inputs; external changes to the edited value invalidate stale drafts.

`objectMeasurements.ts` implements exact transforms, producing one undo step per accepted change and none for invalid/unchanged values. Out-of-bounds positions, or dimensions/rotations that would require shrinking, are explained and rejected. Valid dimensions may be repositioned within the plot bounds while preserving the entered size.
