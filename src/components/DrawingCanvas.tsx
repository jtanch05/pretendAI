import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { DrawingData, DrawingPoint, DrawingStroke } from "../types/drawing";

const colors = ["#000000", "#000080", "#c00000", "#008000", "#804000", "#800080"];
const sizes = [3, 7, 13];
const maxStrokes = 300;
const maxPoints = 5000;

function pointFor(event: ReactPointerEvent<SVGSVGElement>): DrawingPoint {
  const bounds = event.currentTarget.getBoundingClientRect();
  const width = bounds.width || 640;
  const height = bounds.height || 400;
  return {
    x: Math.max(0, Math.min(640, ((event.clientX - bounds.left) / width) * 640)),
    y: Math.max(0, Math.min(400, ((event.clientY - bounds.top) / height) * 400))
  };
}

function strokePath(stroke: DrawingStroke): string {
  if (stroke.points.length === 0) return "";
  const [first, ...rest] = stroke.points;
  if (rest.length === 0) return `M ${first.x} ${first.y} l .01 .01`;
  return `M ${first.x} ${first.y} ${rest.map((point) => `L ${point.x} ${point.y}`).join(" ")}`;
}

export function DrawingPreview({ drawing, label = "Drawing response" }: { drawing: DrawingData; label?: string }) {
  return <svg className="drawing-preview" viewBox="0 0 640 400" role="img" aria-label={label}>
    <rect width="640" height="400" fill="#fff" />
    {drawing.strokes.map((stroke, index) => <path key={index} d={strokePath(stroke)} fill="none" stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" />)}
  </svg>;
}

export function DrawingCanvas({ value, onChange }: { value: DrawingData; onChange: (drawing: DrawingData) => void }) {
  const [color, setColor] = useState(colors[0]);
  const [size, setSize] = useState(sizes[1]);
  const [erasing, setErasing] = useState(false);
  const activePointer = useRef<number | null>(null);

  function beginStroke(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || value.strokes.length >= maxStrokes) return;
    event.preventDefault();
    activePointer.current = event.pointerId;
    if (typeof event.currentTarget.setPointerCapture === "function") event.currentTarget.setPointerCapture(event.pointerId);
    onChange({ ...value, strokes: [...value.strokes, { color: erasing ? "#ffffff" : color, width: erasing ? size * 2 : size, points: [pointFor(event)] }] });
  }

  function continueStroke(event: ReactPointerEvent<SVGSVGElement>) {
    if (activePointer.current !== event.pointerId || value.strokes.length === 0) return;
    event.preventDefault();
    const strokes = [...value.strokes];
    const current = strokes[strokes.length - 1];
    const pointCount = strokes.reduce((total, stroke) => total + stroke.points.length, 0);
    if (pointCount >= maxPoints) return;
    strokes[strokes.length - 1] = { ...current, points: [...current.points, pointFor(event)] };
    onChange({ ...value, strokes });
  }

  function endStroke(event: ReactPointerEvent<SVGSVGElement>) {
    if (activePointer.current !== event.pointerId) return;
    activePointer.current = null;
    if (typeof event.currentTarget.hasPointerCapture === "function" && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return <section className="drawing-editor" aria-label="Drawing editor">
    <div className="drawing-toolbar" role="toolbar" aria-label="Drawing tools">
      <span className="drawing-tool-label">color</span>
      {colors.map((option) => <button key={option} className={color === option && !erasing ? "selected" : ""} style={{ backgroundColor: option }} type="button" aria-label={`Use ${option}`} onClick={() => { setColor(option); setErasing(false); }} />)}
      <span className="drawing-tool-label">brush</span>
      {sizes.map((option) => <button key={option} className={`brush-size ${size === option ? "selected" : ""}`} type="button" aria-label={`Brush size ${option}`} onClick={() => setSize(option)}><i style={{ width: option, height: option }} /></button>)}
      <button className={erasing ? "tool-button selected" : "tool-button"} type="button" onClick={() => setErasing((current) => !current)}>eraser</button>
      <button className="tool-button" type="button" disabled={value.strokes.length === 0} onClick={() => onChange({ ...value, strokes: value.strokes.slice(0, -1) })}>undo</button>
      <button className="tool-button" type="button" disabled={value.strokes.length === 0} onClick={() => onChange({ ...value, strokes: [] })}>clear</button>
    </div>
    <svg className="drawing-surface" viewBox="0 0 640 400" role="application" aria-label="Drawing canvas" onPointerDown={beginStroke} onPointerMove={continueStroke} onPointerUp={endStroke} onPointerCancel={endStroke}>
      <rect width="640" height="400" fill="#fff" />
      {value.strokes.map((stroke, index) => <path key={index} d={strokePath(stroke)} fill="none" stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" />)}
    </svg>
    <p className="fine-print">Draw with a mouse, pen, or finger. Undo removes one stroke at a time.</p>
  </section>;
}
