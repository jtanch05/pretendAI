export type DrawingPoint = { x: number; y: number };

export type DrawingStroke = {
  color: string;
  width: number;
  points: DrawingPoint[];
};

export type DrawingData = {
  version: 1;
  width: 640;
  height: 400;
  strokes: DrawingStroke[];
};

export const emptyDrawing = (): DrawingData => ({
  version: 1,
  width: 640,
  height: 400,
  strokes: []
});

export function isDrawingData(value: unknown): value is DrawingData {
  if (!value || typeof value !== "object") return false;
  const drawing = value as Partial<DrawingData>;
  if (drawing.version !== 1 || drawing.width !== 640 || drawing.height !== 400 || !Array.isArray(drawing.strokes) || drawing.strokes.length === 0 || drawing.strokes.length > 300) return false;
  return drawing.strokes.every((stroke) =>
    Boolean(stroke) &&
    /^#[0-9a-f]{6}$/i.test(stroke.color) &&
    Number.isFinite(stroke.width) && stroke.width >= 1 && stroke.width <= 30 &&
    Array.isArray(stroke.points) &&
    stroke.points.length > 0 && stroke.points.length <= 5000 &&
    stroke.points.every((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y) && point.x >= 0 && point.x <= 640 && point.y >= 0 && point.y <= 400)
  );
}
