# UI shell reference research

This is a bounded reference survey for the user-requested mock-data GPUI Kit
shell. It records documented UI behavior, not live usability testing or a domain
contract. The user selected three columns: navigation, resource browser, and the
selected entity's component inspector. The inspector needs an Overview for
common information/issues and an editable notes/tags area. "Stability" means
Stability Matrix.

## Reference patterns

| Product | Documented pattern | Adaptation for this shell |
| --- | --- | --- |
| Civitai | A card gallery has distinct loading/empty states and grouped filters. Model versions and downloadable file variants have separate selectors. | Keep discovery controls in the browser. Show version/file facts in the model component panel without assigning final domain identities. |
| Stability Matrix | Checkpoint Manager combines categories, search, sorting, filters, previews and metadata actions. Local/embedded metadata differs from connected-source metadata. | Use familiar local-library navigation; separate file, model and source facts in the inspector. |
| ComfyUI Manager | The current manager documents left filters, top search, central cards and a right detail panel, including versions and status/warning information. | Let selection drive detail. Place item issues beside their item and make issue summaries navigate to the affected item. |
| Eagle | Its sidebar separates destinations, folders and smart views. Selection exposes editable notes/tags in a compact inspector. Inspector sections can collapse. | Maintain a persistent browser beside independently rendered component panels. Make annotations easy to reach. |
| digiKam | Editable Captions and Tags are separate from informational Metadata. Browser scope, filters, selection, and grid/table presentation are explicit. | Distinguish editable user annotations from read-only extracted facts and preserve selection across view changes. |

Primary sources:

- Civitai [gallery](https://raw.githubusercontent.com/civitai/civitai/main/src/components/Model/Infinite/ModelsInfinite.tsx), [filters](https://raw.githubusercontent.com/civitai/civitai/main/src/components/Model/Infinite/ModelFiltersDropdown.tsx), [versions](https://raw.githubusercontent.com/civitai/civitai/main/src/components/Model/ModelVersionList/ModelVersionList.tsx), and [file variants](https://raw.githubusercontent.com/civitai/civitai/main/src/components/Model/ModelVersions/DownloadVariantDropdown.tsx).
- Stability Matrix [Checkpoint Manager](https://docs.lykos.ai/stability-matrix/checkpoint-manager/overview.html) and [package status/actions](https://docs.lykos.ai/stability-matrix/package-manager/managing-packages.html).
- ComfyUI [current Manager guide](https://docs.comfy.org/manager/pack-management) and [redesign announcement](https://blog.comfy.org/p/meet-the-new-comfyui-manager).
- Eagle [sidebar](https://en.eagle.cool/support/article/interface-sidebar), [image list](https://en.eagle.cool/support/article/interface-image-list), [inspector](https://en.eagle.cool/support/article/interface-inspector), and [tags](https://en.eagle.cool/support/article/tags).
- digiKam [captions](https://docs.digikam.org/en/right_sidebar/captions_view.html), [metadata](https://docs.digikam.org/en/right_sidebar/metadata_view.html), [filters](https://docs.digikam.org/en/right_sidebar/filters_view.html), and [image view](https://docs.digikam.org/en/main_window/image_view.html).

## Prototype interpretation

- Left navigation selects a resource scope; filters and search stay above the
  center results. It does not turn persistent component kinds into global pages.
- The right inspector identifies the selected resource. Overview, component
  information, and user annotations have distinct presentations. Each applicable
  component provides its own panel, with a common frame and collapse behavior.
- Overview summarizes common information and mock issues. Item warnings carry a
  clear scope; library-wide issues are labeled separately from selected-item issues.
- Notes and removable/creatable tags edit only the selected item's in-memory
  state. State follows the item when selection changes. Nothing selected produces
  a selection prompt, not misleading empty editors.
- A grid/list switch changes presentation, not selection. Counts and empty-result
  messages reflect current mock filters. A clear demo/session indicator explains
  that edits are not saved to a real library.
- Use a restrained desktop theme, one accent for active selection, compact
  typography, meaningful preview art, and adjustable browser/inspector widths.

These are reversible presentation choices for an evaluation shell. They do not
define model identity, file custody, Source synchronization, generation execution,
metadata provenance, or authoritative component schemas. No actual downloads,
imports, filesystem scans, database calls, or destructive actions are wired.

Bulk editing is deferred in this single-selection prototype. Eagle's documented
[shared-tags-only display](https://en.eagle.cool/support/article/why-are-tags-empty-when-i-select-multiple-files-in-eagle)
can appear empty for a mixed selection; a future bulk editor should express mixed
values explicitly rather than reusing this prototype's single-item editor.

## GPUI Kit evidence

The official [getting-started recipe](https://gpui-kit.com/docs/getting-started)
uses the facade, initializes it before controls, retains input state/subscriptions,
and wraps windows in Root. The toolkit documents [sidebar](https://gpui-kit.com/component/sidebar),
[resizable panels](https://gpui-kit.com/component/resizable), and [inputs](https://gpui-kit.com/component/input).
Published crate metadata lists gpui-kit 0.6.4 with its matching GPUI dependencies.
Exact APIs and build viability must be verified against the resolved crate source;
some website examples show differing historical signatures.

The shell uses local fixture state only. It does not establish the later
GPUI-to-database task/lifetime bridge identified by the architecture's PV2.
