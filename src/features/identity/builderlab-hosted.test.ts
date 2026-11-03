import { expect, it } from "vitest";
import { relayOrigin } from "../communities/destination";
import type { FoundCommunity } from "../communities/find-community";
import { hostedByThisBuilderlab } from "./builderlab-hosted";

const PUBLIC = "https://account.mira-ai.ro";
const PUBLIC_SELF =
  "0000000000000000000000000000000000000000000000000000000000000000";
/** As `findCommunity` reports it: the canonical origin, plus `self` when given. */
const found = (input: string, self?: string): FoundCommunity => ({
  url: relayOrigin(input),
  host: new URL(relayOrigin(input)).host,
  self,
  policy: null,
});
/** Whether a public build signs in for `input` at once. */
const hosted = (input: string, self?: string) =>
  hostedByThisBuilderlab(found(input, self), PUBLIC);

it.each([
  "wss://workspace.mira-ai.ro",
  "https://design.workspace.mira-ai.ro",
  "WSS://Design.Communities.BUZZ.xyz.",
  "https://workspace.mira-ai.ro:443",
])("%s is hosted by a public build's Builderlab", (input) => {
  expect(hosted(input)).toBe(true);
});

it.each([
  "wss://workspace.mira-ai.ro.evil.com",
  "wss://notcommunities.buzz.xyz",
  "wss://xcommunities.buzz.xyz",
  "wss://buzz.xyz",
  "wss://buzz.block.builderlab.xyz",
  "wss://buzz.acme.builderlab.xyz",
  "wss://relay.example.com",
  "https://workspace.mira-ai.ro:8443",
])("%s is not hosted by a public build's Builderlab", (input) => {
  expect(hosted(input)).toBe(false);
});

it.each([
  ["", false],
  ["not a url", false],
  // Only the origin counts: the build URL carries the API's base path.
  ["https://account.mira-ai.ro/api/goose/", true],
  // Another deployment's portal, as a federated-identity build derives it.
  ["https://block.builderlab.xyz", false],
])("a build URL of %j hosts workspace.mira-ai.ro: %s", (build, expected) => {
  expect(
    hostedByThisBuilderlab(found("wss://design.workspace.mira-ai.ro"), build),
  ).toBe(expected);
});

it("falls back to the relay key when the hostname is unknown, on the default port only", () => {
  // A deployment moved to a new domain keeps its relay key.
  expect(hosted("wss://buzz.example", PUBLIC_SELF)).toBe(true);
  expect(hosted("https://buzz.example:8443", PUBLIC_SELF)).toBe(false);
  expect(hosted("wss://buzz.example", "ab".repeat(32))).toBe(false);
  // An unknown relay with no `self` never matches, even with no build URL.
  expect(hostedByThisBuilderlab(found("wss://buzz.example"), "")).toBe(false);
});
