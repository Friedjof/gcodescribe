import { toMultiPath, transformPolylines } from "./geometry";
import { convexHull } from "./geometryTransfer";
import { buildStyledPolylines } from "./styling";
import { eraseWorldPolylines, lineNearPath } from "./eraser";
import type { GeometryRequest } from "./geometryTasks";
export function computeGeometry(request: GeometryRequest) {
  switch (request.kind) {
    case "path": return { path: toMultiPath(request.lines), hull: convexHull(request.lines) };
    case "style": return buildStyledPolylines(request.lines, request.style);
    case "erase": {
      const world = request.transform ? transformPolylines(request.lines, request.transform) : request.lines;
      return request.preview ? world.filter((line) => lineNearPath(line, request.path, request.radius))
        : eraseWorldPolylines(world, request.path, request.mode, request.radius);
    }
  }
}
