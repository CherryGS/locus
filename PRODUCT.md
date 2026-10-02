# Locus product context

<!-- impeccable:product-schema 1 -->

This is the product context for interface design. It distills confirmed intent
and user discussion; it does not replace `project-doc/INTENT.md`, the logical
contracts in `project-doc/design`, or implementation evidence in code. When a
detail is unsettled, retain it as an open decision rather than treating an
existing screen or framework default as user approval.

## Platform

web

## Users

An individual managing a personal local collection of media files and AI model
weights. The user describes the central need as bringing the workflows together.
No team, enterprise, public publishing or collaboration audience is established.

## Product Purpose

Bring local files, viewable media, model information, source observations and
organization into one personal CMS. Preserve useful context around content so
that browsing, inspecting and organizing it can be connected activities.

The user has not selected one dominant linear workflow or a measured usage
frequency. Design exploration should use the existing capabilities to discuss
concrete interactions without inventing a mandatory wizard or acquisition funnel.

## Positioning

Locus combines different kinds of information around stable content identities.
An ECS-like backend separates domain ownership while allowing related components
to contribute views of the same Entity. Media, model weights and source context
belong to one management experience; extensibility and reduced coupling are
confirmed project goals.

AIGC metadata and relationships to specific model files remain product directions;
their unfinished behavior must not be presented as an already available feature.

## Operating Context

- A desktop application with an Electron host, a React renderer and a local
  Rust/Axum backend. The `web` platform value describes the renderer technology,
  not a selected standalone web deployment or a mobile product.
- Content enters through local-file import and supported externally supplied
  captures/uploads. The separately designed browser extension is an external
  producer; its implementation is outside this interface redesign.
- Existing workflows include browsing/searching Entities, viewing content and
  component details, navigating source/model information, applying personal tags
  and notes, observing tasks and managing library settings.
- The exact external applications the user switches between, the most frequent
  repeated operation and typical session length remain unspecified.

## Capabilities and Constraints

- Implemented domains include managed File, Image/Video, SafeTensors Model,
  Twitter, Civitai and Bilibili. Search, saved filter definitions, hierarchical
  personal tags and notes are existing capabilities. Verify particular behavior
  against code and its governing contract before changing a workflow.
- Entity/component identities, source provenance and actual operation outcomes
  keep their meaning across presentation changes. Display choices do not create
  domain facts or rewrite source content.
- Preserve established keyboard navigation, selection, focus, editing and
  asynchronous feedback semantics. Existing populated content should remain
  stable during updates; failures and unconfirmed outcomes stay attributable.
- The confirmed i18n design supplies Simplified Chinese and English. Language is
  library-owned in the database, empty means the environment's first language,
  English is the fallback, and saved changes apply through full restart. System
  regional formats and local time zone remain independent of UI language.
- That i18n contract is a design constraint, not a claim that translations have
  already been implemented. Original content, filenames, query expressions,
  logs and raw diagnostics retain their original form.
- No installer, additional Source, inference execution, cloud synchronization or
  installable extension ecosystem should be invented by interface examples.

## Brand Commitments

- The existing product name is Locus.
- The user explicitly does not accept the current shadcn defaults as a confirmed
  visual identity. Existing visual implementation is functional evidence and an
  input to redesign, not authority for palette, typography, spacing or composition.
- No replacement palette, typeface, material metaphor, light/dark policy or
  decorative identity has been selected. Preserve confirmed product behavior
  while discussing those choices with the user.

## Evidence on Hand

- `project-doc/INTENT.md` and confirmation in `project-doc/_scratch.md`.
- `project-doc/design/frame/localization/summary.md` for the converged i18n contract.
- Governing interaction contracts under `project-doc/design/webui` and repository
  implementation/UI rules under `rules`.
- The real application in `apps/desktop/src/renderer`, with shared controls,
  Entity browsing, content views, inspectors and independent feature slices.
- Isolated real-renderer previews via `just desktop-ui`; retained sample-library
  tooling is documented in `apps/desktop/scripts/SAMPLE-LIBRARY.md`.
- Fixture content is verification material, not the user's collection or proof
  of an unimplemented product capability. Some historical READMEs describe earlier
  specimens; compare them with current code and converged contracts.

## Product Principles

- Connect content and its context so common activities can happen together.
- Preserve the meaning and provenance of facts while changing their presentation.
- Keep the interface stable during ordinary edits and asynchronous updates.
- Make organization and inspection usable through both pointer and keyboard.
- Accommodate the confirmed languages without translating user-owned content.

## Open Product Questions

Specific daily workflow priorities and the external switching costs the user
most wants to remove remain open. Use concrete examples from the current product
to clarify them when a design choice depends on the answer; do not block unrelated
visual exploration on a hypothetical complete workflow description.
