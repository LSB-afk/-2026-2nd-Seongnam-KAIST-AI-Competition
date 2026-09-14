import { describe, expect, it } from "vitest";
import { PLACES } from "../src/lib/places";
import { getOsmEmbed } from "../src/lib/osm-embed";

describe("official OSM embed boundary", () => {
  it("fits every filtered place and keeps attribution in the official document", () => {
    const { src } = getOsmEmbed(PLACES, null);
    const url = new URL(src);
    expect(url.origin + url.pathname).toBe("https://www.openstreetmap.org/export/embed.html");
    expect(url.searchParams.get("layer")).toBe("mapnik");
    expect(url.searchParams.has("marker")).toBe(false);
    const [west, south, east, north] = url.searchParams.get("bbox")!.split(",").map(Number);
    for (const place of PLACES) {
      expect(place.lng).toBeGreaterThan(west); expect(place.lng).toBeLessThan(east);
      expect(place.lat).toBeGreaterThan(south); expect(place.lat).toBeLessThan(north);
    }
  });
  it("puts only a selected filtered place into the latitude-first marker parameter", () => {
    const place = PLACES[0];
    const url = new URL(getOsmEmbed([place], place.id).src);
    expect(url.searchParams.get("marker")).toBe(`${place.lat},${place.lng}`);
    expect(new URL(getOsmEmbed([PLACES[1]], place.id).src).searchParams.has("marker")).toBe(false);
  });
  it("uses restored nationwide bounds and valid outbound larger-map links", () => {
    const result = getOsmEmbed(PLACES, PLACES[0].id, { lat: 36.3, lng: 127.7, zoom: 7 });
    const [west, south, east, north] = new URL(result.src).searchParams.get("bbox")!.split(",").map(Number);
    expect(west).toBeLessThan(126); expect(east).toBeGreaterThan(131.8);
    expect(south).toBeLessThan(33.3); expect(north).toBeGreaterThan(38);
    const full = new URL(result.fullUrl);
    expect(full.origin).toBe("https://www.openstreetmap.org");
    expect(full.hash).toBe("#map=7/36.3/127.7");
    expect(full.searchParams.get("mlat")).toBe(String(PLACES[0].lat));
  });
  it("keeps empty filters usable and never emits invalid coordinates", () => {
    for (const view of [undefined, { lat: NaN, lng: Infinity, zoom: -2 }]) {
      const { src } = getOsmEmbed([], null, view);
      const box = new URL(src).searchParams.get("bbox")!.split(",").map(Number);
      expect(box.every(Number.isFinite)).toBe(true);
      expect(box[0]).toBeLessThan(box[2]); expect(box[1]).toBeLessThan(box[3]);
      expect(src).not.toMatch(/NaN|Infinity/);
    }
  });
});
