import { computeGeometry } from "./geometryWork";
import { unpackLines } from "./geometryTransfer";
import { localBounds } from "./geometry";
import { DISPLAY_INK_COLOR } from "../../../lib/displayStroke";
import { RASTER_MAX_EDGE } from "./rasterPreview";
self.onmessage = async ({ data }) => {
  try {
    const request = { ...data.request, lines: unpackLines(data.request.packed) };
    if (request.kind === "raster") {
      const [x0, y0, x1, y1] = localBounds(request.lines);
      const stroke = request.stroke;
      const width = x1 - x0 + stroke * 2, height = y1 - y0 + stroke * 2;
      const size = Math.min(RASTER_MAX_EDGE, Math.max(512, Math.ceil(Math.max(width, height) / stroke * 3)));
      const scale = size / Math.max(width, height);
      const canvas = new OffscreenCanvas(Math.max(1, Math.ceil(width * scale)), Math.max(1, Math.ceil(height * scale)));
      const ctx = canvas.getContext("2d")!;
      ctx.scale(canvas.width / width, canvas.height / height); ctx.translate(-x0 + stroke, -y0 + stroke);
      // Color the bitmap once, not with a per-frame SVG/CSS filter. WebKit's
      // filtered images are expensive to scale, and UI themes never change paper.
      ctx.strokeStyle = DISPLAY_INK_COLOR; ctx.lineWidth = stroke; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath();
      for (const line of request.lines) {
        if (!line.length) continue;
        ctx.moveTo(line[0][0], line[0][1]);
        for (let i = 1; i < line.length; i++) ctx.lineTo(line[i][0], line[i][1]);
      }
      ctx.stroke();
      const buffer = await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer();
      self.postMessage({ id: data.id, result: buffer }, { transfer: [buffer] });
    } else self.postMessage({ id: data.id, result: computeGeometry(request) });
  }
  catch (error) { self.postMessage({ id: data.id, error: String(error) }); }
};
