import type { OsmMapResponse } from "../api";
import type { Pt } from "../paint/geometry";
import type { TemplateSpec, Translator } from "./types";

function metadataNumber(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatLayerList(metadata: Record<string, unknown>) {
  const layers = metadata.layers;
  return Array.isArray(layers) ? layers.map(String).join(", ") : "-";
}

export function buildOsmMapTemplate(map: OsmMapResponse, t: Translator): TemplateSpec {
  const lines = map.lines as Pt[][];
  return {
    name: t("game.osmMap.name"),
    lines,
    width: map.width,
    height: map.height,
    details: [
      { label: t("games.osm.layers"), value: formatLayerList(map.metadata) },
      { label: t("games.osm.lines"), value: String(metadataNumber(map.metadata, "line_count") || lines.length) },
      { label: t("games.osm.points"), value: String(metadataNumber(map.metadata, "point_count")) },
    ],
  };
}
