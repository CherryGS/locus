import type { LocusClient, components } from "../src/index.js";

// Compile-only checks retain the generated conditional-write and outcome contracts.
export function preferenceContracts(client: LocusClient, entity_id: string, request_id: string) {
  client.PUT("/api/v1/entities/{entity_id}/view-preference", {
    params: { path: { entity_id } },
    body: { request_id, view_definition_id: "future/view", expected_revision: "9223372036854775807" },
  });
  client.PUT("/api/v1/entities/{entity_id}/view-preference", {
    params: { path: { entity_id } },
    // @ts-expect-error Revisions use decimal strings, never JavaScript numbers.
    body: { request_id, view_definition_id: "image.inspect", expected_revision: 1 },
  });
  client.PUT("/api/v1/entities/{entity_id}/view-preference", {
    params: { path: { entity_id } },
    // @ts-expect-error A write always names the intended definition.
    body: { request_id, expected_revision: "1" },
  });
}

export function observePreference(value: components["schemas"]["EntityViewPreference"]) {
  if (value.status === "saved") return value.revision;
  // @ts-expect-error Unset/missing results do not invent a saved revision.
  return value.revision;
}
