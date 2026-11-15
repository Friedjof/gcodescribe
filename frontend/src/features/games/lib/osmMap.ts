import type { OsmMapResponse } from "../../../api";
import type { Pt } from "../../paint/lib/geometry";
import type { TemplateSpec, Translator } from "./types";

function metadataNumber(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function buildOsmMapTemplate(map: OsmMapResponse, t: Translator): TemplateSpec {
  const lines = map.lines as Pt[][];
  return {
    name: t("game.osmMap.name"),
    lines,
    width: map.width,
    height: map.height,
    details: [
      { label: t("games.osm.strokes"), value: String(metadataNumber(map.metadata, "line_count") || lines.length) },
      { label: t("games.osm.points"), value: String(metadataNumber(map.metadata, "point_count")) },
      { label: t("games.osm.geometryLength"), value: `${(metadataNumber(map.metadata, "geometry_mm") / 1000).toFixed(2)} m` },
      ...(map.metadata.detail_reduced ? [{ label: t("games.osm.budget"), value: t("games.osm.budgetReduced") }] : []),
    ],
  };
}
