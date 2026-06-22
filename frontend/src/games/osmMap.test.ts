import { describe, expect, it } from "vitest";
import { buildOsmMapTemplate } from "./osmMap";

const t = (key: string) => key;

describe("buildOsmMapTemplate", () => {
  it("turns an OSM response into a template", () => {
    const template = buildOsmMapTemplate({
      width: 160,
      height: 120,
      viewBox: "0 0 160 120",
      lines: [
        [[0, 0], [80, 40], [160, 120]],
        [[10, 10], [20, 10], [20, 20], [10, 10]],
      ],
      metadata: {
        layers: ["streets", "buildings"],
        line_count: 2,
        point_count: 7,
      },
    }, t);

    expect(template.name).toBe("game.osmMap.name");
    expect(template.width).toBe(160);
    expect(template.height).toBe(120);
    expect(template.lines).toHaveLength(2);
    expect(template.details).toEqual([
      { label: "games.osm.layers", value: "streets, buildings" },
      { label: "games.osm.lines", value: "2" },
      { label: "games.osm.points", value: "7" },
    ]);
  });
});
