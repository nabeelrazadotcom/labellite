"use strict";
// ---- Drive upload url = the Apps Script web app URL ending in /exec
const UPLOAD = {
  url: "https://script.google.com/macros/s/AKfycby9vfmj69Kb8eFLtZX5cvrnJqLy1xGnjfnEEhQqBUdWu3jtmqxv5y_spDDJFTQ_Tk9T/exec",
  token: "etTgLj13Vw3HMMSFxnWCDDqkE5qUA2hX",
};
const $ = s => document.querySelector(s);
const IMG_RE = /\.(jpe?g|png|bmp|webp)$/i;
const ROW_VERTS = 4;
const cv = $("#cv"), ctx = cv.getContext("2d");

const S = {
  root: null, files: [], idx: -1, loadToken: 0, cache: new Map(),
  img: null, W: 0, H: 0, data: null, shapes: [],
  sel: new Set(), selV: null, hover: -1, hoverV: null, hoverHandle: false,
  mode: "edit", draft: [], cursor: null,
  view: { s: 1, x: 0, y: 0 }, cw: 0, ch: 0, dpr: 1,
  undo: [], redo: [], lastTag: null, lastTagT: 0,
  labels: ["vertical", "horizontal", "diagonal", "both"], label: "vertical",
  dirty: false, saveTimer: null, chain: Promise.resolve(), pending: 0,
  hideAll: false, space: false, drag: null, down: null,
  pivot: "group",
  multi: { n: 6, dir: "v", gap: 25 },
  app: recall("appMode", "row"),     // "row" = Row Labeler Mode, "box" = Bounding Box Mode
  boxStart: null,                   // first corner while click-click drawing a box
  extraLabels: { row: recall("classes.row", ["vertical", "horizontal", "diagonal", "both"]), box: recall("classes.box", []) },
  hiLabel: null, hiOnly: false,     // class whose images are highlighted in the image list
  rememberClass: false,             // box mode: true = new boxes get S.label without picker
  pendingBox: null, classEdit: null, clsTyped: false,
  busy: false, ctx: null,
  vp: null,       // { x, y } vanishing point in image coords (session only, reset per image)
  gradient: null, // perspective calibration across the field
  calibMasters: null, // Set of master boundary shapes used for VP calibration
  calibBounds: null,  // Master row End-A / End-B boundary lines for Alt+E endpoint alignment
  snapEdges: null,    // Active magnetic snap borders ("left"|"right"|"top"|"bottom") while dragging
  workspace: { root: null, blocks: [], tab: "pending", currentName: null },
  hudPos: null,   // { x, y } HUD puck position in stage px from top-left
  hudOpen: false, // whether the HUD panel is expanded
};
const BOX = () => S.app === "box";
const unit = n => BOX() ? (n === 1 ? "box" : "boxes") : (n === 1 ? "row" : "rows");

// ---------------------------------------------------------------- small utils
function store(k, v) { try { localStorage.setItem("rowlab." + k, JSON.stringify(v)); } catch (e) {} }
function recall(k, d) { try { const v = localStorage.getItem("rowlab." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
let toastT;
function toast(msg, ms = 2600) { const t = $("#toast"); t.textContent = msg; t.style.display = "block"; clearTimeout(toastT); toastT = setTimeout(() => t.style.display = "none", ms); }
const stem = n => n.replace(/\.[^.]+$/, "");
const r2 = v => Math.round(v * 100) / 100;
const natCmp = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
const DEFAULT_CLASS_COLORS = {
  vertical: [0, 215, 255],     // Electric Cyan (#00D7FF) - vivid against green & soil
  horizontal: [255, 130, 20],   // Tangerine Orange (#FF8214) - warm high contrast
  diagonal: [240, 40, 160],    // Neon Magenta / Fuchsia (#F028A0) - unmistakable 3rd angle
  both: [170, 85, 255],        // Electric Violet (#AA55FF) - bidirectional (horiz + vert)
  row: [40, 225, 115],         // Bright Emerald Lime (#28E173)
  weed: [255, 220, 0],         // Canary Yellow (#FFDC00)
  missing: [255, 55, 75],      // Vivid Coral Red (#FF374B)
  plant: [140, 240, 30],       // Spring Chartreuse (#8CF01E)
  box: [30, 144, 255],         // Dodger Cobalt Blue (#1E90FF)
  gap: [255, 175, 0],          // Amber Gold (#FFAF00)
  other: [160, 70, 255]        // Vibrant Purple (#A046FF)
};

const PALETTE = [
  [0, 215, 255],
  [255, 130, 20],
  [240, 40, 160],
  [40, 225, 115],
  [255, 220, 0],
  [160, 70, 255],
  [255, 55, 75],
  [0, 230, 200],
  [255, 150, 190],
  [140, 240, 30],
  [30, 144, 255],
  [255, 95, 0],
  [185, 115, 255],
  [50, 205, 50],
  [255, 190, 70],
  [0, 210, 180]
];

let customClassColors = recall("classColors", {}) || {};

function hexOf(rgb) {
  if (!rgb || !Array.isArray(rgb) || rgb.length < 3) return "#00d7ff";
  return "#" + rgb.slice(0, 3).map(x => {
    const s = Math.max(0, Math.min(255, Math.round(Number(x) || 0))).toString(16);
    return s.length === 1 ? "0" + s : s;
  }).join("");
}

function parseHex(h) {
  if (!h || typeof h !== "string") return null;
  h = h.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  if (h.length !== 6) return null;
  const num = parseInt(h, 16);
  if (isNaN(num)) return null;
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function labelColor(label) {
  if (!label) return [180, 185, 195];
  const lk = String(label).trim().toLowerCase();
  if (customClassColors[lk] && Array.isArray(customClassColors[lk])) return customClassColors[lk];
  if (DEFAULT_CLASS_COLORS[lk]) return DEFAULT_CLASS_COLORS[lk];
  let h = 0;
  for (let i = 0; i < lk.length; i++) h = (h * 31 + lk.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function openColorPickerFor(label) {
  if (!label) return;
  const picker = $("#classColorPicker");
  if (!picker) return;
  const curRgb = labelColor(label);
  picker.value = hexOf(curRgb);
  picker.dataset.targetLabel = label;
  picker.click();
}

function resetClassColor(label) {
  if (!label) return;
  const lk = String(label).trim().toLowerCase();
  if (customClassColors[lk]) {
    delete customClassColors[lk];
    store("classColors", customClassColors);
    renderLabels();
    refreshAll();
    toast(`Reset color for “${label}” to default`, 1800);
  } else {
    toast(`“${label}” is already using default color`, 1500);
  }
}

window.resetAllClassColors = function() {
  customClassColors = {};
  store("classColors", {});
  renderLabels();
  refreshAll();
  toast("All class colors reset to defaults", 2000);
};

const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// ---------------------------------------------------------------- geometry
const isClosed = s => s.shape_type === "polygon" || s.shape_type === "rectangle";
function rectPts(s) {
  const [[a, b], [c, d]] = s.points.length >= 2 ? s.points : [s.points[0], s.points[0]];
  const x0 = Math.min(a, c), x1 = Math.max(a, c), y0 = Math.min(b, d), y1 = Math.max(b, d);
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}
const ptsOf = s => s.shape_type === "rectangle" ? rectPts(s) : s.points;
function toPolygon(s) { if (s.shape_type === "rectangle") { s.points = rectPts(s); s.shape_type = "polygon"; } }
function isBadIn(s, box) {
  if (s.shape_type === "rectangle") { const p = rectPts(s); return p[1][0] - p[0][0] < 2 || p[2][1] - p[1][1] < 2; }
  if (box) return false;
  if (s.shape_type === "polygon") return s.points.length !== ROW_VERTS;
  return false;
}
const isBad = s => isBadIn(s, BOX());
function badText(s) {
  if (s.shape_type === "rectangle") return "empty box";
  return s.points.length + " vertices";
}
const isBoxShape = s => BOX() && s.shape_type === "rectangle";
function normRect(s) {
  const p = rectPts(s); s.points = [[p[0][0], p[0][1]], [p[2][0], p[2][1]]];
}
function centroid(pts) { let x = 0, y = 0; for (const p of pts) { x += p[0]; y += p[1]; } return [x / pts.length, y / pts.length]; }
function axisOf(pts) {
  const c = centroid(pts); let xx = 0, yy = 0, xy = 0;
  for (const p of pts) { const dx = p[0] - c[0], dy = p[1] - c[1]; xx += dx * dx; yy += dy * dy; xy += dx * dy; }
  const t = 0.5 * Math.atan2(2 * xy, xx - yy);
  return { c, u: [Math.cos(t), Math.sin(t)], v: [-Math.sin(t), Math.cos(t)] };
}
function rotPt(p, c, a) { const cs = Math.cos(a), sn = Math.sin(a), dx = p[0] - c[0], dy = p[1] - c[1]; return [c[0] + dx * cs - dy * sn, c[1] + dx * sn + dy * cs]; }
function inPoly(p, pts) {
  let ins = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function bboxOf(list) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const pts of list) for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  return { x0, y0, x1, y1 };
}
function segIntersects(a1, a2, b1, b2) {
  const d1x = a2[0] - a1[0], d1y = a2[1] - a1[1];
  const d2x = b2[0] - b1[0], d2y = b2[1] - b1[1];
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return false;
  const dx = b1[0] - a1[0], dy = b1[1] - a1[1];
  const t = (dx * d2y - dy * d2x) / denom;
  const u = (dx * d1y - dy * d1x) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
function polyHitsBox(pts, x0, y0, x1, y1) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
  }
  if (maxX < x0 || minX > x1 || maxY < y0 || minY > y1) return false;
  for (const p of pts) {
    if (p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1) return true;
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) return true;
  const boxCorners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  for (const bp of boxCorners) {
    if (inPoly(bp, pts)) return true;
  }
  const boxEdges = [
    [boxCorners[0], boxCorners[1]],
    [boxCorners[1], boxCorners[2]],
    [boxCorners[2], boxCorners[3]],
    [boxCorners[3], boxCorners[0]]
  ];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const e1 = pts[i], e2 = pts[(i + 1) % n];
    for (const be of boxEdges) {
      if (segIntersects(e1, e2, be[0], be[1])) return true;
    }
  }
  return false;
}
const clampX = x => Math.max(0, Math.min(S.W, x));
const clampY = y => Math.max(0, Math.min(S.H, y));
const inside = p => p[0] >= 0 && p[0] <= S.W && p[1] >= 0 && p[1] <= S.H;

function rayToBorder(p, dir) {
  const tx = dir[0] > 1e-9 ? (S.W - p[0]) / dir[0] : dir[0] < -1e-9 ? (0 - p[0]) / dir[0] : Infinity;
  const ty = dir[1] > 1e-9 ? (S.H - p[1]) / dir[1] : dir[1] < -1e-9 ? (0 - p[1]) / dir[1] : Infinity;
  const dist = Math.min(tx, ty);
  if (!isFinite(dist) || dist < 0) return null;
  return { dist, pt: [clampX(p[0] + dir[0] * dist), clampY(p[1] + dir[1] * dist)] };
}

function segmentBlockedByOtherShape(p, q, selfShape) {
  const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  for (const other of S.shapes) {
    if (other === selfShape || other._vis === false || !isClosed(other)) continue;
    const op = ptsOf(other);
    if (op.length < 3) continue;
    if (inPoly(mid, op) || inPoly(q, op)) return true;
    for (let k = 0; k < op.length; k++) {
      if (segIntersects(p, q, op[k], op[(k + 1) % op.length])) return true;
    }
  }
  return false;
}

// Fit one shape's points inside the image + snap accidental sub-0.35% micro-slivers along major axis u.
// Returns new points, or null if nothing changed.
function fittedPoints(s, snapSlivers = false) {
  const pts = s.points;
  if (!pts.length || !S.W || !S.H) return null;
  const allInside = pts.every(inside);
  if (!snapSlivers && allInside) return null;
  if (s.shape_type === "polygon" && pts.length === ROW_VERTS) {
    const { c, u } = axisOf(pts);
    const sliverThresh = snapSlivers ? Math.max(4, Math.min(S.W, S.H) * 0.0022) : 0; // ~13px (~1.9 screen px at fit) on 8064x6048; preserves intentional 20px+ insets
    let changed = false;
    const out = pts.map(p => {
      if (!inside(p)) {
        changed = true;
        const along = (c[0] - p[0]) * u[0] + (c[1] - p[1]) * u[1], d = along >= 0 ? u : [-u[0], -u[1]];
        let lo = 0, hi = Math.abs(along) * 2;
        for (const [k, max] of [[0, S.W], [1, S.H]]) {
          if (Math.abs(d[k]) < 1e-9) { if (p[k] < 0 || p[k] > max) { lo = Infinity; } continue; }
          let a = (0 - p[k]) / d[k], b = (max - p[k]) / d[k]; if (a > b) [a, b] = [b, a];
          lo = Math.max(lo, a); hi = Math.min(hi, b);
        }
        const q = lo <= hi ? [p[0] + d[0] * lo, p[1] + d[1] * lo] : p;
        return [clampX(q[0]), clampY(q[1])];
      }
      if (!snapSlivers) return p;
      // Inside vertex: only snap microscopic slivers along outward major axis u (never widens parallel rows!)
      const alongOut = (p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1];
      const outDir = alongOut >= 0 ? u : [-u[0], -u[1]];
      const hit = rayToBorder(p, outDir);
      if (hit && hit.dist > 0.5 && hit.dist <= sliverThresh && !segmentBlockedByOtherShape(p, hit.pt, s)) {
        changed = true;
        return hit.pt;
      }
      return p;
    });
    return changed ? out : null;
  }
  if (allInside) return null;
  return pts.map(p => [clampX(p[0]), clampY(p[1])]);
}
function fitAll(snapSlivers = false) {
  let n = 0;
  S.shapes.forEach(s => { const f = fittedPoints(s, snapSlivers); if (f) { s.points = f; n++; } });
  return n;
}

// ---------------------------------------------------------------- view
const toScr = p => [p[0] * S.view.s + S.view.x, p[1] * S.view.s + S.view.y];
const toImg = (sx, sy) => [(sx - S.view.x) / S.view.s, (sy - S.view.y) / S.view.s];
function fit() {
  if (!S.img) return;
  const s = Math.min(S.cw / S.W, S.ch / S.H) * 0.97;
  S.view = { s, x: (S.cw - S.W * s) / 2, y: (S.ch - S.H * s) / 2 };
  draw(); updateFooter();
}
function zoomAt(sx, sy, f) {
  const s = Math.max(0.01, Math.min(60, S.view.s * f)); f = s / S.view.s;
  S.view.x = sx - (sx - S.view.x) * f; S.view.y = sy - (sy - S.view.y) * f; S.view.s = s;
  draw(); updateFooter();
}
function zoomToShape(i) {
  const b = bboxOf([ptsOf(S.shapes[i])]);
  const bw = Math.max(b.x1 - b.x0, 50), bh = Math.max(b.y1 - b.y0, 50);
  const s = Math.min(S.cw / bw, S.ch / bh, 3) * 0.6;
  S.view = { s, x: S.cw / 2 - (b.x0 + b.x1) / 2 * s, y: S.ch / 2 - (b.y0 + b.y1) / 2 * s };
  draw(); updateFooter();
}
function resize() {
  const r = $("#stage").getBoundingClientRect(); S.dpr = window.devicePixelRatio || 1;
  S.cw = r.width; S.ch = r.height; cv.width = Math.round(r.width * S.dpr); cv.height = Math.round(r.height * S.dpr);
  draw();
  // Keep HUD puck inside stage after resize
  if (S.hudPos) S.hudPos = applyHudPos(S.hudPos);
}
new ResizeObserver(resize).observe($("#stage"));

// ---------------------------------------------------------------- drawing
let raf = 0;
function draw() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); }
function paint() {
  ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
  ctx.fillStyle = "#0b0c0e"; ctx.fillRect(0, 0, S.cw, S.ch);
  if (!S.img) return;
  const { s, x, y } = S.view;
  ctx.imageSmoothingEnabled = s < 3;
  ctx.drawImage(S.img, x, y, S.W * s, S.H * s);
  ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, S.W * s, S.H * s);
  if (S.snapEdges && S.snapEdges.size) {
    ctx.save();
    ctx.strokeStyle = "#00e5ff";
    ctx.lineWidth = 3;
    ctx.shadowColor = "#00e5ff";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    if (S.snapEdges.has("left"))   { ctx.moveTo(x, y); ctx.lineTo(x, y + S.H * s); }
    if (S.snapEdges.has("right"))  { ctx.moveTo(x + S.W * s, y); ctx.lineTo(x + S.W * s, y + S.H * s); }
    if (S.snapEdges.has("top"))    { ctx.moveTo(x, y); ctx.lineTo(x + S.W * s, y); }
    if (S.snapEdges.has("bottom")) { ctx.moveTo(x, y + S.H * s); ctx.lineTo(x + S.W * s, y + S.H * s); }
    ctx.stroke();
    ctx.restore();
  }
  if (!S.hideAll) {
    S.shapes.forEach((sh, i) => { if (sh._vis !== false && !S.sel.has(i)) drawShape(sh, i); });
    S.shapes.forEach((sh, i) => { if (sh._vis !== false && S.sel.has(i)) drawShape(sh, i); });
    // Live edge-clip ghost preview for selected shapes extending outside image bounds
    if (!BOX()) {
      S.sel.forEach(i => {
        const sh = S.shapes[i];
        if (!sh || sh._vis === false) return;
        const fp = fittedPoints(sh);
        if (fp) {
          ctx.save();
          pathOf(fp, true);
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = "rgba(0, 229, 255, 0.75)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.restore();
        }
      });
    }
  }
  if (S.mode === "poly") {
    if (S.draft.length) drawDraft();
    drawPolyCursor();
  }
  if (S.mode === "box") drawBoxDraft();
  if (S.drag && S.drag.type === "multi") drawMultiPreview();
  if (S.drag && S.drag.type === "box") {
    const [a, b] = [S.drag.a, S.drag.b];
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
    const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
    const bw = x1 - x0, bh = y1 - y0;
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = "#4daafc";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0, y0, bw, bh);
    ctx.fillStyle = "rgba(77, 170, 252, 0.16)";
    ctx.fillRect(x0, y0, bw, bh);
    ctx.restore();
  }
  if (S.mode === "edit" && !S.hideAll) { drawSelBox(); drawSideHandles(S.drag && S.drag.type === "side" ? S.drag.h : S.hoverSide); }
  if (S.mode === "slice" && !S.hideAll) drawSlicePreview();
}
function pathOf(pts, closed) {
  ctx.beginPath();
  pts.forEach((p, k) => { const q = toScr(p); k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
  if (closed) ctx.closePath();
}
function drawShape(sh, i) {
  const pts = ptsOf(sh); if (!pts.length) return;
  const col = labelColor(sh.label || ""), bad = isBad(sh), sel = S.sel.has(i), hov = S.hover === i;
  const closed = isClosed(sh);
  pathOf(pts, closed);
  if (closed) { ctx.fillStyle = bad ? "rgba(255,60,60,.30)" : rgba(col, sel ? .38 : hov ? .28 : .16); ctx.fill(); }
  if (bad) {
    ctx.lineWidth = 3.5; ctx.strokeStyle = "#ff3b3b"; ctx.setLineDash([9, 5]); ctx.stroke(); ctx.setLineDash([]);
  } else {
    ctx.lineWidth = sel ? 2.5 : 1.6; ctx.strokeStyle = sel ? "#ffffff" : rgba(col, .95); ctx.stroke();
  }
  const vr = bad ? 5 : sel ? 4.5 : 3.2;
  pts.forEach((p, k) => {
    const q = toScr(p);
    const hv = S.hoverV && S.hoverV.s === i && S.hoverV.v === k;
    const sv = S.selV && S.selV.s === i && S.selV.v === k;
    ctx.beginPath();
    ctx.rect(q[0] - (hv || sv ? vr + 2 : vr), q[1] - (hv || sv ? vr + 2 : vr), (hv || sv ? vr + 2 : vr) * 2, (hv || sv ? vr + 2 : vr) * 2);
    ctx.fillStyle = sv ? "#ffd400" : hv ? "#ffffff" : bad ? "#ff3b3b" : sel ? "#ffffff" : rgba(col, 1);
    ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.stroke();
  });
  if (bad) {
    const c = toScr(centroid(pts)), txt = "⚠ " + badText(sh) + " (needs " + ROW_VERTS + ")";
    ctx.font = "600 12px Segoe UI, sans-serif"; const w = ctx.measureText(txt).width + 12;
    ctx.fillStyle = "rgba(160,20,20,.92)"; ctx.fillRect(c[0] - w / 2, c[1] - 11, w, 22);
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(txt, c[0], c[1] + 1);
    ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
  }
}
function drawPolyCursor() {
  if (S.mode !== "poly" || !S.cursor || !S.img || S.space || (S.drag && S.drag.type === "pan")) return;
  const q = toScr(S.cursor);
  const x = Math.round(q[0]) + 0.5, y = Math.round(q[1]) + 0.5;

  ctx.save();
  // 1. Full cross guiding lines across the viewport
  ctx.beginPath();
  ctx.moveTo(0, y); ctx.lineTo(S.cw, y);
  ctx.moveTo(x, 0); ctx.lineTo(x, S.ch);
  ctx.strokeStyle = "rgba(255, 60, 60, 0.40)";
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.stroke();

  // 2. Solid center crosshairs
  const arm = 14;
  ctx.beginPath();
  ctx.moveTo(x - arm, y); ctx.lineTo(x + arm, y);
  ctx.moveTo(x, y - arm); ctx.lineTo(x, y + arm);
  ctx.strokeStyle = "#ff3333";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.stroke();

  // 3. Mini red dot with crisp white border
  ctx.beginPath();
  ctx.arc(x, y, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = "#ff1e1e";
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();
}
function drawDraft() {
  const col = labelColor(S.label);
  const p1 = S.draft[0];
  const p2 = S.cursor || p1;

  if (p1 && p2 && (p1[0] !== p2[0] || p1[1] !== p2[1])) {
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
    const len = Math.hypot(dx, dy);
    if (len > 2) {
      const u = [dx / len, dy / len], v = [-u[1], u[0]];
      const hw = defaultRowWidth() / 2;
      const corners = [
        [p1[0] - v[0] * hw, p1[1] - v[1] * hw],
        [p1[0] + v[0] * hw, p1[1] + v[1] * hw],
        [p2[0] + v[0] * hw, p2[1] + v[1] * hw],
        [p2[0] - v[0] * hw, p2[1] - v[1] * hw],
      ];
      pathOf(corners, true);
      ctx.fillStyle = rgba(col, 0.22);
      ctx.fill();
      ctx.strokeStyle = rgba(col, 0.9);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      const q1 = toScr(p1), q2 = toScr(p2);
      ctx.beginPath();
      ctx.moveTo(q1[0], q1[1]);
      ctx.lineTo(q2[0], q2[1]);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  if (p1) {
    const q1 = toScr(p1);
    ctx.beginPath(); ctx.arc(q1[0], q1[1], 5, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff"; ctx.fill();
    ctx.strokeStyle = rgba(col, 1); ctx.lineWidth = 2; ctx.stroke();
  }
  if (p2 && p2 !== p1) {
    const q2 = toScr(p2);
    ctx.beginPath(); ctx.arc(q2[0], q2[1], 4, 0, Math.PI * 2);
    ctx.fillStyle = rgba(col, 1); ctx.fill();
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.stroke();
  }
}
function multiRects(a, b) {
  const { n, dir, gap } = S.multi, g = gap / 100;
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  const total = dir === "v" ? x1 - x0 : y1 - y0, w = total / (n + (n - 1) * g), out = [];
  for (let k = 0; k < n; k++) {
    const s0 = k * w * (1 + g), s1 = s0 + w;
    out.push(dir === "v" ? [[x0 + s0, y0], [x0 + s1, y0], [x0 + s1, y1], [x0 + s0, y1]]
                         : [[x0, y0 + s0], [x1, y0 + s0], [x1, y0 + s1], [x0, y0 + s1]]);
  }
  return out;
}
function drawMultiPreview() {
  const col = labelColor(S.label);
  for (const r of multiRects(S.drag.a, S.drag.b)) {
    pathOf(r, true); ctx.fillStyle = rgba(col, .25); ctx.fill(); ctx.strokeStyle = rgba(col, 1); ctx.lineWidth = 1.5; ctx.stroke();
  }
  const a = toScr(S.drag.a), b = toScr(S.drag.b);
  ctx.setLineDash([5, 4]); ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); ctx.setLineDash([]);
}
function selGeom() {
  const idx = [...S.sel].filter(i => S.shapes[i] && isClosed(S.shapes[i]) && S.shapes[i]._vis !== false);
  if (!idx.length) return null;
  const b = bboxOf(idx.map(i => ptsOf(S.shapes[i])));
  const c = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  const t0 = toScr([b.x0, b.y0]), t1 = toScr([b.x1, b.y1]);
  const handle = [(t0[0] + t1[0]) / 2, t0[1] - 30];
  return { idx, b, c, t0, t1, handle };
}
function drawSelBox() {
  const g = selGeom(); if (!g) return;
  ctx.setLineDash([4, 4]); ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = 1;
  ctx.strokeRect(g.t0[0] - 4, g.t0[1] - 4, g.t1[0] - g.t0[0] + 8, g.t1[1] - g.t0[1] + 8); ctx.setLineDash([]);
  if (BOX()) return; // boxes have no rotate handle
  ctx.beginPath(); ctx.moveTo(g.handle[0], g.t0[1] - 4); ctx.lineTo(g.handle[0], g.handle[1]); ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.stroke();
  ctx.beginPath(); ctx.arc(g.handle[0], g.handle[1], S.hoverHandle ? 9 : 7, 0, Math.PI * 2);
  ctx.fillStyle = S.hoverHandle ? "#ffd400" : "#4c9aff"; ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke();
  if (S.drag && S.drag.type === "rotate") {
    const deg = (S.drag.cur || 0) * 180 / Math.PI;
    let liveDir = "";
    const firstIdx = [...S.sel].find(i => S.shapes[i] && isClosed(S.shapes[i]));
    if (firstIdx !== undefined && typeof shapeAxisInfo === "function") {
      const info = shapeAxisInfo(S.shapes[firstIdx]);
      if (info && info.dir) liveDir = ` · ${info.dir}`;
    }
    const txt = `${deg >= 0 ? "+" : ""}${deg.toFixed(1)}°${liveDir}`;
    ctx.save();
    ctx.font = "600 12px Segoe UI, sans-serif";
    const tw = ctx.measureText(txt).width + 12;
    const rx = g.handle[0] + 13, ry = g.handle[1] - 10;
    ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(rx, ry, tw, 20, 5) : ctx.rect(rx, ry, tw, 20);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.fillText(txt, rx + 6, ry + 10);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- hit testing
function hitVertex(sx, sy) {
  const R = 8; let best = null, bd = R + 1;
  const order = [...S.sel, ...S.shapes.map((_, i) => i).reverse().filter(i => !S.sel.has(i))];
  for (const i of order) {
    const sh = S.shapes[i]; if (!sh || sh._vis === false || !isClosed(sh)) continue;
    ptsOf(sh).forEach((p, v) => { const q = toScr(p), d = Math.hypot(q[0] - sx, q[1] - sy); if (d < bd) { bd = d; best = { s: i, v }; } });
    if (best && S.sel.has(i)) return best;
  }
  return best;
}
function hitShape(ip) {
  const tol = 5 / S.view.s;
  for (let i = S.shapes.length - 1; i >= 0; i--) {
    const sh = S.shapes[i]; if (sh._vis === false) continue;
    const pts = ptsOf(sh);
    if (isClosed(sh) && pts.length >= 3 && inPoly(ip, pts)) return i;
    for (let k = 0; k < pts.length - (isClosed(sh) ? 0 : 1); k++) if (segDist(ip, pts[k], pts[(k + 1) % pts.length]) <= tol) return i;
  }
  return -1;
}
function hitHandle(sx, sy) { if (BOX()) return false; const g = selGeom(); return !!g && Math.hypot(g.handle[0] - sx, g.handle[1] - sy) <= 10; }

// Side handles: "u" = end handles on short edges (moves both endpoint vertices simultaneously),
// "v" = width handles on wider edges (adjusts row thickness).
const MAX_HANDLE_SHAPES = 60;
function sideHandles(i) {
  const sh = S.shapes[i], pts = ptsOf(sh); if (pts.length < 3) return [];
  if (isBoxShape(sh)) {
    const [[x0, y0], , [x1, y1]] = pts, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    return [["x+", [1, 0], [x1, cy]], ["x-", [-1, 0], [x0, cy]], ["y+", [0, 1], [cx, y1]], ["y-", [0, -1], [cx, y0]]]
      .filter(([, , pos]) => { const q = toScr(pos); return !pts.some(p => { const r = toScr(p); return Math.hypot(r[0] - q[0], r[1] - q[1]) < 14; }); })
      .map(([key, d, pos]) => ({ s: i, key, d, pos }));
  }
  const { c, u, v } = axisOf(pts), out = [];
  for (const [key, d] of [["u+", u], ["u-", [-u[0], -u[1]]], ["v+", v], ["v-", [-v[0], -v[1]]]]) {
    const pr = pts.map(p => (p[0] - c[0]) * d[0] + (p[1] - c[1]) * d[1]);
    let lo = Infinity, hi = -Infinity;
    for (const val of pr) { if (val < lo) lo = val; if (val > hi) hi = val; }
    const mid = (hi + lo) / 2;
    const verts = [];
    pr.forEach((val, k) => { if (val >= mid) verts.push(k); });
    if (!verts.length) continue;
    const pos = centroid(verts.map(k => pts[k]));
    out.push({ s: i, key, d, pos, verts });
  }
  return out;
}
function allSideHandles() {
  if (S.mode !== "edit" || S.hideAll) return [];
  const set = new Set([...S.sel].filter(i => S.shapes[i] && isClosed(S.shapes[i]) && S.shapes[i]._vis !== false));
  if (S.hover >= 0 && S.shapes[S.hover] && isClosed(S.shapes[S.hover]) && S.shapes[S.hover]._vis !== false) {
    set.add(S.hover);
  }
  const idx = [...set];
  return idx.length > MAX_HANDLE_SHAPES ? [] : idx.flatMap(sideHandles);
}
function hitSide(sx, sy) {
  let best = null, bd = 10;
  for (const h of allSideHandles()) { const q = toScr(h.pos), d = Math.hypot(q[0] - sx, q[1] - sy); if (d < bd) { bd = d; best = h; } }
  return best;
}
function sideCursor(d) {
  let a = Math.atan2(d[1], d[0]) * 180 / Math.PI; a = ((a % 180) + 180) % 180;
  return a < 22.5 || a >= 157.5 ? "ew-resize" : a < 67.5 ? "nwse-resize" : a < 112.5 ? "ns-resize" : "nesw-resize";
}
function magneticSnapPt(p, bypass = false) {
  if (bypass || !S.W || !S.H || !S.view.s) return { pt: [p[0], p[1]], edges: [] };
  const tol = 16 / S.view.s; // Always 16 screen px regardless of 8064x6048 resolution or zoom level
  let x = p[0], y = p[1];
  const edges = [];
  if (Math.abs(x) <= tol) { x = 0; edges.push("left"); }
  else if (Math.abs(x - S.W) <= tol) { x = S.W; edges.push("right"); }
  if (Math.abs(y) <= tol) { y = 0; edges.push("top"); }
  else if (Math.abs(y - S.H) <= tol) { y = S.H; edges.push("bottom"); }
  return { pt: [x, y], edges };
}

function applySideDrag(drag, ip, shiftKey, altKey) {
  S.snapEdges = null;
  if (isBoxShape(S.shapes[drag.h.s])) {
    const horiz = Math.abs(drag.h.d[0]) >= Math.abs(drag.h.d[1]), pos = horiz ? drag.h.d[0] > 0 : drag.h.d[1] > 0;
    const k = horiz ? 0 : 1;
    let t = horiz ? (ip[0] - drag.start[0]) * (pos ? 1 : -1) : (ip[1] - drag.start[1]) * (pos ? 1 : -1);
    for (const [i, src] of drag.snap) {
      let a = Math.min(src[0][k], src[1][k]), b = Math.max(src[0][k], src[1][k]);
      const ext = b - a; let tt = t;
      if (shiftKey) { if (ext + 2 * tt < 2) tt = (2 - ext) / 2; a -= tt; b += tt; }
      else { if (ext + tt < 2) tt = 2 - ext; if (pos) b += tt; else a -= tt; }
      const p = src.map(q => [q[0], q[1]]); p[0][k] = a; p[1][k] = b;
      S.shapes[i].points = p;
    }
    return;
  }
  // If dragging a width handle on the wider edges (v+ / v-): adjust row thickness
  if (drag.h.key[0] === "v") {
    for (const [i, src] of drag.snap) {
      if (src.length < 3) continue;
      const { c, v } = axisOf(src);
      const dir = (v[0] * drag.h.d[0] + v[1] * drag.h.d[1] >= 0) ? v : [-v[0], -v[1]];
      const pr = src.map(p => (p[0] - c[0]) * dir[0] + (p[1] - c[1]) * dir[1]);
      let lo = Infinity, hi = -Infinity;
      for (const val of pr) { if (val < lo) lo = val; if (val > hi) hi = val; }
      const ext = hi - lo;
      if (ext < 1e-6) continue;
      let tt = (ip[0] - drag.start[0]) * dir[0] + (ip[1] - drag.start[1]) * dir[1];
      const minExt = 3;
      if (shiftKey) {
        if (ext + 2 * tt < minExt) tt = (minExt - ext) / 2;
      } else {
        if (ext + tt < minExt) tt = minExt - ext;
      }
      const mid = (hi + lo) / 2;
      S.shapes[i].points = src.map((p, k) => {
        const w = shiftKey ? (pr[k] - mid) / (ext / 2) : (pr[k] - lo) / ext;
        return [p[0] + dir[0] * tt * w, p[1] + dir[1] * tt * w];
      });
    }
    return;
  }

  // If dragging an end handle on the short edges (u+ / u-): moves both endpoint vertices simultaneously
  const rawDx = ip[0] - drag.start[0];
  const rawDy = ip[1] - drag.start[1];
  for (const [i, src] of drag.snap) {
    if (src.length < 3) continue;
    const { c, u } = axisOf(src);
    const dir = (u[0] * drag.h.d[0] + u[1] * drag.h.d[1] >= 0) ? u : [-u[0], -u[1]];
    const pr = src.map(p => (p[0] - c[0]) * dir[0] + (p[1] - c[1]) * dir[1]);
    let lo = Infinity, hi = -Infinity;
    for (const val of pr) { if (val < lo) lo = val; if (val > hi) hi = val; }
    const mid = (hi + lo) / 2;
    const dragIdxs = [], fixedIdxs = [];
    pr.forEach((val, k) => {
      if (val >= mid) dragIdxs.push(k);
      else fixedIdxs.push(k);
    });
    if (!dragIdxs.length || !fixedIdxs.length) continue;
    const dragCenter0 = centroid(dragIdxs.map(k => src[k]));
    const fixedCenter0 = centroid(fixedIdxs.map(k => src[k]));
    const initLen = (dragCenter0[0] - fixedCenter0[0]) * dir[0] + (dragCenter0[1] - fixedCenter0[1]) * dir[1];
    let dx = rawDx, dy = rawDy;
    if (shiftKey) {
      const proj = rawDx * dir[0] + rawDy * dir[1];
      dx = proj * dir[0];
      dy = proj * dir[1];
    }
    const newLen = initLen + (dx * dir[0] + dy * dir[1]);
    if (newLen < 4) {
      const clampDist = 4 - initLen;
      const currentProj = dx * dir[0] + dy * dir[1];
      const diff = clampDist - currentProj;
      dx += diff * dir[0];
      dy += diff * dir[1];
    }
    const newPoints = src.map(p => [p[0], p[1]]);
    if (altKey) {
      dragIdxs.forEach(k => { newPoints[k] = [src[k][0] + dx, src[k][1] + dy]; });
      fixedIdxs.forEach(k => { newPoints[k] = [src[k][0] - dx, src[k][1] - dy]; });
    } else {
      dragIdxs.forEach(k => { newPoints[k] = [src[k][0] + dx, src[k][1] + dy]; });
      // Screen-space magnetic snap for dragged end edge (16px screen radius);
      // slides strictly along the row's own axis dir so diagonal angles never skew!
      const tol = S.view.s ? (16 / S.view.s) : 0;
      if (tol > 0 && S.W && S.H) {
        const endC = centroid(dragIdxs.map(k => newPoints[k]));
        let bestT = null, bestEdge = null, bestDist = tol + 1;
        const tryBorder = (edgeName, coordIdx, borderVal) => {
          const dist = Math.abs(endC[coordIdx] - borderVal);
          if (dist <= tol && dist < bestDist) {
            const dComp = dir[coordIdx];
            if (Math.abs(dComp) > 0.25) {
              const tSnap = (borderVal - endC[coordIdx]) / dComp;
              if (Math.abs(tSnap) <= tol * 2.2) {
                bestDist = dist;
                bestT = tSnap;
                bestEdge = edgeName;
              }
            }
          }
        };
        tryBorder("left", 0, 0);
        tryBorder("right", 0, S.W);
        tryBorder("top", 1, 0);
        tryBorder("bottom", 1, S.H);
        if (bestEdge !== null && bestT !== null) {
          const sdx = dir[0] * bestT, sdy = dir[1] * bestT;
          dragIdxs.forEach(k => { newPoints[k] = [newPoints[k][0] + sdx, newPoints[k][1] + sdy]; });
          if (!S.snapEdges) S.snapEdges = new Set();
          S.snapEdges.add(bestEdge);
        }
      }
    }
    S.shapes[i].points = newPoints;
  }
}
function drawSideHandles(hover) {
  const handles = allSideHandles();
  if (hover) {
    const sh = S.shapes[hover.s];
    if (sh && hover.verts && hover.verts.length >= 2) {
      const pts = ptsOf(sh);
      if (pts[hover.verts[0]] && pts[hover.verts[1]]) {
        const p1 = toScr(pts[hover.verts[0]]), p2 = toScr(pts[hover.verts[1]]);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.strokeStyle = "#ffd400";
        ctx.lineWidth = 3.5;
        ctx.stroke();
        ctx.restore();
      }
    }
  }
  for (const h of handles) {
    const q = toScr(h.pos), on = hover && hover.s === h.s && hover.key === h.key;
    const ang = Math.atan2(h.d[1], h.d[0]), L = on ? 10 : 8, W = on ? 5 : 4;
    ctx.save(); ctx.translate(q[0], q[1]); ctx.rotate(ang);
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(-W, -L, W * 2, L * 2, 3) : ctx.rect(-W, -L, W * 2, L * 2);
    ctx.fillStyle = on ? "#ffd400" : "#ffffff";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = on ? "#d48800" : "#2f6fd1";
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -L + 3);
    ctx.lineTo(0, L - 3);
    ctx.strokeStyle = on ? "#946200" : "#8ab4f8";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
}

// ---------------------------------------------------------------- undo / dirty
function snapshot(extra = null) {
  const snap = S.shapes.map(s => ({ ...s, points: s.points.map(p => [p[0], p[1]]) }));
  if (extra && typeof extra === "object") Object.assign(snap, extra);
  return snap;
}
function pushUndo(tag) {
  const now = Date.now();
  if (tag && tag === S.lastTag && now - S.lastTagT < 800) { S.lastTagT = now; return; }
  S.lastTag = tag || null; S.lastTagT = now;
  S.undo.push(snapshot()); if (S.undo.length > 200) S.undo.shift(); S.redo = [];
}

function updateFolderInfo() {
  if (!S.files || !S.files.length) return;
  const nj = S.files.filter(f => f.json).length, nb = S.files.filter(f => f.bad > 0).length;
  const info = $("#folderInfo");
  if (info) info.textContent = `${S.files.length} images · ${nj} with JSON` + (nb ? ` · ${nb} need fixing` : "");
}

function performDeleteJson(f) {
  clearTimeout(S.saveTimer);
  S.saveTimer = null;
  S.dirty = false;

  const jsonName = (f.json && f.json.name) || (stem(f.name) + ".json");
  f.json = null;
  S.shapes = [];
  S.draft = [];
  S.sel = new Set();
  S.selV = null;
  S.hover = -1;
  S.hoverV = null;
  S.hoverSide = null;
  S.hoverHandle = null;
  setFileStats(f, []);
  if (typeof unrecordImageDone === "function") unrecordImageDone(f);
  setSave("none");
  updateFolderInfo();
  rebuildLabels();
  renderFiles();
  refreshAll();

  S.chain = S.chain.then(async () => {
    try {
      if (f.dir) await f.dir.removeEntry(jsonName);
    } catch (e) {
      if (e.name !== "NotFoundError") console.warn("Could not remove JSON file:", e);
    }
    f.json = null;
    renderFiles();
  });
  return S.chain;
}

async function deleteCurrentJson() {
  const f = S.files[S.idx];
  if (!f) return toast("No image loaded", 2000);
  if (!f.json && !S.shapes.length) {
    return toast("No JSON or annotations to delete for this image", 2000);
  }

  // Save current shapes & JSON state in undo
  const prevShapes = snapshot();
  const snapBefore = snapshot({
    _jsonAction: "delete",
    _prevShapes: prevShapes,
    _hadJson: !!f.json
  });
  S.undo.push(snapBefore);
  if (S.undo.length > 200) S.undo.shift();
  S.redo = [];
  S.lastTag = null;

  performDeleteJson(f);
  await S.chain;
  toast(`Deleted JSON for ${stem(f.name)}.json (Ctrl+Z to undo)`, 3500);
}

function undo() {
  if (!S.undo.length) return;
  const snap = S.undo.pop();
  if (snap && snap._jsonAction === "delete") {
    // Redo entry
    const redoSnap = snapshot({ _jsonAction: "redoDelete" });
    S.redo.push(redoSnap);

    // Restore previous shapes
    const restored = (snap._prevShapes || snap).map(s => ({ ...s, points: s.points.map(p => [p[0], p[1]]) }));
    S.shapes = restored;
    S.sel = new Set();
    S.selV = null;

    afterHistory();
    save(); // immediately recreate and write JSON file
    const f = S.files[S.idx];
    updateFolderInfo();
    const fName = f ? stem(f.name) + ".json" : "JSON";
    toast(`Restored ${fName}`, 2500);
    return;
  }

  S.redo.push(snapshot());
  S.shapes = snap;
  afterHistory();
}

function redo() {
  if (!S.redo.length) return;
  const snap = S.redo.pop();
  if (snap && snap._jsonAction === "redoDelete") {
    const f = S.files[S.idx];
    const prevShapes = snapshot();
    const undoSnap = snapshot({
      _jsonAction: "delete",
      _prevShapes: prevShapes,
      _hadJson: f ? !!f.json : true
    });
    S.undo.push(undoSnap);
    if (S.undo.length > 200) S.undo.shift();

    if (f) performDeleteJson(f);
    const fName = f ? stem(f.name) + ".json" : "JSON";
    toast(`Redid: Deleted ${fName}`, 2500);
    return;
  }

  S.undo.push(snapshot());
  S.shapes = snap;
  afterHistory();
}
function afterHistory() { S.lastTag = null; S.sel = new Set([...S.sel].filter(i => i < S.shapes.length)); S.selV = null; markDirty(); }
function markDirty() {
  S.dirty = true; setSave("unsaved");
  clearTimeout(S.saveTimer); S.saveTimer = setTimeout(save, 700);
  refreshAll();
}

// ---------------------------------------------------------------- saving (AnyLabeling JSON next to the image)
function setFileStats(f, shapes) {
  f.count = shapes.length; f.err = false;
  f.badRow = shapes.filter(s => isBadIn(s, false)).length; f.badBox = shapes.filter(s => isBadIn(s, true)).length;
  f.bad = BOX() ? f.badBox : f.badRow;
  f.labels = new Map(); shapes.forEach(s => f.labels.set(s.label, (f.labels.get(s.label) || 0) + 1));
}
function buildJson() {
  const f = S.files[S.idx];
  const shapes = S.shapes.map(({ _vis, _master, _manualLabel, ...r }) => {
    const raw = fittedPoints(r, false) || r.points;
    let pts = raw.map(p => [r2(p[0]), r2(p[1])]);
    if (r.shape_type === "rectangle" && pts.length === 4) {
      const p = rectPts({ points: pts, shape_type: "rectangle" });
      pts = [[r2(p[0][0]), r2(p[0][1])], [r2(p[2][0]), r2(p[2][1])]];
    }
    return { ...r, points: pts };
  });
  return { ...(S.data || {}), shapes, imagePath: (S.data && S.data.imagePath) || f.name, imageData: null, imageHeight: S.H, imageWidth: S.W };
}
function save() {
  clearTimeout(S.saveTimer); S.saveTimer = null;
  if (!S.dirty || S.idx < 0) return S.chain;
  const f = S.files[S.idx], text = JSON.stringify(buildJson(), null, 2);
  S.dirty = false; S.pending++; setSave("saving");
  S.chain = S.chain.then(async () => {
    try {
      if (!f.json) f.json = await f.dir.getFileHandle(stem(f.name) + ".json", { create: true });
      const w = await f.json.createWritable(); await w.write(text); await w.close();
      S.pending--; if (!S.pending && !S.dirty) {
        setSave("saved");
        setFileStats(f, S.shapes);
        renderFiles();
        if (S.shapes.length > 0) recordImageDone(f);
      }
    } catch (e) {
      S.pending--; if (f === S.files[S.idx]) S.dirty = true;
      setSave("error", e.message); toast("Could not save " + stem(f.name) + ".json: " + e.message, 6000);
    }
  });
  return S.chain;
}
async function flush() { if (S.dirty) save(); await S.chain; }
function fitAndSave(quiet, explicitSave = false) {
  if (S.idx < 0) return S.chain;
  const checkSlivers = explicitSave || S.dirty;
  if (S.shapes.some(s => fittedPoints(s, checkSlivers))) {
    pushUndo(); const n = fitAll(checkSlivers); S.dirty = true;
    if (!quiet) toast(`${n} segment${n > 1 ? "s" : ""} fitted inside the image`);
    refreshAll();
  }
  return S.dirty ? save() : S.chain;
}
function saveNow() { if (S.idx < 0) return; S.dirty = true; fitAndSave(false, true); }
function setSave(st, msg) {
  const el = $("#saveState"); el.className = st;
  el.textContent = st === "saved" ? "✓ Saved " + new Date().toLocaleTimeString() : st === "saving" ? "Saving…"
    : st === "unsaved" ? "● Unsaved changes" : st === "error" ? "✖ Save failed: " + msg : "No changes";
}
// Prevent accidental tab closure via Ctrl+W (common left-hand shortcut conflict with W)
window.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && (e.key === "w" || e.key === "W" || e.code === "KeyW" || e.keyCode === 87)) {
    e.preventDefault();
    e.stopPropagation();
    toast("Ctrl+W tab close disabled");
    return false;
  }
}, { capture: true });
window.addEventListener("beforeunload", e => {
  if (S.dirty || S.pending) save();
  if (S.files && S.files.length) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// ---------------------------------------------------------------- folder handle persistence (IndexedDB)
const IDB_NAME = "RowLabelerDB", IDB_STORE = "handles", IDB_KEY = "lastDirHandle", IDB_WS_KEY = "lastWorkspaceHandle";
function openIDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("IndexedDB not supported"));
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function saveDirHandle(handle) {
  try {
    const db = await openIDB();
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch (e) {
    console.warn("Could not save dir handle in IDB", e);
  }
}
async function getSavedDirHandle() {
  try {
    const db = await openIDB();
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    return await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => rej(req.error);
    });
  } catch (e) {
    return null;
  }
}
async function saveWorkspaceHandle(handle) {
  try {
    const db = await openIDB();
    const tx = db.transaction(IDB_STORE, "readwrite");
    if (handle) tx.objectStore(IDB_STORE).put(handle, IDB_WS_KEY);
    else tx.objectStore(IDB_STORE).delete(IDB_WS_KEY);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch (e) {
    console.warn("Could not save workspace handle in IDB", e);
  }
}
async function getSavedWorkspaceHandle() {
  try {
    const db = await openIDB();
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(IDB_WS_KEY);
    return await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => rej(req.error);
    });
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------- timers & active time tracking
let dailySeconds = 0;
let blockSeconds = 0;
let imgSeconds = 0;
let imgStartTimestamp = Date.now();
let lastActiveTime = Date.now();
let lastTickTime = Date.now();
let isTabActive = false;
let isWindowFocused = document.hasFocus();
let isTabVisible = document.visibilityState === "visible" && !document.hidden;
let isUserIdle = false;
const IDLE_TIMEOUT_MS = 60000; // 60s idle timeout
let timerTick = 0;

function getTodayKey() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `worktime.${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatTimer(sec, forceHours = false) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = n => String(n).padStart(2, "0");
  if (forceHours || h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

function formatDuration(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || h > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ") || "0s";
}

function updateTimerDisplay() {
  const elWork = $("#workTimerText");
  if (elWork) elWork.textContent = formatTimer(dailySeconds, true);
  const elImg = $("#imgTimerText");
  if (elImg) elImg.textContent = formatTimer(imgSeconds);
  const elBlock = $("#blockTimerText");
  if (elBlock) elBlock.textContent = formatTimer(blockSeconds);
}

function showImageTimeBoom(sec) {
  sec = Math.max(0, Math.round(sec));
  if (sec <= 0) return;
  const stage = $("#stage");
  if (!stage) return;

  const existing = $("#imageTimeBoom");
  if (existing) existing.remove();

  const isMulti = sec >= 60;
  const subLabel = sec === 1 ? "SEC" : "SECS";
  const numFontSize = sec >= 1000 ? 32 : sec >= 100 ? 38 : 44;
  const numY = isMulti ? 97 : 104;
  const formatted = formatDuration(sec);

  const wrapper = document.createElement("div");
  wrapper.id = "imageTimeBoom";
  wrapper.className = "image-time-boom";
  wrapper.setAttribute("aria-hidden", "true");

  wrapper.innerHTML = `
    <svg width="180" height="190" viewBox="0 0 180 190" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;filter:drop-shadow(0 14px 30px rgba(0,0,0,0.65))">
      <!-- Top Twin Bells Skeleton -->
      <!-- Left Bell & Bracket -->
      <path d="M 26 44 C 18 20, 52 14, 62 34" stroke="#94a3b8" stroke-width="3" stroke-linecap="round" fill="none"/>
      <line x1="34" y1="45" x2="42" y2="52" stroke="#64748b" stroke-width="2.5" stroke-linecap="round"/>
      
      <!-- Right Bell & Bracket -->
      <path d="M 154 44 C 162 20, 128 14, 118 34" stroke="#94a3b8" stroke-width="3" stroke-linecap="round" fill="none"/>
      <line x1="146" y1="45" x2="138" y2="52" stroke="#64748b" stroke-width="2.5" stroke-linecap="round"/>

      <!-- Top Snooze / Hammer Bar -->
      <path d="M 76 25 L 104 25" stroke="#94a3b8" stroke-width="3.5" stroke-linecap="round"/>
      <line x1="83" y1="25" x2="83" y2="38" stroke="#64748b" stroke-width="2.5"/>
      <line x1="97" y1="25" x2="97" y2="38" stroke="#64748b" stroke-width="2.5"/>

      <!-- Bottom Peg Feet / Legs -->
      <line x1="38" y1="162" x2="22" y2="182" stroke="#94a3b8" stroke-width="4" stroke-linecap="round"/>
      <line x1="142" y1="162" x2="158" y2="182" stroke="#94a3b8" stroke-width="4" stroke-linecap="round"/>

      <!-- Square Clock Body Outer Skeleton -->
      <rect x="22" y="38" width="136" height="126" rx="20" fill="rgba(15, 23, 42, 0.92)" stroke="#94a3b8" stroke-width="3.5"/>

      <!-- Inner Skeleton Dashed Dial Frame -->
      <rect x="31" y="47" width="118" height="108" rx="13" fill="none" stroke="rgba(148, 163, 184, 0.35)" stroke-width="1.5" stroke-dasharray="4 3"/>

      <!-- Dial Corner Accent Markers -->
      <circle cx="40" cy="56" r="2" fill="#64748b"/>
      <circle cx="140" cy="56" r="2" fill="#64748b"/>
      <circle cx="40" cy="146" r="2" fill="#64748b"/>
      <circle cx="140" cy="146" r="2" fill="#64748b"/>

      <!-- Centered Time Digits & Label -->
      <text x="90" y="${numY}" text-anchor="middle" font-family="'Inter', system-ui, -apple-system, sans-serif" font-size="${numFontSize}" font-weight="800" fill="#f8fafc" letter-spacing="-1">${sec}</text>
      <text x="90" y="${isMulti ? 117 : 128}" text-anchor="middle" font-family="'Inter', system-ui, -apple-system, sans-serif" font-size="13" font-weight="700" fill="#94a3b8" letter-spacing="3">${subLabel}</text>
      ${isMulti ? `<text x="90" y="137" text-anchor="middle" font-family="'Inter', system-ui, -apple-system, sans-serif" font-size="11" font-weight="600" fill="#64748b">(${formatted})</text>` : ''}
    </svg>
  `;

  stage.appendChild(wrapper);

  setTimeout(() => {
    if (wrapper.parentElement) wrapper.remove();
  }, 3500);
}

function saveTimers() {
  const today = getTodayDateStr();
  store(getTodayKey(), dailySeconds);
  if (S.root) store("blocktime." + S.root.name, blockSeconds);
  const stats = getDailyStats(today);
  stats.timeSeconds = dailySeconds;
  saveDailyStats(stats, today);
}

// ---------------------------------------------------------------- daily report card & progress tracking
function getTodayDateStr() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function normalizeStatImageKey(rawKey) {
  if (!rawKey || typeof rawKey !== "string") return "";
  const parts = rawKey.replace(/\\/g, "/").split("/").filter(Boolean);
  const filePart = parts.pop() || "";
  const baseStem = stem(filePart).toLowerCase();
  if (!baseStem) return "";
  const folderPart = (parts.pop() || "").toLowerCase();
  return folderPart ? `${folderPart}/${baseStem}` : baseStem;
}

function getFileStatKey(file) {
  if (!file) return "";
  const folder = (file.rel ? file.rel.split("/").pop() : (S.root ? S.root.name : "")).toLowerCase();
  const baseStem = stem(file.name).toLowerCase();
  return folder ? `${folder}/${baseStem}` : baseStem;
}

function sanitizeDailyStatsObj(st) {
  if (!st || !Array.isArray(st.images)) return false;
  const seen = new Set();
  const deduped = [];
  let changed = false;
  for (const raw of st.images) {
    const norm = normalizeStatImageKey(raw);
    if (!norm) { changed = true; continue; }
    if (norm !== raw) changed = true;
    if (!seen.has(norm)) {
      seen.add(norm);
      deduped.push(norm);
    } else {
      changed = true;
    }
  }
  if (changed) st.images = deduped;
  return changed;
}

function sanitizeAllDailyStats() {
  const all = recall("dailyStats", {});
  let anyChanged = false;
  for (const k of Object.keys(all)) {
    if (sanitizeDailyStatsObj(all[k])) anyChanged = true;
  }
  if (anyChanged) store("dailyStats", all);
  return all;
}

function getDailyStats(dateStr = getTodayDateStr()) {
  const all = sanitizeAllDailyStats();
  if (!all[dateStr]) {
    all[dateStr] = {
      date: dateStr,
      timeSeconds: 0,
      images: [],
      blocks: [],
      lastUpdated: Date.now()
    };
  }
  return all[dateStr];
}

function saveDailyStats(stats, dateStr = getTodayDateStr()) {
  const all = recall("dailyStats", {});
  sanitizeDailyStatsObj(stats);
  all[dateStr] = { ...stats, lastUpdated: Date.now() };
  store("dailyStats", all);
}

function recordImageDone(file) {
  if (!file || !S.root) return;
  const key = getFileStatKey(file);
  if (!key) return;
  const today = getTodayDateStr();
  const stats = getDailyStats(today);
  if (!stats.images.includes(key)) {
    stats.images.push(key);
    stats.timeSeconds = Math.max(stats.timeSeconds, dailySeconds);
    saveDailyStats(stats, today);
  }
}

function unrecordImageDone(file) {
  if (!file || !S.root) return;
  const key = getFileStatKey(file);
  if (!key) return;
  const today = getTodayDateStr();
  const stats = getDailyStats(today);
  const idx = stats.images.indexOf(key);
  if (idx >= 0) {
    stats.images.splice(idx, 1);
    saveDailyStats(stats, today);
  }
}

function recordBlockDone(folderName) {
  if (!folderName) return;
  const today = getTodayDateStr();
  const stats = getDailyStats(today);
  if (!stats.blocks.includes(folderName)) {
    stats.blocks.push(folderName);
  }
  stats.timeSeconds = Math.max(stats.timeSeconds, dailySeconds);
  saveDailyStats(stats, today);
}

function openReport() {
  const today = getTodayDateStr();
  const stats = getDailyStats(today);

  // 1. Header Date
  const dObj = new Date();
  const dateOpts = { weekday: "short", month: "short", day: "numeric", year: "numeric" };
  const dateBadge = $("#repDateBadge");
  if (dateBadge) dateBadge.textContent = dObj.toLocaleDateString(undefined, dateOpts);

  // 2. Active Work Time
  const workSec = dailySeconds;
  const repWork = $("#repWorkTime"), repWorkSub = $("#repWorkTimeSub");
  if (repWork) repWork.textContent = formatDuration(workSec);
  if (repWorkSub) repWorkSub.textContent = `${formatTimer(workSec, true)} active today`;

  // 3. Images Completed
  const imgCount = stats.images.length;
  const repImgs = $("#repImagesDone"), repImgsSub = $("#repImagesSub");
  if (repImgs) repImgs.textContent = imgCount;
  if (repImgsSub) repImgsSub.textContent = `${imgCount} unique image${imgCount === 1 ? "" : "s"} done`;

  // 4. Blocks Completed
  const blkCount = stats.blocks.length;
  const repBlks = $("#repBlocksDone"), repBlksSub = $("#repBlocksSub");
  if (repBlks) repBlks.textContent = blkCount;
  if (repBlksSub) repBlksSub.textContent = blkCount > 0 ? stats.blocks.join(", ") : "No uploads yet today";

  // 5. Average Pace
  const repPace = $("#repPace"), repPaceSub = $("#repPaceSub");
  if (imgCount > 0 && workSec > 0) {
    const avgSec = Math.round(workSec / imgCount);
    const imgPerHour = Math.round((imgCount / (workSec / 3600)) * 10) / 10;
    if (repPace) repPace.textContent = `${formatDuration(avgSec)}`;
    if (repPaceSub) repPaceSub.textContent = `~${imgPerHour} images / hr`;
  } else {
    if (repPace) repPace.textContent = "–";
    if (repPaceSub) repPaceSub.textContent = "Start labeling to see pace";
  }

  // 6. Current Folder Status
  const curSect = $("#repCurrentBlockSect");
  if (curSect) {
    if (S.root && S.files.length) {
      curSect.style.display = "block";
      const curFolderNm = $("#repCurFolderName");
      if (curFolderNm) curFolderNm.textContent = S.root.name;
      const labeledCount = S.files.filter(f => f.json && f.count > 0).length;
      const totalCount = S.files.length;
      const pct = totalCount ? Math.round((labeledCount / totalCount) * 100) : 0;
      const curStats = $("#repCurFolderStats");
      if (curStats) curStats.textContent = `${labeledCount} / ${totalCount} images (${pct}%)`;
      const curBar = $("#repCurFolderBar");
      if (curBar) curBar.style.width = pct + "%";
      const curTime = $("#repCurFolderTime");
      if (curTime) curTime.textContent = `Time on block: ${formatDuration(blockSeconds)}`;
      const badCount = S.files.filter(f => f.bad > 0).length;
      const curStatus = $("#repCurFolderStatus");
      if (curStatus) {
        curStatus.textContent = badCount ? `⚠ ${badCount} image(s) to fix` : "✓ All clean";
        curStatus.style.color = badCount ? "var(--bad)" : "var(--ok)";
      }
    } else {
      curSect.style.display = "none";
    }
  }

  // 7. Recent History (Past 7 Days)
  const allStats = sanitizeAllDailyStats();
  const dates = Object.keys(allStats).sort().reverse().slice(0, 7);
  if (!dates.includes(today)) dates.unshift(today);
  const rowsEl = $("#repHistoryRows");
  if (rowsEl) {
    const rows = dates.map(d => {
      const st = allStats[d] || { timeSeconds: 0, images: [], blocks: [] };
      const isToday = d === today;
      const time = isToday ? dailySeconds : (st.timeSeconds || 0);
      const nImg = (st.images || []).length;
      const nBlk = (st.blocks || []).length;
      const pace = nImg > 0 && time > 0 ? `${formatDuration(Math.round(time / nImg))}/img` : "–";
      return `<tr class="${isToday ? 'today' : ''}">
        <td>${isToday ? '<b>Today</b> (' + d + ')' : d}</td>
        <td>${formatDuration(time)}</td>
        <td><b>${nImg}</b></td>
        <td><b>${nBlk}</b></td>
        <td>${pace}</td>
      </tr>`;
    }).join("");
    rowsEl.innerHTML = rows || `<tr><td colspan="5" class="muted" style="text-align:center;padding:12px">No history recorded yet</td></tr>`;
  }

  const dlg = $("#dlgReport");
  if (dlg) dlg.showModal();
  checkTabActive();
}

function copyReportSummary() {
  const today = getTodayDateStr();
  const stats = getDailyStats(today);
  const workSec = dailySeconds;
  const imgCount = stats.images.length;
  const blkCount = stats.blocks.length;
  const pace = imgCount > 0 && workSec > 0 ? `${formatDuration(Math.round(workSec / imgCount))} / img (~${Math.round((imgCount / (workSec / 3600)) * 10) / 10} img/hr)` : "–";

  const lines = [
    `📊 LabelLite Daily Report (${today})`,
    `─────────────────────────────────`,
    `⏱ Active Work Time: ${formatDuration(workSec)} (${formatTimer(workSec, true)})`,
    `🖼 Images Completed: ${imgCount}`,
    `📦 Blocks Completed: ${blkCount}${blkCount > 0 ? " (" + stats.blocks.join(", ") + ")" : ""}`,
    `⚡ Average Pace: ${pace}`,
    S.root ? `📁 Current Folder: ${S.root.name} (${S.files.filter(f => f.json && f.count > 0).length}/${S.files.length} labeled)` : ``,
    `─────────────────────────────────`
  ].filter(Boolean).join("\n");

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(lines).then(() => {
      toast("Report summary copied to clipboard! ✓");
    }).catch(() => {
      toast("Could not copy automatically. Check permissions.");
    });
  } else {
    toast("Clipboard API not available.");
  }
}

function loadBlockTime(folderName) {
  blockSeconds = recall("blocktime." + folderName, 0);
  updateTimerDisplay();
}

let lastPauseReason = null;
function getTimerPauseReason() {
  if (!S.root || !S.files || !S.files.length || !S.img || S.idx < 0) {
    return S.folderDone ? "DONE" : "NO FOLDER";
  }
  const dlgUp = $("#dlgUp");
  if (S.folderDone || (dlgUp && dlgUp.open)) {
    return "DONE";
  }
  const dlgRep = $("#dlgReport");
  if (dlgRep && dlgRep.open) {
    return "PAUSED";
  }
  if (!isWindowFocused || !document.hasFocus() || !isTabVisible || document.hidden || isUserIdle) {
    return "PAUSED";
  }
  return null;
}

function setTimerActive(active, reason = "PAUSED") {
  isTabActive = active;
  lastPauseReason = active ? null : reason;
  const badge = $("#workTimer");
  const icon = $("#workTimerIcon");
  const status = $("#workTimerStatus");
  if (badge) {
    badge.classList.toggle("paused", !isTabActive);
    if (isTabActive) {
      badge.title = "Today's active working time (running) — click to view Report Card";
    } else if (reason === "NO FOLDER") {
      badge.title = "Today's active working time (PAUSED: open a folder to start timer) — click to view Report Card";
    } else if (reason === "DONE") {
      badge.title = "Today's active working time (PAUSED: folder done, open next folder to resume) — click to view Report Card";
    } else {
      badge.title = "Today's active working time (PAUSED: focus loss or idle) — click to view Report Card";
    }
  }
  if (icon) {
    icon.textContent = isTabActive ? "schedule" : "pause_circle";
  }
  if (status) {
    status.textContent = isTabActive ? "" : "PAUSED";
  }
  const imgTimer = $("#fImageTimer");
  if (imgTimer) imgTimer.style.opacity = isTabActive ? "1" : "0.55";
  const blkTimer = $("#fBlockTimer");
  if (blkTimer) blkTimer.style.opacity = isTabActive ? "1" : "0.55";
}

function checkTabActive() {
  const idle = (Date.now() - lastActiveTime) >= IDLE_TIMEOUT_MS;
  isUserIdle = idle;

  const reason = getTimerPauseReason();
  const active = reason === null;

  if (active !== isTabActive || reason !== lastPauseReason) {
    setTimerActive(active, reason || "PAUSED");
  }
  return isTabActive;
}

function recordActivity() {
  // Only record activity if the window actually has focus and tab is visible
  if (!isWindowFocused || !isTabVisible) return;
  lastActiveTime = Date.now();
  if (isUserIdle) {
    isUserIdle = false;
    lastTickTime = Date.now();
    checkTabActive();
  }
}

// Activity listeners
window.addEventListener("pointerdown", recordActivity, { passive: true });
window.addEventListener("keydown", recordActivity, { passive: true });
window.addEventListener("wheel", recordActivity, { passive: true });
let lastMoveRecord = 0;
window.addEventListener("pointermove", () => {
  const now = Date.now();
  if (now - lastMoveRecord > 500) {
    lastMoveRecord = now;
    recordActivity();
  }
}, { passive: true });

// Window & tab event listeners:
// 1. Focus gained
window.addEventListener("focus", () => {
  isWindowFocused = true;
  isTabVisible = document.visibilityState === "visible" && !document.hidden;
  lastActiveTime = Date.now();
  lastTickTime = Date.now();
  checkTabActive();
});

// 2. Focus lost (clicking another window, desktop, or application)
window.addEventListener("blur", () => {
  isWindowFocused = false;
  checkTabActive();
});

// 3. Tab visibility changed (tab switch or window minimized)
document.addEventListener("visibilitychange", () => {
  const visible = document.visibilityState === "visible" && !document.hidden;
  isTabVisible = visible;
  if (!visible) {
    isWindowFocused = false;
    checkTabActive();
  } else {
    isWindowFocused = document.hasFocus();
    lastActiveTime = Date.now();
    lastTickTime = Date.now();
    checkTabActive();
  }
});

// 4. Page hide / freeze
window.addEventListener("pagehide", () => {
  isTabVisible = false;
  isWindowFocused = false;
  checkTabActive();
});

// 5. Page show / unfreeze
window.addEventListener("pageshow", () => {
  isTabVisible = document.visibilityState === "visible" && !document.hidden;
  isWindowFocused = document.hasFocus();
  lastActiveTime = Date.now();
  lastTickTime = Date.now();
  checkTabActive();
});

function initTimers() {
  sanitizeAllDailyStats();
  dailySeconds = recall(getTodayKey(), 0);
  isWindowFocused = document.hasFocus();
  isTabVisible = document.visibilityState === "visible" && !document.hidden;
  lastActiveTime = Date.now();
  lastTickTime = Date.now();
  checkTabActive();
  updateTimerDisplay();

  setInterval(() => {
    if (checkTabActive()) {
      dailySeconds++;
      if (S.root) blockSeconds++;
      if (S.img && S.idx >= 0) imgSeconds++;
    }
    updateTimerDisplay();
    if (++timerTick >= 5) {
      timerTick = 0;
      saveTimers();
    }
  }, 1000);
}

// ---------------------------------------------------------------- folder + files + Workspace Block Queue
function extractBlockId(folderName) {
  const s = String(folderName || "").trim();
  const m = s.match(/^([A-Za-z]+\d+)/);
  if (m) return m[1].toUpperCase();
  const parts = s.split("_");
  return parts[0] || s;
}

function extractBlockNumber(folderName) {
  const s = String(folderName || "").trim();
  const m = s.match(/^[A-Za-z]+0*(\d+)/);
  if (m) return parseInt(m[1], 10);
  const m2 = s.match(/^0*(\d+)/);
  if (m2) return parseInt(m2[1], 10);
  return extractBlockId(s);
}

async function inspectBlockDir(dirHandle) {
  let imgCount = 0, jsonCount = 0, hasZip = false, zipName = null;
  async function scan(d, depth) {
    for await (const [name, h] of d.entries()) {
      if (h.kind === "directory") {
        if (depth < 2 && !name.startsWith(".")) await scan(h, depth + 1);
      } else if (IMG_RE.test(name)) {
        imgCount++;
      } else if (/\.json$/i.test(name)) {
        jsonCount++;
      } else if (/_jsons\.zip$/i.test(name)) {
        hasZip = true;
        zipName = name;
      }
    }
  }
  try { await scan(dirHandle, 0); } catch (e) {}
  const status = imgCount > 0 ? "pending" : hasZip ? "done" : "empty";
  return { imgCount, jsonCount, hasZip, zipName, status };
}

function updateNextBlockButtons() {
  const btnUp = $("#btnNextBlockUp"), txtUp = $("#btnNextBlockUpTxt");
  const btnEmp = $("#btnNextBlockEmpty"), txtEmp = $("#btnNextBlockEmptyTxt");
  if (!S.workspace || !S.workspace.root) {
    if (btnUp) btnUp.style.display = "none";
    if (btnEmp) btnEmp.style.display = "none";
    return null;
  }
  const curName = S.workspace.currentName || (S.root && S.root.name) || "";
  const pending = S.workspace.blocks.filter(b => b.status === "pending" && b.name !== curName);
  let nextB = null;
  if (pending.length) {
    nextB = pending.find(b => natCmp(b.name, curName) > 0) || pending[0];
  }
  if (nextB) {
    const label = `Open Next Block → ${nextB.blockId} (${nextB.imgCount} img)`;
    if (txtUp) txtUp.textContent = label;
    if (txtEmp) txtEmp.textContent = label;
    if (btnUp && S.folderDone) btnUp.style.display = "";
    if (btnEmp && (!S.files || !S.files.length)) btnEmp.style.display = "";
  } else {
    if (btnUp) btnUp.style.display = "none";
    if (btnEmp) btnEmp.style.display = "none";
  }
  return nextB;
}

function renderWorkspaceQueue() {
  const sect = $("#wsQueueSect");
  if (!sect) return;
  if (!S.workspace || !S.workspace.root) {
    sect.style.display = "none";
    updateNextBlockButtons();
    return;
  }
  sect.style.display = "";
  const wsNameEl = $("#wsName");
  if (wsNameEl) wsNameEl.textContent = S.workspace.root.name;

  const pending = S.workspace.blocks.filter(b => b.status === "pending");
  const done = S.workspace.blocks.filter(b => b.status === "done");
  const pCnt = $("#wsPendingCnt"), dCnt = $("#wsDoneCnt");
  if (pCnt) pCnt.textContent = pending.length;
  if (dCnt) dCnt.textContent = done.length;

  const tabs = $("#wsTabs");
  if (tabs) {
    tabs.querySelectorAll(".ws-tab").forEach(btn => {
      btn.classList.toggle("on", btn.dataset.tab === S.workspace.tab);
    });
  }

  const listEl = $("#wsList");
  if (!listEl) return;
  const shown = S.workspace.tab === "done" ? done : pending;
  const curName = S.workspace.currentName || (S.root && S.root.name) || "";

  if (!shown.length) {
    listEl.innerHTML = `<div class="muted" style="padding:6px 4px;text-align:center">${
      S.workspace.tab === "done" ? "No completed blocks yet" : "🎉 All blocks in this workspace are done!"
    }</div>`;
  } else {
    listEl.innerHTML = shown.map(b => {
      const isCur = b.name === curName;
      const isDone = b.status === "done";
      const badge = isDone
        ? `<span class="ws-badge ok">${b.archived ? "uploaded/" : "✓ ZIP"}</span>`
        : `<span class="ws-badge">${b.jsonCount}/${b.imgCount}</span>`;
      return `<div class="ws-item${isCur ? " cur" : ""}${isDone ? " done" : ""}" data-bname="${esc(b.name)}" title="${esc(b.name)}${b.archived ? " (Archived in uploaded/)" : ""}">
        <span class="ws-id">${esc(b.blockId)}</span>
        <span class="ws-full">${esc(b.name)}</span>
        ${badge}
      </div>`;
    }).join("");
  }
  updateNextBlockButtons();
}

async function scanWorkspace(wsRoot, autoOpen = false) {
  if (!wsRoot) return;
  S.workspace.root = wsRoot;
  const blocks = [];

  for await (const [name, h] of wsRoot.entries()) {
    if (h.kind !== "directory" || name.startsWith(".")) continue;
    if (name.toLowerCase() === "uploaded") {
      // Also scan uploaded/ subfolder so archived blocks appear in the Done tab
      try {
        for await (const [uName, uH] of h.entries()) {
          if (uH.kind !== "directory" || uName.startsWith(".")) continue;
          const info = await inspectBlockDir(uH);
          if (info.hasZip || info.status === "done") {
            blocks.push({
              name: uName,
              blockId: extractBlockId(uName),
              blockNo: extractBlockNumber(uName),
              handle: uH,
              imgCount: 0,
              jsonCount: 0,
              hasZip: true,
              status: "done",
              archived: true
            });
          }
        }
      } catch (e) {}
      continue;
    }
    const info = await inspectBlockDir(h);
    if (info.status !== "empty") {
      blocks.push({
        name,
        blockId: extractBlockId(name),
        blockNo: extractBlockNumber(name),
        handle: h,
        imgCount: info.imgCount,
        jsonCount: info.jsonCount,
        hasZip: info.hasZip,
        status: info.status,
        archived: false
      });
    }
  }

  // Deduplicate if a block exists in both root and uploaded/
  const seen = new Map();
  for (const b of blocks) {
    if (!seen.has(b.name) || !b.archived) seen.set(b.name, b);
  }
  S.workspace.blocks = [...seen.values()].sort((a, b) => natCmp(a.name, b.name));
  renderWorkspaceQueue();

  if (autoOpen) {
    const lastBlockName = recall("lastWsBlock." + wsRoot.name, null);
    let target = lastBlockName ? S.workspace.blocks.find(b => b.name === lastBlockName && b.status === "pending") : null;
    if (!target) target = S.workspace.blocks.find(b => b.status === "pending");
    if (target) {
      S.workspace.currentName = target.name;
      store("lastWsBlock." + wsRoot.name, target.name);
      renderWorkspaceQueue();
      await loadDirectory(target.handle);
    } else {
      S.root = null; S.files = []; S.idx = -1; S.img = null; S.shapes = []; S.sel = new Set();
      $("#folderName").textContent = wsRoot.name;
      $("#folderInfo").textContent = `All ${S.workspace.blocks.filter(b => b.status === "done").length} block(s) completed!`;
      $("#empty").style.display = "flex";
      $("#empty b").textContent = "All blocks in this workspace are done!";
      draw();
    }
  }
}

async function openNextPendingBlock() {
  if (!S.workspace || !S.workspace.root) return;
  const dlgUp = $("#dlgUp");
  if (dlgUp && dlgUp.open) dlgUp.close();
  await scanWorkspace(S.workspace.root, false);
  const nextB = updateNextBlockButtons() || S.workspace.blocks.find(b => b.status === "pending");
  if (!nextB) {
    toast("🎉 All pending blocks in this workspace are completed!");
    return;
  }
  S.workspace.currentName = nextB.name;
  store("lastWsBlock." + S.workspace.root.name, nextB.name);
  renderWorkspaceQueue();
  await loadDirectory(nextB.handle);
}

async function archiveBlockFolder(wsRoot, blockName, zip, zipName) {
  if (!wsRoot || !blockName || !zip || !zipName) return { ok: false, error: "Missing workspace or zip parameters" };
  try {
    const uploadedDir = await wsRoot.getDirectoryHandle("uploaded", { create: true });
    const destBlockDir = await uploadedDir.getDirectoryHandle(blockName, { create: true });
    const zh = await destBlockDir.getFileHandle(zipName, { create: true });
    const w = await zh.createWritable();
    await w.write(zip);
    await w.close();
    const verifyFile = await zh.getFile();
    if (verifyFile.size !== zip.size) {
      throw new Error(`Archived zip size mismatch (${verifyFile.size} vs ${zip.size})`);
    }
    await wsRoot.removeEntry(blockName, { recursive: true });
    return { ok: true, archivedPath: `uploaded/${blockName}/${zipName}` };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

async function detectAndLoadFolder(dir) {
  let directImages = 0;
  const subdirs = [];
  try {
    for await (const [name, h] of dir.entries()) {
      if (h.kind === "directory") {
        if (!name.startsWith(".") && name.toLowerCase() !== "uploaded") subdirs.push([name, h]);
      } else if (IMG_RE.test(name)) {
        directImages++;
      }
    }
  } catch (e) {
    toast("Could not read folder: " + e.message, 6000);
    return;
  }

  // Heuristic: If folder has 0 direct images and 2+ subdirectories (or 1 subdirectory alongside an 'uploaded' folder),
  // check if subdirectories look like task blocks.
  let isWorkspace = false;
  if (directImages === 0 && subdirs.length >= 2) {
    isWorkspace = true;
  } else if (directImages === 0 && subdirs.length === 1) {
    try {
      await dir.getDirectoryHandle("uploaded", { create: false });
      isWorkspace = true;
    } catch (e) {}
  }

  if (isWorkspace) {
    await saveWorkspaceHandle(dir);
    store("lastDirName", dir.name);
    await scanWorkspace(dir, true);
  } else {
    S.workspace.root = null;
    S.workspace.blocks = [];
    S.workspace.currentName = null;
    await saveWorkspaceHandle(null);
    renderWorkspaceQueue();
    await loadDirectory(dir);
  }
}

async function loadDirectory(dir) {
  fitAndSave(true); await flush();
  const bar = $("#restoreBar"); if (bar) bar.style.display = "none";
  const btnUp = $("#btnNextBlockUp"), btnEmp = $("#btnNextBlockEmpty");
  if (btnUp) btnUp.style.display = "none";
  if (btnEmp) btnEmp.style.display = "none";
  $("#folderName").textContent = dir.name; $("#folderInfo").textContent = "Reading folder…";
  const files = [];
  async function walk(d, rel, depth) {
    const subs = [], here = [], jsons = new Map();
    for await (const [name, h] of d.entries()) {
      if (h.kind === "directory") { if (depth < 4 && !name.startsWith(".")) subs.push([name, h]); }
      else if (IMG_RE.test(name)) here.push([name, h]);
      else if (/\.json$/i.test(name)) jsons.set(stem(name).toLowerCase(), h);
    }
    for (const [name, h] of here) files.push({ name, rel, dir: d, handle: h, json: jsons.get(stem(name).toLowerCase()) || null, count: 0, bad: 0 });
    for (const [name, h] of subs) await walk(h, rel ? rel + "/" + name : name, depth + 1);
  }
  try { await walk(dir, "", 0); } catch (e) { toast("Could not read folder: " + e.message, 6000); return; }
  files.sort((a, b) => natCmp(a.rel, b.rel) || natCmp(a.name, b.name));
  S.root = dir; S.files = files; S.idx = -1; S.img = null; S.shapes = []; S.sel = new Set(); S.folderDone = false;
  S.vp = null; S.gradient = null; S.calibMasters = null; S.calibBounds = null; S.snapEdges = null;
  offscreenCv = null; offscreenCtx = null; offscreenBuf = null; offscreenW = 0; offscreenH = 0;
  if (S.workspace && S.workspace.root) {
    S.workspace.currentName = dir.name;
    store("lastWsBlock." + S.workspace.root.name, dir.name);
  }
  draw();
  checkTabActive();
  S.cache.forEach(p => p.then(b => b.close && b.close()).catch(() => {})); S.cache.clear();

  loadBlockTime(dir.name);

  await Promise.all(files.map(async f => {
    if (!f.json) { setFileStats(f, []); return; }
    try {
      const d = JSON.parse(await (await f.json.getFile()).text()), sh = (d.shapes || []).map(normShape);
      setFileStats(f, sh);
    } catch (e) { setFileStats(f, []); f.err = true; f.bad = -1; }
  }));
  if (S.workspace && S.workspace.root) {
    const wb = S.workspace.blocks.find(b => b.name === dir.name);
    if (wb) {
      wb.imgCount = files.length;
      wb.jsonCount = files.filter(f => f.json).length;
    }
    renderWorkspaceQueue();
  }
  rebuildLabels();
  S.fileFilterPill = "all";
  const pillBox = $("#fileFilterPills");
  if (pillBox) pillBox.querySelectorAll(".filter-pill").forEach(b => b.classList.toggle("on", b.dataset.f === "all"));
  const nj = files.filter(f => f.json).length, nb = files.filter(f => f.bad > 0).length;
  $("#folderInfo").textContent = `${files.length} images · ${nj} with JSON` + (nb ? ` · ${nb} need fixing` : "");
  $("#empty").style.display = files.length ? "none" : "flex";
  if (!files.length) { $("#empty b").textContent = "No images found in this folder"; }
  renderHiBar(); renderFiles(); renderLabels();
  if (files.length) {
    const last = recall("last." + dir.name, null);
    const i = last ? files.findIndex(f => f.rel + "/" + f.name === last) : -1;
    openImage(i >= 0 ? i : 0);
  }
}

async function openFolder() {
  if (!window.showDirectoryPicker) { toast("Open this file in Google Chrome or Microsoft Edge. This browser cannot save to folders.", 7000); return; }
  const lastDir = (await getSavedWorkspaceHandle()) || (await getSavedDirHandle());
  const opts = { mode: "readwrite" };
  if (lastDir) {
    try { opts.startIn = lastDir; } catch (e) {}
  }
  let dir;
  try {
    dir = await window.showDirectoryPicker(opts);
  } catch (e) {
    if (e.name === "AbortError") return;
    try { dir = await window.showDirectoryPicker({ mode: "readwrite" }); } catch (e2) { return; }
  }
  if (!dir) return;
  await saveDirHandle(dir);
  store("lastDirName", dir.name);
  await detectAndLoadFolder(dir);
}

async function checkRestoreSession() {
  try {
    const lastWs = await getSavedWorkspaceHandle();
    const lastDir = lastWs || (await getSavedDirHandle());
    if (!lastDir) return;
    let perm = "prompt";
    try { perm = await lastDir.queryPermission({ mode: "readwrite" }); } catch (e) {}
    if (perm === "granted") {
      await detectAndLoadFolder(lastDir);
      return;
    }
    const bar = $("#restoreBar"), nm = $("#restoreName"), btn = $("#btnRestoreSession");
    if (bar && nm && btn) {
      nm.textContent = lastDir.name;
      bar.style.display = "flex";
      btn.onclick = async () => {
        try {
          const res = await lastDir.requestPermission({ mode: "readwrite" });
          if (res === "granted") {
            bar.style.display = "none";
            await detectAndLoadFolder(lastDir);
          } else {
            toast("Permission was not granted to open the folder");
          }
        } catch (err) {
          toast("Could not open previous folder: " + err.message);
        }
      };
    }
  } catch (e) {
    console.warn("Session restore check error", e);
  }
}

function normShape(s) {
  return { ...s, label: s.label ?? "row", shape_type: s.shape_type || "polygon", points: (s.points || []).map(p => [+p[0], +p[1]]) };
}
function getBitmap(i) {
  if (!S.cache.has(i)) {
    const f = S.files[i];
    S.cache.set(i, f.handle.getFile().then(file => createImageBitmap(file)));
  }
  return S.cache.get(i);
}
function trimCache(i) {
  for (const [k, p] of S.cache) if (k < i - 1 || k > i + 2) { S.cache.delete(k); p.then(b => b.close()).catch(() => {}); }
}
async function openImage(i) {
  if (i < 0 || i >= S.files.length) return;
  fitAndSave(true); await flush();
  if (S.idx >= 0 && S.files[S.idx]) {
    const prev = S.files[S.idx];
    prev._visited = true;
    const quickActive = isTabActive && imgStartTimestamp && (Date.now() - imgStartTimestamp) > 150 ? 1 : 0;
    const spent = imgSeconds > 0 ? imgSeconds : quickActive;
    if (spent > 0) {
      prev.timeSpent = (prev.timeSpent || 0) + spent;
      if (S.shapes.length > 0 && !S.shapes.some(isBad)) recordImageDone(prev);
      showImageTimeBoom(spent);
    }
  }
  imgSeconds = 0;
  imgStartTimestamp = Date.now();
  updateTimerDisplay();
  const tok = ++S.loadToken, f = S.files[i];
  $("#loading").style.display = "block";
  let bmp, data = null;
  try { bmp = await getBitmap(i); } catch (e) { $("#loading").style.display = "none"; toast("Could not open image " + f.name + ": " + e.message, 6000); S.cache.delete(i); return; }
  if (f.json) {
    try { data = JSON.parse(await (await f.json.getFile()).text()); }
    catch (e) { toast("Could not read " + stem(f.name) + ".json (" + e.message + "). It will not be overwritten until you change something.", 7000); }
  }
  if (tok !== S.loadToken) return;
  S.idx = i; S.img = bmp; S.W = bmp.width; S.H = bmp.height;
  S.folderDone = false;
  imgStartTimestamp = Date.now();
  checkTabActive();
  S.data = data || { version: "0.4.29", flags: {}, shapes: [], imagePath: f.name, imageData: null, imageHeight: S.H, imageWidth: S.W };
  if (data && data.imageWidth && data.imageHeight && (data.imageWidth !== S.W || data.imageHeight !== S.H))
    toast(`Warning: JSON says ${data.imageWidth}×${data.imageHeight} but the image is ${S.W}×${S.H}`, 7000);
  S.shapes = (S.data.shapes || []).map(normShape);

  // Auto-classify row directions on image open ONLY for unclassified ("row" / empty) shapes;
  // never overwrite rows that were already classified or manually labeled!
  let autoClassified = 0;
  if (!BOX() && S.shapes.length && typeof autoClassifyShapes === "function") {
    autoClassified = autoClassifyShapes(S.shapes, { onlyUnclassified: true });
    if (autoClassified > 0) {
      setFileStats(f, S.shapes);
      if (S.shapes[0] && isDirOrDefaultLabel(S.shapes[0].label)) S.label = S.shapes[0].label;
    }
  }
  S.shapes.forEach(s => { if (!S.labels.includes(s.label)) S.labels.push(s.label); });
  // Reset per-image state including vanishing point, perspective gradient, boundary lines, and CV buffer
  S.sel = new Set(); S.selV = null; S.hover = -1; S.hoverV = null; S.hoverSide = null; S.undo = []; S.redo = []; S.draft = []; S.dirty = false;
  S.vp = null;
  S.gradient = null;
  S.calibMasters = null;
  S.calibBounds = null;
  S.snapEdges = null;
  offscreenCv = null; offscreenCtx = null; offscreenBuf = null; offscreenW = 0; offscreenH = 0;
  updateHudVpStyle();
  $("#loading").style.display = "none";
  if (autoClassified > 0) {
    S.dirty = true;
    setSave("unsaved");
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(save, 700);
    toast(`Auto-classified ${autoClassified} row${autoClassified > 1 ? "s" : ""} by angle`, 1800);
  } else if (!S.pending) {
    setSave("none");
  }
  store("last." + S.root.name, f.rel + "/" + f.name);
  fit(); renderFiles(); refreshAll(); renderLabels();
  const cur = $("#files .file.cur"); if (cur) cur.scrollIntoView({ block: "nearest" });
  trimCache(i);
  for (let ahead = 1; ahead <= 2; ahead++) {
    if (i + ahead < S.files.length) getBitmap(i + ahead).catch(() => {});
  }
  // Per-image 20+ segment high-altitude detection
  if (!BOX() && S.shapes.length >= 20 && !f._highAltDismissed) {
    showHighAltDialog([f]);
  }
}

// ---------------------------------------------------------------- side panels
function renderFiles() {
  const q = $("#fileFilter").value.trim().toLowerCase(), box = $("#files");
  const pill = S.fileFilterPill || "all";
  let html = "", lastRel = null;
  S.files.forEach((f, i) => {
    if (q && !f.name.toLowerCase().includes(q)) return;
    if (pill === "bad" && !(f.bad > 0 || f.bad === -1) && i !== S.idx) return;
    if (pill === "none" && f.json && i !== S.idx) return;
    if (pill === "high" && !(f.json && f.count >= 20) && i !== S.idx) return;
    const hn = S.hiLabel && f.labels ? f.labels.get(S.hiLabel) || 0 : 0;
    if (S.hiLabel && S.hiOnly && !hn && i !== S.idx) return;
    if (f.rel !== lastRel) { lastRel = f.rel; if (f.rel) html += `<div class="grp"><span class="material-symbols-rounded" style="font-size:14px;vertical-align:-2px">folder</span> ${esc(f.rel)}</div>`; }
    const visDot = f._visited ? `<span class="qc-dot" title="Reviewed in this session"></span>` : "";
    const b = f.bad === -1 ? `<span class="badge bad" title="JSON could not be read">!</span>`
      : f.bad > 0 ? `<span class="badge bad" title="${BOX() ? f.bad + " empty box(es)" : f.bad + " segment(s) without exactly " + ROW_VERTS + " vertices"}"><span class="material-symbols-rounded" style="font-size:12px;vertical-align:-2px">warning</span> ${f.bad}</span>` : "";
    const h = hn ? `<span class="badge" style="background:${rgba(labelColor(S.hiLabel), 1)};color:#000" title="${hn} × ${esc(S.hiLabel)}">${hn}</span>` : "";
    const c = f.json ? `<span class="badge" title="${BOX() ? "boxes" : "segments"}">${f.count}</span>` : `<span class="badge none" title="no JSON yet">&ndash;</span>`;
    html += `<div class="file${i === S.idx ? " cur" : ""}${hn ? " hi" : ""}" data-i="${i}" title="${esc(f.name)}">${visDot}<span class="nm">${esc(f.name)}</span>${b}${h}${c}</div>`;
  });
  box.innerHTML = html || `<div class="grp">No images</div>`;
  const prog = $("#folderProgress"), progBar = $("#folderProgressBar");
  if (prog && progBar) {
    if (S.files.length > 0) {
      prog.style.display = "block";
      const done = S.files.filter(f => f.json && f.count > 0 && !f.bad).length;
      const pct = Math.round((done / S.files.length) * 100);
      progBar.style.width = pct + "%";
      progBar.style.background = pct === 100 ? "var(--ok)" : "var(--accent)";
      prog.title = `Folder progress: ${done}/${S.files.length} clean (${pct}%)`;
    } else {
      prog.style.display = "none";
    }
  }
}
$("#files").addEventListener("click", e => { const el = e.target.closest(".file"); if (el) openImage(+el.dataset.i); });
$("#fileFilter").addEventListener("input", renderFiles);
const filterPillsEl = $("#fileFilterPills");
if (filterPillsEl) {
  filterPillsEl.addEventListener("click", e => {
    const b = e.target.closest(".filter-pill");
    if (!b) return;
    S.fileFilterPill = b.dataset.f || "all";
    filterPillsEl.querySelectorAll(".filter-pill").forEach(x => x.classList.toggle("on", x === b));
    renderFiles();
    b.blur();
  });
}

function rebuildLabels() {
  const set = new Set(BOX() ? [] : ["vertical", "horizontal", "diagonal", "both"]);
  S.files.forEach(f => f.labels && f.labels.forEach((n, l) => set.add(l)));
  S.shapes.forEach(s => set.add(s.label));
  (S.extraLabels[S.app] || []).forEach(l => set.add(l));
  S.labels = [...set];
  if (!S.labels.includes(S.label)) S.label = S.labels[0] || (BOX() ? "" : "vertical");
  if (S.hiLabel && !S.labels.includes(S.hiLabel)) S.hiLabel = null;
}

function renderHiBar() {
  const bar = $("#hiBar");
  if (!bar) return;
  if (!S.hiLabel) { bar.style.display = "none"; bar.innerHTML = ""; return; }
  const n = S.files.filter(f => f.labels && f.labels.get(S.hiLabel)).length;
  bar.style.display = "flex";
  bar.innerHTML = `<span class="sw" style="background:${rgba(labelColor(S.hiLabel), 1)}"></span><span>“${esc(S.hiLabel)}” in <b>${n}</b> image${n === 1 ? "" : "s"}</span>
    <label><input type="checkbox" id="hiOnly"${S.hiOnly ? " checked" : ""}> only these</label><span style="flex:1"></span><button class="btn sm" id="hiClear" title="Stop highlighting">&#10005;</button>`;
}
$("#hiBar").addEventListener("change", e => { if (e.target.id === "hiOnly") { S.hiOnly = e.target.checked; renderFiles(); } });
$("#hiBar").addEventListener("click", e => { if (e.target.id === "hiClear") { S.hiLabel = null; S.hiOnly = false; renderLabels(); renderHiBar(); renderFiles(); } });

function syncClassSelectors() {
  const sel = $("#hdrClassSelect");
  if (sel) {
    sel.innerHTML = S.labels.map(l => `<option value="${esc(l)}"${l === S.label ? " selected" : ""}>${esc(l)}</option>`).join("");
    if (S.sel.size > 0) {
      const selLabels = [...new Set([...S.sel].map(i => S.shapes[i] && S.shapes[i].label).filter(Boolean))];
      if (selLabels.length === 1 && S.labels.includes(selLabels[0])) sel.value = selLabels[0];
    }
  }
  const swatch = $("#hdrClassSwatch");
  if (swatch) swatch.style.background = rgba(labelColor(S.label), 1);
}

function markManualLabel(sh) {
  if (sh) sh._manualLabel = true;
}

function applyClassChange(newClass, forceAll = false) {
  if (!newClass) return;
  S.label = newClass;
  if (!forceAll && S.sel.size > 0) {
    const targetIdx = [...S.sel].filter(i => S.shapes[i] && S.shapes[i].label !== newClass);
    if (targetIdx.length) {
      pushUndo();
      targetIdx.forEach(i => { S.shapes[i].label = newClass; markManualLabel(S.shapes[i]); });
      markDirty();
      toast(`Changed ${targetIdx.length} ${unit(targetIdx.length)} to “${newClass}”`, 2000);
    } else {
      [...S.sel].forEach(i => markManualLabel(S.shapes[i]));
      toast(`Selected ${unit(S.sel.size)} already “${newClass}”`, 1500);
    }
  } else if (S.shapes.length > 0) {
    pushUndo();
    const count = S.shapes.length;
    S.shapes.forEach(s => { s.label = newClass; markManualLabel(s); });
    S.sel = new Set(S.shapes.map((_, i) => i));
    S.selV = null;
    markDirty();
    toast(`Selected all ${count} ${unit(count)} and set class to “${newClass}”`, 2500);
  } else {
    toast(`Default class set to “${newClass}”`, 1500);
  }
  rebuildLabels();
  refreshAll();
  syncClassSelectors();
}

function renderLabels() {
  rebuildLabels();
  const here = {}, tot = {}, imgs = {};
  S.shapes.forEach(s => here[s.label] = (here[s.label] || 0) + 1);
  S.files.forEach(f => f.labels && f.labels.forEach((n, l) => { tot[l] = (tot[l] || 0) + n; imgs[l] = (imgs[l] || 0) + 1; }));
  $("#labels").innerHTML = S.labels.map((l, k) => `<div class="lab${l === S.label ? " cur" : ""}${l === S.hiLabel ? " hi" : ""}" data-l="${esc(l)}" title="Click: draw with “${esc(l)}” and highlight the images that have it" style="cursor:pointer">
      <span class="key" style="font-size:11px;opacity:0.6;width:12px;display:inline-block">${k < 9 ? k + 1 : ""}</span><span class="sw" data-l="${esc(l)}" style="background:${rgba(labelColor(l), 1)}" title="Click to customize color · Right-click to reset"></span><span class="nm" style="flex:1">${esc(l)}</span>
      <span class="cnt" title="${here[l] || 0} on this image · ${tot[l] || 0} in folder, in ${imgs[l] || 0} image(s)">${here[l] || 0} · ${tot[l] || 0} <span style="opacity:.65">(${imgs[l] || 0})</span></span>
      <button class="ic" data-a="ren" title="Rename “${esc(l)}” in every image of this folder" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:12px;padding:0 2px">&#9998;</button>
      <button class="ic" data-a="del" title="Delete “${esc(l)}” from every image of this folder" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:12px;padding:0 2px">&#128465;</button></div>`).join("")
    || `<div class="muted">No classes yet. Type a name below and click Add.</div>`;
  const totBox = $("#folderTotal");
  if (totBox) {
    const allHere = S.shapes.length, allTot = Object.values(tot).reduce((a, b) => a + b, 0);
    const imgsWithAny = S.files.filter(f => f.count > 0).length;
    totBox.textContent = `${allHere} on this image · ${allTot} in folder (${imgsWithAny}/${S.files.length} images)`;
  }
  $("#curLabel").innerHTML = S.labels.map(l => `<option${l === S.label ? " selected" : ""}>${esc(l)}</option>`).join("");
}
$("#curLabel").addEventListener("change", e => { S.label = e.target.value; e.target.blur(); renderLabels(); });
$("#btnAddLabel").addEventListener("click", () => {
  const v = $("#newLabel").value.trim(); if (!v) return;
  const ex = S.extraLabels[S.app];
  if (!ex.includes(v)) { ex.push(v); store("classes." + S.app, ex); }
  if (!S.labels.includes(v)) S.labels.push(v);
  S.label = v; $("#newLabel").value = ""; rebuildLabels(); renderLabels();
});
$("#newLabel").addEventListener("keydown", e => { if (e.key === "Enter") $("#btnAddLabel").click(); });
$("#btnApplyLabel").addEventListener("click", () => {
  if (!S.sel.size) return toast("Select segments first");
  pushUndo(); S.sel.forEach(i => { S.shapes[i].label = S.label; markManualLabel(S.shapes[i]); }); markDirty(); renderLabels();
});
$("#labels").addEventListener("click", e => {
  const sw = e.target.closest(".sw");
  if (sw) {
    e.stopPropagation();
    const lbl = sw.dataset.l || (sw.closest(".lab") && sw.closest(".lab").dataset.l);
    if (lbl) openColorPickerFor(lbl);
    return;
  }
  const ren = e.target.closest("button[data-a='ren']");
  if (ren) { e.stopPropagation(); renameClass(ren.closest(".lab").dataset.l); return; }
  const del = e.target.closest("button[data-a='del']");
  if (del) { e.stopPropagation(); deleteClass(del.closest(".lab").dataset.l); return; }
  const lab = e.target.closest(".lab");
  if (lab) {
    const l = lab.dataset.l;
    S.label = l;
    S.hiLabel = S.hiLabel === l ? null : l;
    renderLabels(); renderHiBar(); renderFiles();
  }
});
$("#labels").addEventListener("contextmenu", e => {
  const sw = e.target.closest(".sw");
  if (sw) {
    e.preventDefault();
    e.stopPropagation();
    const lbl = sw.dataset.l || (sw.closest(".lab") && sw.closest(".lab").dataset.l);
    if (lbl) resetClassColor(lbl);
  }
});

async function renameClass(from) {
  if (S.busy) return;
  const to = (prompt(`Rename class “${from}” in every image of this folder to:`, from) || "").trim();
  if (!to || to === from) return;
  if (S.labels.includes(to) && !confirm(`“${to}” already exists. Merge all “${from}” shapes into “${to}”?`)) return;
  await datasetEdit(from, to);
}
async function deleteClass(from) {
  if (S.busy) return;
  let n = 0, imgs = 0; S.files.forEach(f => { const c = f.labels && f.labels.get(from); if (c) { n += c; imgs++; } });
  if (!confirm(`Delete class “${from}”?\n\nThis removes ${n} shape(s) from ${imgs} image(s) in this folder. It can't be undone.`)) return;
  await datasetEdit(from, null);
}
async function datasetEdit(from, to) {
  S.busy = true;
  const what = to === null ? "Deleting" : "Renaming";
  try {
    fitAndSave(true); await flush();
    let files = 0, shapes = 0; const fails = [], cur = S.files[S.idx];
    if (S.shapes.some(s => s.label === from)) {
      const out = [];
      for (const s of S.shapes) { if (s.label !== from) out.push(s); else { shapes++; if (to !== null) out.push({ ...s, label: to }); } }
      pushUndo(); S.shapes = out; S.sel = new Set(); S.selV = null; markDirty(); files++;
    }
    for (const f of S.files) {
      if (f === cur || !f.json || !f.labels || !f.labels.get(from)) continue;
      try {
        const d = JSON.parse(await (await f.json.getFile()).text());
        let ch = 0; const next = [];
        for (const s of d.shapes || []) {
          if (s.label !== from) next.push(s);
          else { ch++; shapes++; if (to !== null) next.push({ ...s, label: to }); }
        }
        if (ch) {
          d.shapes = next;
          const w = await f.json.createWritable();
          await w.write(JSON.stringify(d, null, 2));
          await w.close();
          setFileStats(f, next.map(normShape));
          files++;
        }
      } catch (e) { fails.push(f.name); }
    }
    toast(to === null ? `Deleted “${from}” (${shapes} in ${files} images)` : `Renamed “${from}” → “${to}” (${shapes} in ${files} images)`, 3500);
    if (fails.length) toast(`Failed to update ${fails.length} file(s)`, 5000);
    rebuildLabels(); refreshAll();
  } finally { S.busy = false; }
}

function checkHighAltitudeImages(files) {
  const matches = files.filter(f => f.json && f.count >= 20);
  if (!matches.length) return;
  showHighAltDialog(matches);
}
function showHighAltDialog(matches) {
  const list = $("#highAltList");
  if (!list) return;
  list.innerHTML = matches.map(f => {
    const path = (f.rel ? f.rel + "/" : "") + f.name;
    return `<div class="high-alt-row"><span>${esc(path)}</span><span class="badge bad" style="font-size:11px">${f.count} segments</span></div>`;
  }).join("");
  const dlg = $("#dlgHighAlt");
  $("#highAltKeep").onclick = () => {
    matches.forEach(m => { m._highAltDismissed = true; });
    dlg.close();
  };
  $("#highAltDelete").onclick = async () => {
    dlg.close();
    let deletedCount = 0;
    const fails = [];
    for (const f of matches) {
      try {
        const jsonName = stem(f.name) + ".json";
        await f.dir.removeEntry(jsonName);
        f.json = null;
        setFileStats(f, []);
        unrecordImageDone(f);
        deletedCount++;
      } catch (e) {
        fails.push(f.name);
      }
    }
    if (S.idx >= 0 && matches.includes(S.files[S.idx])) {
      S.shapes = [];
      S.sel = new Set();
      S.selV = null;
      S.dirty = false;
      clearTimeout(S.saveTimer);
      setSave("none");
      refreshAll();
    }
    const nj = S.files.filter(f => f.json).length, nb = S.files.filter(f => f.bad > 0).length;
    $("#folderInfo").textContent = `${S.files.length} images · ${nj} with JSON` + (nb ? ` · ${nb} need fixing` : "");
    rebuildLabels();
    renderFiles();
    renderLabels();
    draw();
    toast(`Deleted ${deletedCount} high-altitude JSON annotation file(s). Images preserved.`, 4000);
    if (fails.length) toast(`Could not delete JSON for: ${fails.join(", ")}`, 5000);
  };
  dlg.showModal();
}

function applyAppMode(m, init) {
  if (!init) fitAndSave(true);
  S.app = m === "box" ? "box" : "row"; store("appMode", S.app);
  document.body.classList.toggle("boxmode", BOX()); $("#appMode").value = S.app;
  document.title = BOX() ? "LabelLite — Box Mode" : "LabelLite";
  S.files.forEach(f => { if (!f.err && f.badRow !== undefined) f.bad = BOX() ? f.badBox : f.badRow; });
  if (BOX() && S.hudOpen) {
    const angRow = $("#hudAngle") ? $("#hudAngle").closest(".hud-slider-row") : null;
    if (angRow) angRow.style.display = "none";
  } else if (!BOX()) {
    const angRow = $("#hudAngle") ? $("#hudAngle").closest(".hud-slider-row") : null;
    if (angRow) angRow.style.display = "";
  }
  setMode(BOX() ? "box" : "edit");
  rebuildLabels();
  refreshAll();
}

function createBox(a, b) {
  const x0 = clampX(Math.min(a[0], b[0])), x1 = clampX(Math.max(a[0], b[0])), y0 = clampY(Math.min(a[1], b[1])), y1 = clampY(Math.max(a[1], b[1]));
  if (x1 - x0 < 2 || y1 - y0 < 2) { toast("Box too small. Drag from one corner to the opposite corner."); draw(); return; }
  const pts = [[x0, y0], [x1, y1]];
  if (S.rememberClass && S.label) addBox(pts, S.label);
  else askClass(pts);
}
function addBox(pts, label) {
  pushUndo();
  S.shapes.push({ label, text: "", points: pts, group_id: null, shape_type: "rectangle", flags: {} });
  S.sel = new Set([S.shapes.length - 1]); S.selV = null; markDirty();
}
function askClass(pts, edit) {
  S.pendingBox = pts || null; S.classEdit = edit || null; draw();
  const inp = $("#clsInput"), n = edit ? edit.length : 0;
  inp.value = edit ? S.shapes[edit[0]].label : S.label || "";
  $("#clsTitle").textContent = edit ? `Change class of ${n > 1 ? n + " " + unit(n) : "this " + unit(1)}` : "Class for this box";
  $("#clsRememberRow").style.display = edit ? "none" : "";
  $("#clsCancel").textContent = edit ? "Cancel" : "Discard box";
  $("#clsKeys").textContent = edit ? "Enter = OK · ↑↓ = pick from list · Esc = cancel" : "Enter = OK · ↑↓ = pick from list · Esc = discard box";
  $("#clsRemember").checked = false;
  S.clsTyped = false; renderClassList();
  $("#dlgClass").showModal(); inp.focus(); inp.select();
}
function renderClassList() {
  const q = S.clsTyped ? $("#clsInput").value.trim().toLowerCase() : "";
  $("#clsList").innerHTML = S.labels.map((l, k) => `<div class="clsItem${l === $("#clsInput").value.trim() ? " on" : ""}${q && !l.toLowerCase().includes(q) ? " dim" : ""}" data-l="${esc(l)}">
      <span class="key">${k < 9 ? k + 1 : ""}</span><span class="sw" style="background:${rgba(labelColor(l), 1)}"></span>${esc(l)}</div>`).join("")
    || `<div class="muted">No classes yet. Type a name above.</div>`;
}
function closeClass(label) {
  const pts = S.pendingBox, edit = S.classEdit; S.pendingBox = null; S.classEdit = null;
  if ($("#dlgClass").open) $("#dlgClass").close();
  if (label && !S.labels.includes(label)) {
    const ex = S.extraLabels[S.app];
    if (!ex.includes(label)) { ex.push(label); store("classes." + S.app, ex); }
  }
  if (label && edit) {
    const idx = edit.filter(i => S.shapes[i] && S.shapes[i].label !== label);
    if (idx.length) { pushUndo(); idx.forEach(i => { S.shapes[i].label = label; markManualLabel(S.shapes[i]); }); markDirty(); toast(`Class changed to “${label}” (${idx.length} ${unit(idx.length)})`, 1800); }
    else draw();
    return;
  }
  if (label && pts) {
    S.label = label;
    if ($("#clsRemember").checked) setRemember(true);
    addBox(pts, label);
  } else draw();
}
function setRemember(v) {
  S.rememberClass = !!v;
  if ($("#askEach")) $("#askEach").checked = !S.rememberClass;
}

function drawBoxDraft() {
  const nb = S.drag && S.drag.type === "newbox";
  let a = nb ? S.drag.a : S.boxStart, b = nb ? S.drag.b : S.cursor && [clampX(S.cursor[0]), clampY(S.cursor[1])];
  if (S.pendingBox) [a, b] = S.pendingBox;
  if (a && b) {
    const p = toScr(a), q = toScr(b), col = labelColor(S.label || "?");
    ctx.fillStyle = rgba(col, .2); ctx.fillRect(p[0], p[1], q[0] - p[0], q[1] - p[1]);
    ctx.strokeStyle = rgba(col, 1); ctx.lineWidth = 2; ctx.strokeRect(p[0], p[1], q[0] - p[0], q[1] - p[1]);
  }
  if (S.cursor) {
    const c = toScr(S.cursor);
    ctx.setLineDash([4, 4]); ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, c[1]); ctx.lineTo(S.cw, c[1]); ctx.moveTo(c[0], 0); ctx.lineTo(c[0], S.ch); ctx.stroke(); ctx.setLineDash([]);
  }
}

function ctxTargets(i) { return S.sel.has(i) ? [...S.sel] : [i]; }
function openCtx(i, x, y) {
  const m = $("#ctxMenu"), onShape = i >= 0;
  $("#ctxDraw span").textContent = BOX() ? "＋ Draw box" : "＋ Draw segment";
  $("#ctxDraw kbd").textContent = BOX() ? "R" : "P";
  m.querySelectorAll(".ctxShape").forEach(el => el.style.display = onShape ? "" : "none");
  if (!onShape) {
    S.ctx = null; $("#ctxHead").textContent = S.mode === "box" ? "Drawing boxes" : "Image";
    return placeCtx(x, y);
  }
  const idx = ctxTargets(i), n = idx.length, noun = BOX() ? (n > 1 ? "boxes" : "box") : (n > 1 ? "segments" : "segment");
  S.sel = new Set(idx); S.selV = null; S.ctx = i; refreshAll();
  const labels = [...new Set(idx.map(k => S.shapes[k].label))];
  $("#ctxHead").textContent = n > 1 ? `${n} ${noun} (${labels.join(", ")})` : `${noun}: ${labels[0] || "(no class)"}`;
  placeCtx(x, y);
}
function placeCtx(x, y) {
  const m = $("#ctxMenu"); m.style.display = "block";
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.min(x, innerWidth - w - 6) + "px";
  m.style.top = Math.min(y, innerHeight - h - 6) + "px";
}
function closeCtx() { $("#ctxMenu").style.display = "none"; }
const ctxOpen = () => $("#ctxMenu").style.display === "block";

function showTip(e, i) {
  const t = $("#hoverTip"), sh = i >= 0 ? S.shapes[i] : null;
  if (!sh || sh._vis === false || ctxOpen() || document.querySelector("dialog[open]")) { t.style.display = "none"; return; }
  t.textContent = sh.label || "(no class)";
  t.style.display = "block";
  const x = e.clientX + 14, y = e.clientY + 16, w = t.offsetWidth, h = t.offsetHeight;
  t.style.left = Math.min(x, innerWidth - w - 4) + "px"; t.style.top = (y + h > innerHeight - 4 ? e.clientY - h - 8 : y) + "px";
}
const hideTip = () => { $("#hoverTip").style.display = "none"; };

function renderShapes() {
  const box = $("#shapes");
  box.innerHTML = S.shapes.map((s, i) => {
    const bad = isBad(s), n = ptsOf(s).length;
    const pts = bad ? '<span class="material-symbols-rounded" style="font-size:12px;vertical-align:-2px">warning</span> ' + esc(badText(s)) : s.shape_type === "rectangle" ? "box" : n + " pts";
    return `<div class="shape${S.sel.has(i) ? " sel" : ""}${bad ? " bad" : ""}" data-i="${i}">
      <input type="checkbox" ${s._vis !== false ? "checked" : ""} title="show / hide">
      <span class="sw" style="background:${rgba(labelColor(s.label), 1)}" title="Click to customize color · Right-click to reset"></span>${i + 1}. ${esc(s.label)}<span class="pts">${pts}</span></div>`;
  }).join("") || `<div class="muted" style="padding:2px 8px">No segments yet</div>`;
  $("#shapeCount").textContent = S.shapes.length ? S.shapes.length + " total" : "";
}
$("#shapes").addEventListener("click", e => {
  const el = e.target.closest(".shape"); if (!el) return; const i = +el.dataset.i;
  const sw = e.target.closest(".sw");
  if (sw) {
    e.stopPropagation();
    const sh = S.shapes[i];
    if (sh && sh.label) openColorPickerFor(sh.label);
    return;
  }
  if (e.target.tagName === "INPUT") { S.shapes[i]._vis = e.target.checked; if (!e.target.checked) S.sel.delete(i); refreshAll(); return; }
  if (e.ctrlKey || e.metaKey) S.sel.has(i) ? S.sel.delete(i) : S.sel.add(i); else S.sel = new Set([i]);
  S.selV = null; setMode("edit"); refreshAll();
});
$("#shapes").addEventListener("contextmenu", e => {
  const sw = e.target.closest(".sw");
  if (sw) {
    e.preventDefault();
    e.stopPropagation();
    const el = e.target.closest(".shape");
    if (el) {
      const sh = S.shapes[+el.dataset.i];
      if (sh && sh.label) resetClassColor(sh.label);
    }
  }
});
$("#shapes").addEventListener("dblclick", e => { const el = e.target.closest(".shape"); if (el) zoomToShape(+el.dataset.i); });

function refreshAll() {
  const f = S.files[S.idx];
  let statsChanged = false;
  if (f) {
    const c = S.shapes.length, b = S.shapes.filter(isBad).length;
    if (f.count !== c || f.bad !== b) { f.count = c; f.bad = b; statsChanged = true; }
  }
  if (statsChanged || S.idx < 0) renderFiles();
  renderShapes(); updateBanner(); updateFooter(); updateSelInfo(); updateButtons(); syncClassSelectors(); if (window.syncHudSliders) syncHudSliders(); draw();
}
function updateBanner() {
  const n = S.shapes.filter(isBad).length;
  $("#banner").style.display = n ? "flex" : "none";
  $("#bannerText").textContent = `⚠ ${n} segment${n > 1 ? "s" : ""} not ${ROW_VERTS} vertices. Remove the extra vertices on the red ones (Shift+click a vertex).`;
  $("#fBad").textContent = n ? `⚠ ${n} to fix` : "";
  $("#fBad").style.color = "var(--bad)";
}
function updateCursorPos() {
  const el = $("#fPos");
  if (el) el.textContent = S.cursor && S.img ? `x ${Math.round(S.cursor[0])}, y ${Math.round(S.cursor[1])}` : "–";
}
function updateFooter() {
  $("#fZoom").textContent = S.img ? "Zoom " + Math.round(S.view.s * 100) + "%" : "–";
  $("#fSize").textContent = S.img ? S.W + " × " + S.H : "–";
  $("#fIdx").textContent = S.idx >= 0 ? `Image ${S.idx + 1} / ${S.files.length}` : "–";
  updateCursorPos();
}
function updateSelInfo() {
  $("#selInfo").textContent = S.sel.size ? S.sel.size + " selected" : "none selected";
  if (window.syncHudSliders) syncHudSliders();
  if (S.mode === "slice") {
    const h = $("#hint");
    if (h) {
      h.innerHTML = S.sel.size > 1
        ? `Click on image to slice all ${S.sel.size} selected rows across cut line · <kbd>Esc</kbd> cancel`
        : "Click on any row to slice it into two pieces · <kbd>Esc</kbd> cancel";
    }
  }
}
async function nextImageOrUpload() {
  if (S.idx < 0 || !S.files.length) return;
  if (S.idx < S.files.length - 1) {
    openImage(S.idx + 1);
  } else {
    await fitAndSave(true);
    await flush();
    toast("Last image saved! Opening upload to Drive…", 2800);
    if (!BOX()) {
      openUpload();
    } else {
      toast("Reached last image in folder — all bounding boxes saved!", 3000);
    }
  }
}

function updateButtons() {
  $("#btnUndo").disabled = !S.undo.length; $("#btnRedo").disabled = !S.redo.length;
  $("#btnPrev").disabled = S.idx <= 0;
  const isLast = S.idx >= 0 && S.idx >= S.files.length - 1;
  $("#btnNext").disabled = S.idx < 0 || !S.files.length;
  if (isLast) {
    $("#btnNext").title = "Last image reached — click or press D to save and upload to Drive";
    $("#btnNext").innerHTML = `Upload <span class="material-symbols-rounded" style="margin-right:0;margin-left:2px">cloud_upload</span>`;
  } else {
    $("#btnNext").title = "Next image (D)";
    $("#btnNext").innerHTML = `Next <span class="material-symbols-rounded" style="margin-right:0;margin-left:2px">arrow_forward</span>`;
  }
  const btnDelJ = $("#btnDelJson");
  if (btnDelJ) {
    const f = S.files[S.idx];
    const canDel = !!(f && (f.json || S.shapes.length > 0));
    btnDelJ.disabled = !canDel;
  }
}

// ---------------------------------------------------------------- modes
function setMode(m) {
  if (m !== "poly") S.draft = [];
  S.mode = m;
  $("#mEdit").classList.toggle("on", m === "edit");
  $("#mPoly").classList.toggle("on", m === "poly");
  const mBoxBtn = $("#mBox"); if (mBoxBtn) mBoxBtn.classList.toggle("on", m === "box");
  const mSliceBtn = $("#mSlice"); if (mSliceBtn) mSliceBtn.classList.toggle("on", m === "slice");
  const mMultiBtn = $("#mMulti"); if (mMultiBtn) mMultiBtn.classList.toggle("on", m === "multi");
  const hudSliceBtn = $("#hudSlice"); if (hudSliceBtn) hudSliceBtn.classList.toggle("on", m === "slice");
  const h = $("#hint");
  if (m === "poly") { h.innerHTML = "Click row start, then click row end. Centerline & 4 corners are created automatically · <kbd>Esc</kbd> cancel"; h.style.display = "block"; }
  else if (m === "box") {
    h.innerHTML = S.boxStart
      ? "Click the opposite corner to finish the box · <kbd>Esc</kbd> cancel"
      : "Drag corner to corner (or click 2 corners) · <kbd>Esc</kbd> to edit";
    h.style.display = "block";
  }
  else if (m === "slice") {
    h.innerHTML = S.sel.size > 1
      ? `Click on image to slice all ${S.sel.size} selected rows across cut line · <kbd>Esc</kbd> cancel`
      : "Click on any row to slice it into two pieces · <kbd>Esc</kbd> cancel";
    h.style.display = "block";
  }
  else if (m === "multi") { h.innerHTML = `Drag a box over the ${S.multi.n} ${S.multi.dir === "v" ? "vertical" : "horizontal"} rows · <kbd>Esc</kbd> cancel`; h.style.display = "block"; }
  else h.style.display = "none";
  cv.style.cursor = m === "edit" ? "default" : m === "poly" ? "none" : "crosshair";
  draw();
}

function defaultRowWidth() {
  const valid = S.shapes.filter(s => isClosed(s) && ptsOf(s).length === ROW_VERTS);
  if (valid.length) {
    const widths = [];
    for (const s of valid) {
      const { c, v } = axisOf(ptsOf(s));
      const pr = ptsOf(s).map(p => (p[0] - c[0]) * v[0] + (p[1] - c[1]) * v[1]);
      let lo = Infinity, hi = -Infinity;
      for (const val of pr) { if (val < lo) lo = val; if (val > hi) hi = val; }
      const ext = hi - lo;
      if (ext >= 4 && ext <= 500) widths.push(ext);
    }
    if (widths.length) {
      widths.sort((a, b) => a - b);
      return widths[Math.floor(widths.length / 2)];
    }
  }
  return recall("rowWidth", 36);
}

const DIR_LABELS = new Set(["row", "vertical", "horizontal", "diagonal", "both"]);
function isDirOrDefaultLabel(lbl) {
  return !lbl || DIR_LABELS.has(String(lbl).trim().toLowerCase());
}

function classifyAxisAngle(u) {
  let deg = Math.abs(Math.atan2(u[1], u[0]) * 180 / Math.PI);
  if (deg > 90) deg = 180 - deg;
  if (deg >= 67.5) return { dir: "vertical", deg };
  if (deg <= 22.5) return { dir: "horizontal", deg };
  return { dir: "diagonal", deg };
}

function shapeAxisInfo(sh) {
  const pts = ptsOf(sh);
  if (!pts || pts.length < 3) return null;
  const { c, u, v } = axisOf(pts);
  let uLo = Infinity, uHi = -Infinity, vLo = Infinity, vHi = -Infinity;
  for (const p of pts) {
    const pu = (p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1];
    const pv = (p[0] - c[0]) * v[0] + (p[1] - c[1]) * v[1];
    if (pu < uLo) uLo = pu; if (pu > uHi) uHi = pu;
    if (pv < vLo) vLo = pv; if (pv > vHi) vHi = pv;
  }
  const len = uHi - uLo, wid = vHi - vLo;
  const aspect = len / Math.max(1, wid);
  const { dir, deg } = classifyAxisAngle(u);
  return { c, u, v, len, wid, aspect, isShortStub: aspect < 1.85, dir, deg };
}

function isUnclassifiedLabel(lbl) {
  const s = String(lbl || "").trim().toLowerCase();
  return !s || s === "row";
}

function autoClassifyShapes(shapes, opts = {}) {
  if (BOX() || !shapes || !shapes.length) return 0;
  const onlyUnclassified = !!(opts && opts.onlyUnclassified);
  const infos = shapes.map(sh => (isClosed(sh) ? shapeAxisInfo(sh) : null));
  const confident = [];
  infos.forEach((info, idx) => {
    if (info && !info.isShortStub) confident.push({ idx, c: info.c, dir: info.dir });
  });

  const resolvedDirs = new Array(shapes.length).fill(null);
  let hasVert = false, hasHoriz = false;

  shapes.forEach((sh, idx) => {
    const info = infos[idx];
    if (!info || !isDirOrDefaultLabel(sh.label)) return;
    let targetDir = info.dir;
    if (info.isShortStub && confident.length) {
      let bestD = Infinity, bestDir = targetDir;
      for (const cf of confident) {
        if (cf.idx === idx) continue;
        const d = Math.hypot(cf.c[0] - info.c[0], cf.c[1] - info.c[1]);
        if (d < bestD) { bestD = d; bestDir = cf.dir; }
      }
      targetDir = bestDir;
    }
    resolvedDirs[idx] = targetDir;
    if (targetDir === "vertical") hasVert = true;
    else if (targetDir === "horizontal") hasHoriz = true;
  });

  const isBoth = hasVert && hasHoriz;
  let changed = 0;
  shapes.forEach((sh, idx) => {
    const dir = resolvedDirs[idx];
    if (!dir) return;
    if (sh._manualLabel) return; // Never overwrite a user's manual class override!
    if (onlyUnclassified && !isUnclassifiedLabel(sh.label)) return; // On image open, preserve already-saved classes!
    const finalLabel = isBoth ? "both" : dir;
    if (sh.label !== finalLabel) {
      sh.label = finalLabel;
      changed++;
    }
  });
  return changed;
}

function reclassifyIndices(indices) {
  if (BOX() || !S.shapes.length) return 0;
  const changed = autoClassifyShapes(S.shapes);
  if (changed > 0) {
    const refIdx = (indices && indices.length && S.shapes[indices[0]]) ? indices[0] : 0;
    const ref = S.shapes[refIdx];
    if (ref && isDirOrDefaultLabel(ref.label)) S.label = ref.label;
    rebuildLabels();
    renderLabels();
  }
  return changed;
}

function defaultRowWidthFor(srcSh) {
  const pts = ptsOf(srcSh);
  if (!pts || pts.length < 3) return defaultRowWidth();
  const ax = axisOf(pts);
  const srcAng = Math.atan2(ax.u[1], ax.u[0]);
  const prSrc = pts.map(p => (p[0] - ax.c[0]) * ax.v[0] + (p[1] - ax.c[1]) * ax.v[1]);
  const ownW = Math.max(...prSrc) - Math.min(...prSrc);
  const parallel = S.shapes.filter(s => {
    if (s === srcSh || !isClosed(s) || ptsOf(s).length !== ROW_VERTS) return false;
    const sAx = axisOf(ptsOf(s));
    let dAng = Math.abs(Math.atan2(sAx.u[1], sAx.u[0]) - srcAng);
    while (dAng > Math.PI / 2) dAng = Math.abs(dAng - Math.PI);
    return dAng < 0.45; // ~25 deg
  });
  if (!parallel.length) return ownW >= 4 ? ownW : defaultRowWidth();
  const widths = [];
  for (const s of parallel) {
    const sAx = axisOf(ptsOf(s));
    const pr = ptsOf(s).map(p => (p[0] - sAx.c[0]) * sAx.v[0] + (p[1] - sAx.c[1]) * sAx.v[1]);
    const ext = Math.max(...pr) - Math.min(...pr);
    if (ext >= 4 && ext <= 500) widths.push(ext);
  }
  if (!widths.length) return ownW >= 4 ? ownW : defaultRowWidth();
  widths.sort((a, b) => a - b);
  return widths[Math.floor(widths.length / 2)];
}

function classifyDirection(p1, p2) {
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
  let deg = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);
  if (deg > 90) deg = 180 - deg;
  if (deg >= 67.5) return { dir: "vertical", deg };
  if (deg <= 22.5) return { dir: "horizontal", deg };
  return { dir: "diagonal", deg };
}

function finishCenterlineRow(p1, p2) {
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
  const len = Math.hypot(dx, dy);
  if (len < 8) return;
  const u = [dx / len, dy / len], v = [-u[1], u[0]];
  const hw = defaultRowWidth() / 2;
  const pts = [
    [p1[0] - v[0] * hw, p1[1] - v[1] * hw],
    [p1[0] + v[0] * hw, p1[1] + v[1] * hw],
    [p2[0] + v[0] * hw, p2[1] + v[1] * hw],
    [p2[0] - v[0] * hw, p2[1] - v[1] * hw],
  ];
  const { dir: autoClass, deg } = classifyDirection(p1, p2);
  let assignedLabel = S.label;
  if (!BOX()) {
    assignedLabel = autoClass;
    S.label = autoClass;
  }
  pushUndo();
  S.shapes.push({ label: assignedLabel, text: "", points: pts, group_id: null, shape_type: "polygon", flags: {} });
  const newIdx = S.shapes.length - 1;
  if (!BOX()) {
    reclassifyIndices([newIdx]);
    assignedLabel = S.shapes[newIdx].label;
  }
  S.sel = new Set([newIdx]);
  S.selV = null;
  S.draft = [];
  setMode("edit");
  markDirty();
  rebuildLabels();
  refreshAll();
  toast(assignedLabel === "both" ? `Row created · H+V detected → all classified “both”` : `Row created (${assignedLabel}) · Angle: ${deg.toFixed(1)}°`);
}

function addDraftPoint(ip) {
  const p = [ip[0], ip[1]];
  if (!S.draft.length) {
    S.draft.push(p);
    draw();
  } else {
    finishCenterlineRow(S.draft[0], p);
  }
}

function finishDraft() {
  if (S.draft.length >= 2) finishCenterlineRow(S.draft[0], S.draft[1]);
}
function createRows(a, b) {
  const rects = multiRects([a[0], a[1]], [b[0], b[1]]);
  pushUndo(); const start = S.shapes.length;
  for (const r of rects) S.shapes.push({ label: S.label, text: "", points: r, group_id: null, shape_type: "polygon", flags: {} });
  const newIdx = rects.map((_, k) => start + k);
  if (!BOX()) reclassifyIndices(newIdx);
  S.sel = new Set(newIdx); S.selV = null;
  setMode("edit"); markDirty(); renderLabels();
  toast(`${rects.length} rows created and selected. Rotate or adjust them in the right panel.`);
}

// ---------------------------------------------------------------- rectify tool
// Snaps a rough 4-vertex polygon into a geometrically clean rectangle of the same center, axis, and average dimensions.
function rectifyShape(sh) {
  if (!isClosed(sh)) return false;
  toPolygon(sh);
  if (sh.points.length !== ROW_VERTS) return false;
  const pts = sh.points;
  const { c, u, v } = axisOf(pts);
  let puLo = Infinity, puHi = -Infinity, pvLo = Infinity, pvHi = -Infinity;
  for (const p of pts) {
    const pu = (p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1];
    const pv = (p[0] - c[0]) * v[0] + (p[1] - c[1]) * v[1];
    if (pu < puLo) puLo = pu; if (pu > puHi) puHi = pu;
    if (pv < pvLo) pvLo = pv; if (pv > pvHi) pvHi = pv;
  }
  const hl = (puHi - puLo) / 2, hw = (pvHi - pvLo) / 2;
  if (hl < 1 || hw < 1) return false;
  sh.points = [
    [c[0] - u[0]*hl - v[0]*hw, c[1] - u[1]*hl - v[1]*hw],
    [c[0] - u[0]*hl + v[0]*hw, c[1] - u[1]*hl + v[1]*hw],
    [c[0] + u[0]*hl + v[0]*hw, c[1] + u[1]*hl + v[1]*hw],
    [c[0] + u[0]*hl - v[0]*hw, c[1] + u[1]*hl - v[1]*hw],
  ];
  return true;
}

function rectifySel() {
  const idx = [...S.sel].filter(i => S.shapes[i] && isClosed(S.shapes[i]));
  if (!idx.length) { toast('Select rows first'); return; }
  pushUndo();
  let n = 0;
  idx.forEach(i => { if (rectifyShape(S.shapes[i])) n++; });
  if (n) { markDirty(); toast(`${n} row${n > 1 ? 's' : ''} rectified`); }
  else { S.undo.pop(); toast('No suitable rows selected (need exactly 4-vertex polygons)'); }
}

// ---------------------------------------------------------------- slice tool
// Cuts a 4-vertex row into two separate 4-vertex rows perpendicular to row length at the click location.
function getSliceLine(sh, clickPt) {
  const pts = ptsOf(sh);
  if (!pts || pts.length < 3) return null;
  const { c, u } = axisOf(pts);
  const n = pts.length;
  const pr = pts.map(p => (p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1]);
  let lo = Infinity, hi = -Infinity;
  for (const val of pr) { if (val < lo) lo = val; if (val > hi) hi = val; }
  const mid = (hi + lo) / 2;

  const endA = [], endB = [];
  pr.forEach(val => { if (val < mid) endA.push(val); else endB.push(val); });
  if (!endA.length || !endB.length) return null;

  let maxA = -Infinity, minB = Infinity;
  for (const val of endA) if (val > maxA) maxA = val;
  for (const val of endB) if (val < minB) minB = val;
  if (minB - maxA < 4) return null;

  const rawClickU = (clickPt[0] - c[0]) * u[0] + (clickPt[1] - c[1]) * u[1];
  const clickU = Math.max(maxA + 2, Math.min(minB - 2, rawClickU));
  const d = pr.map(val => val - clickU);

  const inters = [];
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    const pA = pts[k], pB = pts[j];
    const dA = d[k], dB = d[j];
    if ((dA < 0 && dB > 0) || (dA > 0 && dB < 0)) {
      const t = dA / (dA - dB);
      inters.push([pA[0] + t * (pB[0] - pA[0]), pA[1] + t * (pB[1] - pA[1])]);
    }
  }
  return inters.length === 2 ? inters : null;
}

function computeLineSlice(pts, origin, u) {
  const n = pts.length;
  if (n < 3) return null;
  const d = pts.map(p => (p[0] - origin[0]) * u[0] + (p[1] - origin[1]) * u[1]);
  let minD = Infinity, maxD = -Infinity;
  for (const val of d) { if (val < minD) minD = val; if (val > maxD) maxD = val; }
  if (minD > -2.5 || maxD < 2.5) return null;

  const poly1 = [], poly2 = [];
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    const pA = pts[k], pB = pts[j];
    const dA = d[k], dB = d[j];

    if (dA <= 0) poly1.push([r2(pA[0]), r2(pA[1])]);
    if (dA >= 0) poly2.push([r2(pA[0]), r2(pA[1])]);

    if ((dA < -1e-6 && dB > 1e-6) || (dA > 1e-6 && dB < -1e-6)) {
      const t = dA / (dA - dB);
      const inter = [r2(pA[0] + t * (pB[0] - pA[0])), r2(pA[1] + t * (pB[1] - pA[1]))];
      poly1.push(inter);
      poly2.push(inter);
    }
  }

  if (poly1.length !== ROW_VERTS || poly2.length !== ROW_VERTS) return null;
  return { poly1, poly2 };
}

function getLineSliceSegment(pts, origin, u) {
  const n = pts.length;
  if (n < 3) return null;
  const d = pts.map(p => (p[0] - origin[0]) * u[0] + (p[1] - origin[1]) * u[1]);
  let minD = Infinity, maxD = -Infinity;
  for (const val of d) { if (val < minD) minD = val; if (val > maxD) maxD = val; }
  if (minD > -2.5 || maxD < 2.5) return null;

  const inters = [];
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    const pA = pts[k], pB = pts[j];
    const dA = d[k], dB = d[j];
    if ((dA < -1e-6 && dB > 1e-6) || (dA > 1e-6 && dB < -1e-6)) {
      const t = dA / (dA - dB);
      inters.push([pA[0] + t * (pB[0] - pA[0]), pA[1] + t * (pB[1] - pA[1])]);
    }
  }
  return inters.length === 2 ? inters : null;
}

function sliceShapeAt(i, clickPt) {
  const sh = S.shapes[i];
  if (!sh || !isClosed(sh)) return false;
  toPolygon(sh);
  const pts = sh.points;
  if (pts.length < 3) return false;

  const { c, u } = axisOf(pts);
  const n = pts.length;
  const pr = pts.map(p => (p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1]);
  let lo = Infinity, hi = -Infinity;
  for (const val of pr) { if (val < lo) lo = val; if (val > hi) hi = val; }
  const mid = (hi + lo) / 2;

  const endA = [], endB = [];
  pr.forEach(val => { if (val < mid) endA.push(val); else endB.push(val); });
  if (!endA.length || !endB.length) return false;

  let maxA = -Infinity, minB = Infinity;
  for (const val of endA) if (val > maxA) maxA = val;
  for (const val of endB) if (val < minB) minB = val;
  if (minB - maxA < 4) {
    toast("Row is too short to slice");
    return false;
  }

  const rawClickU = (clickPt[0] - c[0]) * u[0] + (clickPt[1] - c[1]) * u[1];
  if (rawClickU < maxA - 2 || rawClickU > minB + 2) {
    toast("Click further inside the row to slice it");
    return false;
  }
  const clickU = Math.max(maxA + 2, Math.min(minB - 2, rawClickU));
  const d = pr.map(val => val - clickU);

  const poly1 = [], poly2 = [];
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    const pA = pts[k], pB = pts[j];
    const dA = d[k], dB = d[j];

    if (dA <= 0) poly1.push([r2(pA[0]), r2(pA[1])]);
    if (dA >= 0) poly2.push([r2(pA[0]), r2(pA[1])]);

    if ((dA < 0 && dB > 0) || (dA > 0 && dB < 0)) {
      const t = dA / (dA - dB);
      const inter = [r2(pA[0] + t * (pB[0] - pA[0])), r2(pA[1] + t * (pB[1] - pA[1]))];
      poly1.push(inter);
      poly2.push(inter);
    }
  }

  if (poly1.length !== ROW_VERTS || poly2.length !== ROW_VERTS) {
    toast("Could not slice cleanly into 4-corner rows");
    return false;
  }

  pushUndo();

  const piece1 = {
    label: sh.label,
    text: sh.text || "",
    points: poly1,
    group_id: sh.group_id || null,
    shape_type: "polygon",
    flags: { ...(sh.flags || {}) }
  };
  const piece2 = {
    label: sh.label,
    text: sh.text || "",
    points: poly2,
    group_id: sh.group_id || null,
    shape_type: "polygon",
    flags: { ...(sh.flags || {}) }
  };

  S.shapes.splice(i, 1, piece1, piece2);
  S.sel = new Set([i, i + 1]);
  S.selV = null;

  markDirty();
  renderLabels();
  refreshAll();
  toast("Row cut into 2 pieces ✓");
  return true;
}

function sliceMultipleRowsAt(selRows, clickPt, clickedIdx) {
  if (!selRows || !selRows.length) return false;

  // 1. Determine reference direction u
  let refU = null;
  if (clickedIdx >= 0 && selRows.includes(clickedIdx)) {
    const pts = ptsOf(S.shapes[clickedIdx]);
    if (pts && pts.length >= 3) refU = axisOf(pts).u;
  }
  if (!refU) {
    let sumUx = 0, sumUy = 0, baseU = null;
    for (const idx of selRows) {
      const pts = ptsOf(S.shapes[idx]);
      if (!pts || pts.length < 3) continue;
      const u = axisOf(pts).u;
      if (!baseU) {
        baseU = u;
        sumUx += u[0];
        sumUy += u[1];
      } else {
        const dot = u[0] * baseU[0] + u[1] * baseU[1];
        if (dot < 0) { sumUx -= u[0]; sumUy -= u[1]; }
        else { sumUx += u[0]; sumUy += u[1]; }
      }
    }
    const len = Math.hypot(sumUx, sumUy);
    refU = len > 1e-6 ? [sumUx / len, sumUy / len] : [0, 1];
  }

  // 2. Identify all candidate rows intersected by the cut line
  const cutCandidates = [];
  for (const idx of selRows) {
    const sh = S.shapes[idx];
    if (!sh || !isClosed(sh)) continue;
    toPolygon(sh);
    const pts = sh.points;
    if (pts.length < 3) continue;

    const res = computeLineSlice(pts, clickPt, refU);
    if (res) {
      cutCandidates.push({ idx, sh, poly1: res.poly1, poly2: res.poly2 });
    }
  }

  if (!cutCandidates.length) {
    toast("Cut line does not intersect selected rows");
    return false;
  }

  pushUndo();

  // 3. Splice shapes in descending index order
  cutCandidates.sort((a, b) => b.idx - a.idx);
  const cutMap = new Map(cutCandidates.map(c => [c.idx, true]));
  const originalCount = S.shapes.length;

  for (const item of cutCandidates) {
    const sh = item.sh;
    const piece1 = {
      label: sh.label,
      text: sh.text || "",
      points: item.poly1,
      group_id: sh.group_id || null,
      shape_type: "polygon",
      flags: { ...(sh.flags || {}) }
    };
    const piece2 = {
      label: sh.label,
      text: sh.text || "",
      points: item.poly2,
      group_id: sh.group_id || null,
      shape_type: "polygon",
      flags: { ...(sh.flags || {}) }
    };
    S.shapes.splice(item.idx, 1, piece1, piece2);
  }

  // 4. Update S.sel so all cut pieces and any uncut selected rows stay selected
  const newSel = new Set();
  let newIdx = 0;
  for (let oldI = 0; oldI < originalCount; oldI++) {
    if (cutMap.has(oldI)) {
      newSel.add(newIdx);
      newSel.add(newIdx + 1);
      newIdx += 2;
    } else {
      if (S.sel.has(oldI)) newSel.add(newIdx);
      newIdx += 1;
    }
  }

  S.sel = newSel;
  S.selV = null;
  markDirty();
  renderLabels();
  refreshAll();
  toast(`Sliced ${cutCandidates.length} row${cutCandidates.length > 1 ? "s" : ""} at image line ✓`);
  return true;
}

function drawSlicePreview() {
  if (!S.cursor || !S.img) return;
  const hs = hitShape(S.cursor);
  const selRows = [...S.sel].filter(i => S.shapes[i] && isClosed(S.shapes[i]) && S.shapes[i]._vis !== false);

  if (selRows.length > 1) {
    let refU = null;
    if (hs >= 0 && selRows.includes(hs)) {
      const pts = ptsOf(S.shapes[hs]);
      if (pts && pts.length >= 3) refU = axisOf(pts).u;
    }
    if (!refU) {
      let sumUx = 0, sumUy = 0, baseU = null;
      for (const idx of selRows) {
        const pts = ptsOf(S.shapes[idx]);
        if (!pts || pts.length < 3) continue;
        const u = axisOf(pts).u;
        if (!baseU) { baseU = u; sumUx += u[0]; sumUy += u[1]; }
        else {
          const dot = u[0] * baseU[0] + u[1] * baseU[1];
          if (dot < 0) { sumUx -= u[0]; sumUy -= u[1]; }
          else { sumUx += u[0]; sumUy += u[1]; }
        }
      }
      const len = Math.hypot(sumUx, sumUy);
      refU = len > 1e-6 ? [sumUx / len, sumUy / len] : [0, 1];
    }

    const segments = [];
    let minScrX = Infinity, maxScrX = -Infinity, minScrY = Infinity, maxScrY = -Infinity;

    for (const idx of selRows) {
      const sh = S.shapes[idx];
      const pts = ptsOf(sh);
      if (!pts || pts.length < 3) continue;
      const seg = getLineSliceSegment(pts, S.cursor, refU);
      if (seg) {
        segments.push(seg);
        const s1 = toScr(seg[0]), s2 = toScr(seg[1]);
        minScrX = Math.min(minScrX, s1[0], s2[0]);
        maxScrX = Math.max(maxScrX, s1[0], s2[0]);
        minScrY = Math.min(minScrY, s1[1], s2[1]);
        maxScrY = Math.max(maxScrY, s1[1], s2[1]);
      }
    }

    if (!segments.length) return;

    ctx.save();

    // 1. Draw connecting transverse guide line
    const v = [-refU[1], refU[0]];
    const curScr = toScr(S.cursor);
    const span = Math.max(100, Math.hypot(maxScrX - minScrX, maxScrY - minScrY) + 80);
    const g1 = [curScr[0] - v[0] * span, curScr[1] - v[1] * span];
    const g2 = [curScr[0] + v[0] * span, curScr[1] + v[1] * span];

    ctx.beginPath();
    ctx.moveTo(g1[0], g1[1]);
    ctx.lineTo(g2[0], g2[1]);
    ctx.strokeStyle = "rgba(77, 170, 252, 0.45)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. Draw cut line on each affected row
    for (const seg of segments) {
      const p1 = toScr(seg[0]), p2 = toScr(seg[1]);
      ctx.beginPath();
      ctx.moveTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);
      ctx.strokeStyle = "#ffd400";
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      [p1, p2].forEach(p => {
        ctx.beginPath();
        ctx.arc(p[0], p[1], 4.5, 0, Math.PI * 2);
        ctx.fillStyle = "#ff4444";
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
      });
    }

    // 3. Floating counter pill at cursor
    const badgeText = `Cut ${segments.length} row${segments.length > 1 ? "s" : ""}`;
    ctx.font = "600 11px Inter, system-ui, sans-serif";
    const tw = ctx.measureText(badgeText).width;
    const bx = curScr[0] + 16, by = curScr[1] - 12;
    ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
    ctx.beginPath();
    ctx.roundRect(bx - 6, by - 14, tw + 12, 20, 4);
    ctx.fill();
    ctx.strokeStyle = "#ffd400";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(badgeText, bx, by);

    // Mini center reticle dot
    ctx.beginPath();
    ctx.arc(curScr[0], curScr[1], 3, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();

    ctx.restore();
    return;
  }

  // Single row preview fallback
  if (hs < 0) return;
  const line = getSliceLine(S.shapes[hs], S.cursor);
  if (!line) return;
  const p1 = toScr(line[0]), p2 = toScr(line[1]), qc = toScr(S.cursor);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(p1[0], p1[1]);
  ctx.lineTo(p2[0], p2[1]);
  ctx.strokeStyle = "#ffd400";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(p1[0], p1[1]);
  ctx.lineTo(p2[0], p2[1]);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  [p1, p2].forEach(p => {
    ctx.beginPath();
    ctx.arc(p[0], p[1], 4.5, 0, Math.PI * 2);
    ctx.fillStyle = "#ff4444";
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });

  ctx.beginPath();
  ctx.arc(qc[0], qc[1], 3, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  ctx.restore();
}

// ---------------------------------------------------------------- downsampled offscreen canvas for fast CV (max 1600px)
// Downsampling 8064x6048 -> 1600x1200 cuts CV RAM from 195MB to 7.6MB (25x faster) and naturally denoises glare/speckles.
let offscreenCv = null, offscreenCtx = null, offscreenBuf = null, offscreenScale = 1, offscreenW = 0, offscreenH = 0;
function getOffscreenBuffer() {
  if (!S.img || !S.W || !S.H) return null;
  const targetScale = Math.min(1, 1600 / Math.max(S.W, S.H));
  const tw = Math.max(1, Math.round(S.W * targetScale));
  const th = Math.max(1, Math.round(S.H * targetScale));
  if (!offscreenBuf || offscreenW !== tw || offscreenH !== th) {
    offscreenCv = document.createElement("canvas");
    offscreenCv.width = tw;
    offscreenCv.height = th;
    offscreenCtx = offscreenCv.getContext("2d", { willReadFrequently: true });
    offscreenCtx.drawImage(S.img, 0, 0, tw, th);
    offscreenBuf = offscreenCtx.getImageData(0, 0, tw, th).data;
    offscreenScale = tw / S.W;
    offscreenW = tw;
    offscreenH = th;
  }
  return { data: offscreenBuf, scale: offscreenScale, w: offscreenW, h: offscreenH };
}

function sampleCvPixel(buf, ix, iy) {
  const lx = Math.round(ix * buf.scale);
  const ly = Math.round(iy * buf.scale);
  if (lx < 0 || lx >= buf.w || ly < 0 || ly >= buf.h) return null;
  const idx = (ly * buf.w + lx) * 4;
  const r = buf.data[idx], g = buf.data[idx + 1], b = buf.data[idx + 2];
  return { r, g, b, lum: 0.299 * r + 0.587 * g + 0.114 * b, exg: 2 * g - r - b };
}

// ---------------------------------------------------------------- plant foliage alignment (Alt+P)
// Fixed: strictly translates perpendicularly along v — ZERO drift along parallel axis u!
function alignRowToPlants(sh) {
  if (!S.img || !isClosed(sh)) return false;
  toPolygon(sh);
  if (sh.points.length !== ROW_VERTS) return false;
  const buf = getOffscreenBuffer();
  if (!buf) return false;

  const pts = sh.points;
  const { c, u, v } = axisOf(pts);
  let puLo = Infinity, puHi = -Infinity, pvLo = Infinity, pvHi = -Infinity;
  for (const p of pts) {
    const pu = (p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1];
    const pv = (p[0] - c[0]) * v[0] + (p[1] - c[1]) * v[1];
    if (pu < puLo) puLo = pu; if (pu > puHi) puHi = pu;
    if (pv < pvLo) pvLo = pv; if (pv > pvHi) pvHi = pv;
  }
  const hl = (puHi - puLo) / 2, hw = (pvHi - pvLo) / 2;
  if (hl < 5 || hw < 2) return false;

  const N_SLICES = 18;
  const stepImg = Math.max(1, 1 / buf.scale);
  const maxOffset = hw * 1.5;
  const sliceOffsets = [];

  for (let k = 0; k < N_SLICES; k++) {
    const tAlong = -hl * 0.85 + (2 * hl * 0.85) * (k / (N_SLICES - 1));
    const sx = c[0] + u[0] * tAlong, sy = c[1] + u[1] * tAlong;

    let wSum = 0, offsetSum = 0;
    for (let s = -maxOffset; s <= maxOffset; s += stepImg) {
      const px = sampleCvPixel(buf, sx + v[0] * s, sy + v[1] * s);
      if (!px) continue;
      if (px.exg > 18) {
        wSum += px.exg;
        offsetSum += px.exg * s;
      }
    }
    if (wSum > 60) sliceOffsets.push(offsetSum / wSum);
  }

  if (sliceOffsets.length < 3) return false;
  // Robust median perpendicular offset (immune to outlier weeds or missing-plant gaps at either end!)
  sliceOffsets.sort((a, b) => a - b);
  const medOffset = sliceOffsets[Math.floor(sliceOffsets.length / 2)];
  const clampedShift = Math.max(-hw * 1.35, Math.min(hw * 1.35, medOffset));
  if (Math.abs(clampedShift) < 0.5) return false;

  // Translate strictly along perpendicular vector v — ZERO parallel displacement along u!
  sh.points = pts.map(p => [p[0] + v[0] * clampedShift, p[1] + v[1] * clampedShift]);
  return true;
}

function alignSelToPlants() {
  if (!S.img) { toast('Open an image first'); return; }
  const idx = [...S.sel].filter(i => S.shapes[i] && isClosed(S.shapes[i]));
  if (!idx.length) { toast('Select rows first'); return; }
  pushUndo();
  let n = 0;
  idx.forEach(i => { if (alignRowToPlants(S.shapes[i])) n++; });
  if (n) {
    markDirty();
    toast(`🌱 ${n} row${n > 1 ? 's' : ''} aligned perpendicularly to potato plants (zero parallel drift)`);
  } else {
    S.undo.pop();
    toast('No green plants detected inside selected rows (or already centered)');
  }
}

// ---------------------------------------------------------------- perspective angle gradient & VP calibration
function normAngle(a) {
  while (a > Math.PI / 2) a -= Math.PI;
  while (a <= -Math.PI / 2) a += Math.PI;
  return a;
}

function setRowAngle(sh, targetAng) {
  if (!isClosed(sh)) return false;
  toPolygon(sh);
  if (sh.points.length !== ROW_VERTS) return false;
  const pts = sh.points;
  const ax = axisOf(pts);
  const curAng = Math.atan2(ax.u[1], ax.u[0]);
  let delta = targetAng - curAng;
  while (delta > Math.PI / 2) delta -= Math.PI;
  while (delta <= -Math.PI / 2) delta += Math.PI;
  if (Math.abs(delta) < 0.0005) return false;
  sh.points = pts.map(p => rotPt(p, ax.c, delta));
  return true;
}

function getPerspectiveAngleAt(c) {
  if (!S.vp && !S.gradient) return null;

  // 1. If Vanishing Point exists, true perspective angle is the line from VP through row center
  if (S.vp) {
    const dx = c[0] - S.vp.x, dy = c[1] - S.vp.y;
    if (Math.hypot(dx, dy) >= 1e-3) {
      return Math.atan2(dy, dx);
    }
  }

  // 2. If parallel rows or VP not finite, interpolate across field from Master 1 to Master 2
  if (S.gradient && S.gradient.spanSq > 1) {
    const g = S.gradient;
    const proj = ((c[0] - g.P1[0]) * g.dPx + (c[1] - g.P1[1]) * g.dPy) / g.spanSq;
    const t = Math.max(0, Math.min(1, proj));
    const ux = (1 - t) * g.u1[0] + t * g.u2[0];
    const uy = (1 - t) * g.u1[1] + t * g.u2[1];
    return Math.atan2(uy, ux);
  }

  return null;
}

// Smoothly interpolates angles across 3 or more rows based on their position across the field
function applyAngleGradient(rowIndices) {
  if (!rowIndices || rowIndices.length < 3) return false;
  const list = rowIndices.map(i => ({ i, sh: S.shapes[i], pts: ptsOf(S.shapes[i]) }));
  list.forEach(item => {
    toPolygon(item.sh);
    const ax = axisOf(item.pts);
    item.c = ax.c; item.u = ax.u; item.v = ax.v;
  });

  // Align direction of u vectors to the first item
  for (let k = 1; k < list.length; k++) {
    if (list[k].u[0] * list[0].u[0] + list[k].u[1] * list[0].u[1] < 0) {
      list[k].u = [-list[k].u[0], -list[k].u[1]];
    }
  }

  let ux = 0, uy = 0;
  list.forEach(item => { ux += item.u[0]; uy += item.u[1]; });
  const uLen = Math.hypot(ux, uy) || 1;
  const avgU = [ux / uLen, uy / uLen];
  const vAcross = [-avgU[1], avgU[0]];

  list.forEach(item => { item.pos = item.c[0] * vAcross[0] + item.c[1] * vAcross[1]; });
  list.sort((a, b) => a.pos - b.pos);
  const item0 = list[0], itemN = list[list.length - 1];
  const span = itemN.pos - item0.pos;
  if (span < 10) return false;

  const u0 = item0.u, uN = itemN.u;
  const dPx = itemN.c[0] - item0.c[0], dPy = itemN.c[1] - item0.c[1];
  const D = u0[0] * uN[1] - u0[1] * uN[0];
  let VP = null;
  if (Math.abs(D) >= 8e-4) {
    const s = (dPx * uN[1] - dPy * uN[0]) / D;
    VP = { x: item0.c[0] + s * u0[0], y: item0.c[1] + s * u0[1] };
  }

  let changed = 0;
  for (let k = 1; k < list.length - 1; k++) {
    const item = list[k];
    let targetAng;
    if (VP) {
      targetAng = Math.atan2(item.c[1] - VP.y, item.c[0] - VP.x);
    } else {
      const t = (item.pos - item0.pos) / span;
      const uxInterp = (1 - t) * u0[0] + t * uN[0];
      const uyInterp = (1 - t) * u0[1] + t * uN[1];
      targetAng = Math.atan2(uyInterp, uxInterp);
    }
    if (setRowAngle(item.sh, targetAng)) changed++;
  }
  return changed;
}

function alignAngleGradientSel() {
  const idx = [...S.sel].filter(i => S.shapes[i] && isClosed(S.shapes[i]));
  if (idx.length >= 3) {
    pushUndo();
    const count = applyAngleGradient(idx);
    if (count) {
      markDirty();
      toast(`🌿 Angle gradient applied: ${count} intermediate row${count > 1 ? 's' : ''} aligned smoothly`);
    } else {
      S.undo.pop();
      toast('Rows are too close together to compute a gradient');
    }
    return;
  }
  if (idx.length === 2) {
    // 2 rows: calibrate the field gradient
    calibrateVP();
    return;
  }
  if (idx.length === 1 && (S.gradient || S.vp)) {
    // 1 row: snap to calibrated gradient
    pushUndo();
    const sh = S.shapes[idx[0]];
    if (snapAngleToVP(sh, isCalibMaster(sh))) {
      markDirty();
      toast('Row snapped to field perspective gradient');
    } else {
      S.undo.pop();
      toast('Row already matches calibrated perspective');
    }
    return;
  }
  toast('Select 3 or more rows to interpolate gradient, or 2 boundary rows to calibrate');
}

function isCalibMaster(sh) {
  return !!(sh && (sh._master || (S.calibMasters && S.calibMasters.has(sh))));
}

function getEndMidpoints(pts, u) {
  const c = centroid(pts);
  const proj = pts.map(p => ({ p, pu: (p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1] }));
  proj.sort((a, b) => a.pu - b.pu);
  return {
    endA: centroid([proj[0].p, proj[1].p]),
    endB: centroid([proj[proj.length - 2].p, proj[proj.length - 1].p])
  };
}

function getTouchBorders(pt) {
  const tol = Math.max(4, Math.min(S.W || 1000, S.H || 1000) * 0.002); // ~12px on 8064x6048; preserves intentional 20px+ insets
  const b = new Set();
  if (pt[0] <= tol) b.add("left");
  if (pt[0] >= S.W - tol) b.add("right");
  if (pt[1] <= tol) b.add("top");
  if (pt[1] >= S.H - tol) b.add("bottom");
  return b;
}

function buildEndBoundary(p1, p2) {
  const b1 = getTouchBorders(p1), b2 = getTouchBorders(p2);
  let shared = null;
  for (const ed of b1) { if (b2.has(ed)) { shared = ed; break; } }
  if (shared) return { mode: "singleBorder", border: shared, p1, p2 };
  if (b1.size > 0 && b2.size > 0) return { mode: "imageFrame", p1, p2 }; // Diagonal multi-border corner case!
  return { mode: "line", p1, p2 };
}

function computeCalibFromPair(sh1, sh2) {
  toPolygon(sh1); toPolygon(sh2);
  const pts1 = ptsOf(sh1), pts2 = ptsOf(sh2);
  if (pts1.length !== ROW_VERTS || pts2.length !== ROW_VERTS) return false;
  const ax1 = axisOf(pts1), ax2 = axisOf(pts2);
  let u1 = [ax1.u[0], ax1.u[1]];
  let u2 = [ax2.u[0], ax2.u[1]];
  if (u1[0] * u2[0] + u1[1] * u2[1] < 0) u2 = [-u2[0], -u2[1]];

  const P1 = ax1.c, P2 = ax2.c;
  const ang1 = Math.atan2(u1[1], u1[0]);
  const ang2 = Math.atan2(u2[1], u2[0]);
  const dPx = P2[0] - P1[0], dPy = P2[1] - P1[1];
  const spanSq = dPx * dPx + dPy * dPy;

  const D = u1[0] * u2[1] - u1[1] * u2[0];
  let vp = null;
  if (Math.abs(D) >= 8e-4) {
    const s = (dPx * u2[1] - dPy * u2[0]) / D;
    vp = { x: P1[0] + s * u1[0], y: P1[1] + s * u1[1] };
  }
  S.vp = vp;
  S.gradient = { P1, u1, ang1, P2, u2, ang2, dPx, dPy, spanSq };

  const e1 = getEndMidpoints(pts1, u1);
  const e2 = getEndMidpoints(pts2, u2);
  const avgUx = u1[0] + u2[0], avgUy = u1[1] + u2[1];
  const avgULen = Math.hypot(avgUx, avgUy) || 1;
  const uRef = [avgUx / avgULen, avgUy / avgULen];
  const vRef = [-uRef[1], uRef[0]];
  S.calibBounds = {
    endA: buildEndBoundary(e1.endA, e2.endA),
    endB: buildEndBoundary(e1.endB, e2.endB),
    uRef, vRef,
    masters: [sh1, sh2]
  };
  return { ang1, ang2, vp };
}

function refreshCalibIfActive() {
  if (!S.vp && !S.gradient && !S.calibBounds) return;
  const masters = S.shapes.filter(s => s && s._master && isClosed(s) && ptsOf(s).length === ROW_VERTS);
  if (masters.length === 2) {
    S.calibMasters = new Set(masters);
    computeCalibFromPair(masters[0], masters[1]);
  }
}

// Computes Perspective Gradient, Vanishing Point, AND End-A / End-B Master Boundary Lines from 2 outer rows
function calibrateVP() {
  const idx = [...S.sel].filter(i => S.shapes[i] && isClosed(S.shapes[i]));
  if (idx.length !== 2) { toast('Select exactly 2 boundary rows to calibrate perspective'); return; }

  const sh1 = S.shapes[idx[0]], sh2 = S.shapes[idx[1]];
  toPolygon(sh1); toPolygon(sh2);
  const pts1 = ptsOf(sh1), pts2 = ptsOf(sh2);
  if (pts1.length !== ROW_VERTS || pts2.length !== ROW_VERTS) {
    toast('Both master rows must have 4 vertices');
    return;
  }

  S.shapes.forEach(s => { if (s) delete s._master; });
  sh1._master = 1;
  sh2._master = 2;
  S.calibMasters = new Set([sh1, sh2]);

  const res = computeCalibFromPair(sh1, sh2);
  if (!res) return;

  updateHudVpStyle();
  const deg1 = Math.round(normAngle(res.ang1) * 180 / Math.PI * 10) / 10;
  const deg2 = Math.round(normAngle(res.ang2) * 180 / Math.PI * 10) / 10;
  const modeDesc = res.vp ? 'Vanishing point' : 'Parallel field';
  toast(`📍 Calibrated (${deg1}° → ${deg2}° · ${modeDesc}). Select all (Ctrl+A) → Alt+A Angles · Alt+B Snap Beds · Alt+E Align Ends.`);
}

// ---------------------------------------------------------------- snap angle (Alt+A)
function snapAngleToVP(sh, isMaster = false) {
  if (isMaster || isCalibMaster(sh)) return false; // Never alter the calibrated master boundary rows!
  if (!isClosed(sh)) return false;
  toPolygon(sh);
  if (sh.points.length !== ROW_VERTS) return false;

  const pts = sh.points;
  const ax = axisOf(pts);
  const targetAng = getPerspectiveAngleAt(ax.c);
  if (targetAng == null) return false;

  // Guard: skip perpendicular rows (> 30 deg off calibrated angle)
  const curAng = Math.atan2(ax.u[1], ax.u[0]);
  let diff = Math.abs(normAngle(curAng - targetAng));
  if (diff > Math.PI / 2) diff = Math.PI - diff;
  if (diff > 30 * Math.PI / 180) return false;

  return setRowAngle(sh, targetAng);
}

function snapAngleSel(quiet = false) {
  quiet = (quiet === true);
  const idx = [...S.sel].filter(i => S.shapes[i] && isClosed(S.shapes[i]));
  if (!idx.length) { if (!quiet) toast('Select rows first'); return 0; }

  // Priority 1: If perspective has been calibrated, snap using ground-truth calibration
  if (S.vp || S.gradient) {
    refreshCalibIfActive();
    if (!quiet) pushUndo();
    let n = 0;
    idx.forEach(i => {
      const sh = S.shapes[i];
      if (snapAngleToVP(sh, isCalibMaster(sh))) n++;
    });
    if (n) {
      if (!BOX()) reclassifyIndices(idx);
      if (!quiet) {
        markDirty();
        toast(`🎯 ${n} row${n > 1 ? 's' : ''} snapped to calibrated perspective (master rows preserved)`);
      }
    } else if (!quiet) {
      S.undo.pop();
      toast('Selected rows already match the calibrated perspective');
    }
    return n;
  }

  // Priority 2: 3+ rows selected without calibration -> auto perspective gradient
  if (idx.length >= 3) {
    if (!quiet) pushUndo();
    const count = applyAngleGradient(idx);
    if (count) {
      if (!BOX()) reclassifyIndices(idx);
      if (!quiet) {
        markDirty();
        toast(`🧲 Angle gradient snapped across ${count} intermediate rows (outer rows preserved)`);
      }
      return count;
    }
    if (!quiet) {
      S.undo.pop();
      toast('Could not calculate angle gradient');
    }
    return 0;
  }

  // Priority 3: 1 or 2 rows without calibration
  if (!quiet) toast('Calibrate perspective first: select 2 outer rows and press Calibrate (C).');
  return 0;
}

// ---------------------------------------------------------------- Master Boundary Endpoint Alignment (Alt+E)
function intersectRayWithBoundary(c, dir, boundary) {
  if (!boundary || !S.W || !S.H) return null;
  if (boundary.mode === "imageFrame") {
    const hit = rayToBorder(c, dir);
    return hit ? hit.pt : null;
  }
  if (boundary.mode === "singleBorder") {
    const ed = boundary.border;
    let t = Infinity;
    if (ed === "left" && Math.abs(dir[0]) > 1e-6) t = (0 - c[0]) / dir[0];
    else if (ed === "right" && Math.abs(dir[0]) > 1e-6) t = (S.W - c[0]) / dir[0];
    else if (ed === "top" && Math.abs(dir[1]) > 1e-6) t = (0 - c[1]) / dir[1];
    else if (ed === "bottom" && Math.abs(dir[1]) > 1e-6) t = (S.H - c[1]) / dir[1];
    if (isFinite(t) && t > 0) {
      const q = [c[0] + dir[0] * t, c[1] + dir[1] * t];
      if (inside(q)) return q;
    }
    const hit = rayToBorder(c, dir);
    return hit ? hit.pt : null;
  }
  // mode === "line" (uniform inset or sloped rotated headland line p1 -> p2)
  const dLx = boundary.p2[0] - boundary.p1[0], dLy = boundary.p2[1] - boundary.p1[1];
  const lLen = Math.hypot(dLx, dLy);
  if (lLen < 1) return null;
  const lux = dLx / lLen, luy = dLy / lLen;
  const det = dir[0] * luy - dir[1] * lux;
  if (Math.abs(det) < 0.15) return null; // Reject near-parallel degenerate intersection
  const rx = boundary.p1[0] - c[0], ry = boundary.p1[1] - c[1];
  const t = (rx * luy - ry * lux) / det;
  if (!isFinite(t)) return null;
  const q = [c[0] + dir[0] * t, c[1] + dir[1] * t];
  if (!inside(q)) {
    // Extrapolated slope exited image frame: clip cleanly to image border
    const hit = rayToBorder(c, dir);
    return hit ? hit.pt : null;
  }
  return q;
}

function alignEndsToMasters(quiet = false) {
  quiet = (quiet === true);
  refreshCalibIfActive();
  if (!S.calibBounds) {
    if (!quiet) toast('Calibrate 2 outer Master rows first (select 2 outer rows and press C)');
    return 0;
  }
  const idx = [...S.sel].filter(i => S.shapes[i] && isClosed(S.shapes[i]));
  if (!idx.length) { if (!quiet) toast('Select rows first'); return 0; }

  const { endA, endB, uRef, vRef } = S.calibBounds;
  const candidates = [];

  for (const i of idx) {
    const sh = S.shapes[i];
    toPolygon(sh);
    if (sh.points.length !== ROW_VERTS) continue;
    const ax = axisOf(sh.points);
    let u = [ax.u[0], ax.u[1]];
    if (u[0] * uRef[0] + u[1] * uRef[1] < 0) u = [-u[0], -u[1]];
    // Guard: skip perpendicular rows (> 30 deg off calibrated Master direction)
    const dot = Math.abs(u[0] * uRef[0] + u[1] * uRef[1]);
    if (dot < Math.cos(30 * Math.PI / 180)) continue;
    const v = [-u[1], u[0]];
    const prU = sh.points.map(p => (p[0] - ax.c[0]) * u[0] + (p[1] - ax.c[1]) * u[1]);
    const prV = sh.points.map(p => (p[0] - ax.c[0]) * v[0] + (p[1] - ax.c[1]) * v[1]);
    const uMin = Math.min(...prU), uMax = Math.max(...prU);
    const hw = (Math.max(...prV) - Math.min(...prV)) / 2;
    candidates.push({
      i, sh, isMaster: isCalibMaster(sh), c: ax.c, u, v, uMin, uMax, hw,
      posV: ax.c[0] * vRef[0] + ax.c[1] * vRef[1],
      posU: ax.c[0] * uRef[0] + ax.c[1] * uRef[1]
    });
  }
  if (!candidates.length) {
    if (!quiet) toast('No matching-direction 4-vertex rows selected');
    return 0;
  }

  // Group collinear split rows (rows sharing the same bed centerline along vRef)
  candidates.sort((a, b) => a.posV - b.posV);
  const groups = [];
  for (const item of candidates) {
    const lastG = groups[groups.length - 1];
    if (lastG && Math.abs(item.posV - lastG[0].posV) < Math.max(12, item.hw * 0.9)) {
      lastG.push(item);
    } else {
      groups.push([item]);
    }
  }

  if (!quiet) pushUndo();
  let changed = 0;

  for (const grp of groups) {
    grp.sort((a, b) => a.posU - b.posU);
    const first = grp[0];
    const last = grp[grp.length - 1];

    // Helper to slide End-A and/or End-B vertices along item.u while preserving per-end width/taper
    const applyEnds = (item, newPtA, newPtB) => {
      if (item.isMaster) return false;
      const pts = item.sh.points;
      const proj = pts.map((p, k) => ({
        k, p,
        pu: (p[0] - item.c[0]) * item.u[0] + (p[1] - item.c[1]) * item.u[1]
      }));
      proj.sort((a, b) => a.pu - b.pu);
      const idxA = [proj[0].k, proj[1].k];
      const idxB = [proj[2].k, proj[3].k];
      const curA = centroid(idxA.map(k => pts[k]));
      const curB = centroid(idxB.map(k => pts[k]));
      const pA = newPtA || curA;
      const pB = newPtB || curB;
      const dA = (pA[0] - curA[0]) * item.u[0] + (pA[1] - curA[1]) * item.u[1];
      const dB = (pB[0] - curB[0]) * item.u[0] + (pB[1] - curB[1]) * item.u[1];
      const curLen = (curB[0] - curA[0]) * item.u[0] + (curB[1] - curA[1]) * item.u[1];
      const newLen = curLen + dB - dA;
      if (newLen < 12) return false;
      if (Math.abs(dA) < 1 && Math.abs(dB) < 1) return false;
      const nextPts = pts.map(p => [p[0], p[1]]);
      if (newPtA && Math.abs(dA) >= 0.5) {
        idxA.forEach(k => { nextPts[k] = [pts[k][0] + item.u[0] * dA, pts[k][1] + item.u[1] * dA]; });
      }
      if (newPtB && Math.abs(dB) >= 0.5) {
        idxB.forEach(k => { nextPts[k] = [pts[k][0] + item.u[0] * dB, pts[k][1] + item.u[1] * dB]; });
      }
      item.sh.points = nextPts;
      // If an end touched an image border at a diagonal angle, flush-clip cleanly inside [0, W]x[0, H]
      const fp = fittedPoints(item.sh, false);
      if (fp) item.sh.points = fp;
      return true;
    };

    const firstEnds = getEndMidpoints(first.sh.points, first.u);
    const lastEnds = getEndMidpoints(last.sh.points, last.u);
    if (grp.length === 1) {
      const ptA = intersectRayWithBoundary(firstEnds.endA, [-first.u[0], -first.u[1]], endA);
      const ptB = intersectRayWithBoundary(firstEnds.endB, first.u, endB);
      if (applyEnds(first, ptA, ptB)) changed++;
    } else {
      // Collinear split pair: align ONLY outer End-A of first piece & outer End-B of last piece (middle cut preserved!)
      const ptA = intersectRayWithBoundary(firstEnds.endA, [-first.u[0], -first.u[1]], endA);
      if (applyEnds(first, ptA, null)) changed++;
      const ptB = intersectRayWithBoundary(lastEnds.endB, last.u, endB);
      if (applyEnds(last, null, ptB)) changed++;
    }
  }

  if (changed) {
    if (!quiet) {
      markDirty();
      toast(`📏 Aligned ends of ${changed} row${changed > 1 ? 's' : ''} to Master boundaries (split gaps preserved)`);
    }
  } else if (!quiet) {
    S.undo.pop();
    toast('Selected rows are already aligned to Master boundaries');
  }
  return changed;
}

// ---------------------------------------------------------------- Hybrid Bed-Centering Engine (Alt+B)
// Combines Master Bed-vs-Furrow RGB/Luminance Signature + Excess Green (ExG) + Matched Surround Filter + Spacing Prior.
function learnMasterBedSignature(buf, masterItems, pitch) {
  const bedAcc = { r: 0, g: 0, b: 0, lum: 0, exg: 0, n: 0 };
  const furAcc = { r: 0, g: 0, b: 0, lum: 0, exg: 0, n: 0 };
  const stepImg = Math.max(1, 1 / buf.scale);

  for (const m of masterItems) {
    const N_SLICES = 18;
    const innerHW = Math.max(2, m.hw * 0.6);
    const furLo = Math.max(m.hw + stepImg, pitch * 0.36);
    const furHi = Math.min(pitch - m.hw * 0.85, pitch * 0.64);

    for (let k = 0; k < N_SLICES; k++) {
      const tAlong = -m.hl * 0.82 + (2 * m.hl * 0.82) * (k / (N_SLICES - 1));
      const sx = m.c[0] + m.u[0] * tAlong, sy = m.c[1] + m.u[1] * tAlong;

      for (let s = -innerHW; s <= innerHW; s += stepImg) {
        const px = sampleCvPixel(buf, sx + m.v[0] * s, sy + m.v[1] * s);
        if (!px) continue;
        bedAcc.r += px.r; bedAcc.g += px.g; bedAcc.b += px.b; bedAcc.lum += px.lum; bedAcc.exg += px.exg; bedAcc.n++;
      }
      if (furHi > furLo) {
        for (const sign of [-1, 1]) {
          for (let s = furLo; s <= furHi; s += stepImg) {
            const px = sampleCvPixel(buf, sx + m.v[0] * s * sign, sy + m.v[1] * s * sign);
            if (!px) continue;
            furAcc.r += px.r; furAcc.g += px.g; furAcc.b += px.b; furAcc.lum += px.lum; furAcc.exg += px.exg; furAcc.n++;
          }
        }
      }
    }
  }
  if (bedAcc.n < 10) return null;
  const bed = {
    r: bedAcc.r / bedAcc.n, g: bedAcc.g / bedAcc.n, b: bedAcc.b / bedAcc.n,
    lum: bedAcc.lum / bedAcc.n, exg: bedAcc.exg / bedAcc.n
  };
  const fur = furAcc.n >= 10 ? {
    r: furAcc.r / furAcc.n, g: furAcc.g / furAcc.n, b: furAcc.b / furAcc.n,
    lum: furAcc.lum / furAcc.n, exg: furAcc.exg / furAcc.n
  } : {
    r: bed.r * 0.72, g: bed.g * 0.68, b: bed.b * 0.72,
    lum: bed.lum * 0.70, exg: Math.min(0, bed.exg - 20)
  };
  const rgbDist = Math.hypot(bed.r - fur.r, bed.g - fur.g, bed.b - fur.b);
  const exgDiff = bed.exg - fur.exg;
  const lumDiff = bed.lum - fur.lum;
  return { bed, fur, rgbDist, exgDiff, lumDiff };
}

function findBestPerpShiftForRow(buf, item, sig, pitch, expectedDelta) {
  const stepImg = Math.max(1, 1 / buf.scale);
  const searchR = Math.min(pitch * 0.56, item.hw * 2.3);
  const flankW = Math.max(stepImg * 2, Math.min(pitch - item.hw * 2, item.hw * 0.9));
  const halfSpan = searchR + item.hw + flankW;
  const nBins = Math.max(5, Math.floor((2 * halfSpan) / stepImg) + 1);
  const profile = new Float64Array(nBins);
  const counts = new Int32Array(nBins);

  const N_SLICES = 18;
  const wExg = sig.exgDiff > 12 ? 0.48 : 0.22;
  const wCol = sig.rgbDist > 12 ? 0.36 : 0.15;
  const wLum = Math.abs(sig.lumDiff) > 8 ? (1 - wExg - wCol) : 0.16;

  for (let k = 0; k < N_SLICES; k++) {
    const tAlong = -item.hl * 0.82 + (2 * item.hl * 0.82) * (k / (N_SLICES - 1));
    const sx = item.c[0] + item.u[0] * tAlong, sy = item.c[1] + item.u[1] * tAlong;
    for (let bi = 0; bi < nBins; bi++) {
      const s = -halfSpan + bi * stepImg;
      const px = sampleCvPixel(buf, sx + item.v[0] * s, sy + item.v[1] * s);
      if (!px) continue;
      const dBed = Math.hypot(px.r - sig.bed.r, px.g - sig.bed.g, px.b - sig.bed.b);
      const dFur = Math.hypot(px.r - sig.fur.r, px.g - sig.fur.g, px.b - sig.fur.b);
      const colScore = (dFur - dBed) / Math.max(18, sig.rgbDist);
      const exgScore = (px.exg - sig.fur.exg) / Math.max(15, Math.abs(sig.exgDiff));
      const lumScore = sig.lumDiff >= 0
        ? (px.lum - sig.fur.lum) / Math.max(15, Math.abs(sig.lumDiff))
        : (sig.fur.lum - px.lum) / Math.max(15, Math.abs(sig.lumDiff));
      profile[bi] += wCol * colScore + wExg * exgScore + wLum * lumScore;
      counts[bi]++;
    }
  }
  for (let bi = 0; bi < nBins; bi++) {
    if (counts[bi] > 0) profile[bi] /= counts[bi];
  }

  // 1D center-surround matched boxcar filter: reward bed crown inside [-hw, +hw], reward furrows flanking outside!
  const hwBins = Math.max(1, Math.round(item.hw / stepImg));
  const flkBins = Math.max(1, Math.round(flankW / stepImg));
  const maxShiftBins = Math.max(1, Math.round(searchR / stepImg));
  const centerBin = Math.floor(nBins / 2);

  let bestScore = -Infinity, bestDelta = 0;
  for (let dBin = -maxShiftBins; dBin <= maxShiftBins; dBin++) {
    const cBin = centerBin + dBin;
    let inSum = 0, inN = 0, outSum = 0, outN = 0;
    for (let o = -hwBins; o <= hwBins; o++) {
      const idx = cBin + o;
      if (idx >= 0 && idx < nBins && counts[idx] > 0) { inSum += profile[idx]; inN++; }
    }
    for (let o = hwBins + 1; o <= hwBins + flkBins; o++) {
      if (cBin - o >= 0 && counts[cBin - o] > 0) { outSum += profile[cBin - o]; outN++; }
      if (cBin + o < nBins && counts[cBin + o] > 0) { outSum += profile[cBin + o]; outN++; }
    }
    if (inN < 2) continue;
    const deltaImg = dBin * stepImg;
    const gridPenalty = 0.14 * Math.pow((deltaImg - expectedDelta) / Math.max(10, pitch), 2);
    const stayPenalty = 0.04 * Math.pow(deltaImg / Math.max(10, pitch), 2);
    const score = (inSum / inN) - (outN ? 0.55 * (outSum / outN) : 0) - gridPenalty - stayPenalty;
    if (score > bestScore) {
      bestScore = score;
      bestDelta = deltaImg;
    }
  }
  return bestDelta;
}

function snapRowsToBeds(quiet = false) {
  quiet = (quiet === true);
  if (!S.img) { if (!quiet) toast('Open an image first'); return 0; }
  const idx = [...S.sel].filter(i => S.shapes[i] && isClosed(S.shapes[i]));
  if (idx.length < 2) { if (!quiet) toast('Select at least 2 rows (or Ctrl+A after calibrating)'); return 0; }

  const buf = getOffscreenBuffer();
  if (!buf) return 0;

  refreshCalibIfActive();

  // Determine reference axis (from calibrated Master rows if available, otherwise dominant selection axis via circular mean of 2*theta)
  let uRef = null;
  if (S.calibBounds && S.calibBounds.uRef) {
    uRef = S.calibBounds.uRef;
  } else {
    let c2 = 0, s2 = 0;
    for (const i of idx) {
      const pts = ptsOf(S.shapes[i]);
      if (pts.length === ROW_VERTS) {
        const ax = axisOf(pts);
        const a = Math.atan2(ax.u[1], ax.u[0]);
        c2 += Math.cos(2 * a);
        s2 += Math.sin(2 * a);
      }
    }
    const domAng = 0.5 * Math.atan2(s2, c2);
    uRef = [Math.cos(domAng), Math.sin(domAng)];
  }
  const vRef = [-uRef[1], uRef[0]];

  const items = [];
  for (const i of idx) {
    const sh = S.shapes[i];
    toPolygon(sh);
    if (sh.points.length !== ROW_VERTS) continue;
    const ax = axisOf(sh.points);
    let u = [ax.u[0], ax.u[1]];
    if (u[0] * uRef[0] + u[1] * uRef[1] < 0) u = [-u[0], -u[1]];
    // Guard: skip perpendicular rows (> 30 deg off reference direction)
    if (Math.abs(u[0] * uRef[0] + u[1] * uRef[1]) < Math.cos(30 * Math.PI / 180)) continue;
    const v = [-u[1], u[0]];
    const prU = sh.points.map(p => (p[0] - ax.c[0]) * u[0] + (p[1] - ax.c[1]) * u[1]);
    const prV = sh.points.map(p => (p[0] - ax.c[0]) * v[0] + (p[1] - ax.c[1]) * v[1]);
    const hl = (Math.max(...prU) - Math.min(...prU)) / 2;
    const hw = (Math.max(...prV) - Math.min(...prV)) / 2;
    if (hl < 6 || hw < 2) continue;
    items.push({
      i, sh, isMaster: isCalibMaster(sh), c: ax.c, u, v, hl, hw,
      posV: ax.c[0] * vRef[0] + ax.c[1] * vRef[1]
    });
  }
  if (items.length < 2) {
    if (!quiet) toast('Need at least 2 matching-direction rows to snap beds');
    return 0;
  }

  items.sort((a, b) => a.posV - b.posV);
  const avgHW = items.reduce((s, x) => s + x.hw, 0) / items.length;
  const diffs = [];
  for (let k = 0; k < items.length - 1; k++) {
    const d = items[k + 1].posV - items[k].posV;
    if (d > avgHW * 1.1) diffs.push(d);
  }
  diffs.sort((a, b) => a - b);
  const pitch = diffs.length ? diffs[Math.floor(diffs.length / 2)] : avgHW * 2.6;

  // Group into distinct bed tracks (so collinear split pairs share one track index and missing beds snap to integer pitch multiples!)
  const tracks = [];
  for (const it of items) {
    const lastT = tracks[tracks.length - 1];
    if (lastT && Math.abs(it.posV - lastT.posV) < avgHW * 0.9) {
      lastT.members.push(it);
      it.trackIdx = tracks.length - 1;
    } else {
      tracks.push({ posV: it.posV, members: [it] });
      it.trackIdx = tracks.length - 1;
    }
  }

  // Use calibrated Masters as color anchors, or fall back to the 2 outermost rows
  let masterItems = items.filter(it => it.isMaster);
  if (masterItems.length < 2) {
    masterItems = [items[0], items[items.length - 1]];
  }
  const sig = learnMasterBedSignature(buf, masterItems, pitch);
  if (!sig) {
    if (!quiet) toast('Could not sample bed signature from master rows');
    return 0;
  }

  // Soft grid expectation: snap to nearest integer multiple of pitch from nearest master anchor (handles missing rows & split pairs)
  const anchorA = masterItems[0].posV, anchorB = masterItems[masterItems.length - 1].posV;
  const masterSpan = anchorB - anchorA;
  const estTotalIntervals = Math.max(1, Math.round(masterSpan / Math.max(10, pitch)));
  const effPitch = (tracks.length > 2 && Math.abs(estTotalIntervals - (tracks.length - 1)) <= 1)
    ? (masterSpan / (tracks.length - 1))
    : pitch;

  const rawDeltas = items.map(it => {
    if (it.isMaster) return 0; // Master rows stay strictly locked!
    const distFromA = it.posV - anchorA;
    const stepIdx = Math.round(distFromA / Math.max(10, effPitch));
    const expectedPos = anchorA + stepIdx * effPitch;
    const expectedDelta = Math.max(-pitch * 0.35, Math.min(pitch * 0.35, expectedPos - it.posV));
    return findBestPerpShiftForRow(buf, it, sig, pitch, expectedDelta);
  });

  // Collision guard: prevent two non-collinear neighboring rows from collapsing onto the same bed
  const minSep = avgHW * 1.5;
  const finalPos = items.map((it, k) => it.posV + rawDeltas[k]);
  for (let k = 1; k < items.length; k++) {
    const origGap = items[k].posV - items[k - 1].posV;
    if (origGap < avgHW * 0.9) continue; // collinear split pair on same bed
    if (finalPos[k] < finalPos[k - 1] + minSep) {
      if (items[k].isMaster) finalPos[k - 1] = Math.min(finalPos[k - 1], finalPos[k] - minSep);
      else finalPos[k] = finalPos[k - 1] + minSep;
    }
  }

  if (!quiet) pushUndo();
  let moved = 0;
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    if (it.isMaster) continue;
    const delta = finalPos[k] - it.posV;
    if (Math.abs(delta) < 0.75) continue;
    // Translate STRICTLY along perpendicular axis v (0.00px parallel drift!)
    const sign = (it.v[0] * vRef[0] + it.v[1] * vRef[1]) >= 0 ? 1 : -1;
    const sx = it.v[0] * sign * delta, sy = it.v[1] * sign * delta;
    it.sh.points = it.sh.points.map(p => [p[0] + sx, p[1] + sy]);
    moved++;
  }

  if (moved) {
    if (!quiet) {
      markDirty();
      toast(`🛏️ Snapped ${moved} row${moved > 1 ? 's' : ''} onto potato beds (0px parallel drift · Master rows locked)`);
    }
  } else if (!quiet) {
    S.undo.pop();
    toast('Selected rows are already centered on their beds');
  }
  return moved;
}

function fullCalibAutoFit() {
  if (!S.vp && !S.gradient) {
    toast('Calibrate 2 outer Master rows first (select 2 outer rows and press C)');
    return;
  }
  if (!S.sel.size) { toast('Select rows first (Ctrl+A)'); return; }
  pushUndo();
  const nAng = snapAngleSel(true);
  const nBed = snapRowsToBeds(true);
  const nEnd = alignEndsToMasters(true);
  if (nAng || nBed || nEnd) {
    markDirty();
    toast(`✨ Full Auto-Fit: ${nAng} angles · ${nBed} beds centered · ${nEnd} ends aligned (Ctrl+Z to undo)`, 3600);
  } else {
    S.undo.pop();
    toast('All selected rows are already calibrated, centered & aligned ✓');
  }
}

// ---------------------------------------------------------------- fill between (perspective row generator)
// Bilinear interpolation between two anchor rows to generate N perspective-correct rows.
function canonicalCorners(pts) {
  const { c, u, v } = axisOf(pts);
  const proj = pts.map(p => ({
    p,
    pu: (p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1],
    pv: (p[0] - c[0]) * v[0] + (p[1] - c[1]) * v[1]
  }));
  proj.sort((a, b) => a.pu - b.pu);
  const endA = proj.slice(0, 2).sort((a, b) => a.pv - b.pv);
  const endB = proj.slice(2, 4).sort((a, b) => b.pv - a.pv);
  return [endA[0].p, endA[1].p, endB[0].p, endB[1].p];
}

function signedArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    s += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return s / 2;
}

function fillBetween() {
  if (!S.img) { toast('Open an image first'); return; }
  const idx = [...S.sel].filter(i => S.shapes[i] && isClosed(S.shapes[i]));
  if (idx.length !== 2) { toast('Select exactly 2 rows to fill between them'); return; }

  const sh1 = S.shapes[idx[0]], sh2 = S.shapes[idx[1]];
  toPolygon(sh1); toPolygon(sh2);
  if (sh1.points.length !== ROW_VERTS || sh2.points.length !== ROW_VERTS) {
    toast('Both rows must have exactly 4 vertices'); return;
  }

  const nStr = window.prompt('Number of rows to generate between the two selected rows:', '6');
  if (nStr === null) return;
  const N = Math.round(+nStr);
  if (!(N >= 1 && N <= 200)) { toast('Enter a number between 1 and 200'); return; }

  const c1 = canonicalCorners(sh1.points);
  let c2 = canonicalCorners(sh2.points);
  // Ensure same winding direction between row 1 and row 2
  if (Math.sign(signedArea(c1)) !== Math.sign(signedArea(c2))) c2 = [c2[3], c2[2], c2[1], c2[0]];

  pushUndo();
  const start = S.shapes.length;
  for (let k = 1; k <= N; k++) {
    const t = k / (N + 1);
    const newPts = c1.map((p, i) => [
      p[0] * (1 - t) + c2[i][0] * t,
      p[1] * (1 - t) + c2[i][1] * t
    ]);
    S.shapes.push({ label: sh1.label, text: '', points: newPts, group_id: null, shape_type: 'polygon', flags: {} });
  }
  const genIdx = Array.from({ length: N }, (_, k) => start + k);
  if (!BOX()) reclassifyIndices(genIdx);
  S.sel = new Set(genIdx);
  S.selV = null;
  setMode('edit'); markDirty(); renderLabels();
  toast(`${N} rows generated between the two selected rows.`);
}

// ---------------------------------------------------------------- transforms on the selection
function selEditable() { return [...S.sel].filter(i => S.shapes[i] && isClosed(S.shapes[i])); }
function rotateSel(rad, snap) {
  const idx = selEditable(); if (!idx.length) return false;
  idx.forEach(i => toPolygon(S.shapes[i]));
  if (S.pivot === "group") {
    const b = bboxOf(idx.map(i => (snap ? snap.get(i) : S.shapes[i].points))), c = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
    idx.forEach(i => S.shapes[i].points = (snap ? snap.get(i) : S.shapes[i].points).map(p => rotPt(p, c, rad)));
  } else {
    idx.forEach(i => { const src = snap ? snap.get(i) : S.shapes[i].points, c = centroid(src); S.shapes[i].points = src.map(p => rotPt(p, c, rad)); });
  }
  return true;
}
function resizeSel(dim, d) {
  const idx = selEditable(); if (!idx.length) return false;
  idx.forEach(i => {
    const sh = S.shapes[i]; toPolygon(sh);
    const { c, u, v } = axisOf(sh.points), dir = dim === "len" ? u : v;
    const proj = sh.points.map(p => (p[0] - c[0]) * dir[0] + (p[1] - c[1]) * dir[1]);
    const lo = Math.min(...proj), hi = Math.max(...proj), ext = hi - lo;
    if (ext + d < 2) return;
    const f = (ext + d) / ext, mid = (hi + lo) / 2;
    sh.points = sh.points.map((p, k) => { const a = proj[k], na = (a - mid) * f + mid; return [p[0] + dir[0] * (na - a), p[1] + dir[1] * (na - a)]; });
  });
  return true;
}
function spacingSel(d) {
  const idx = selEditable(); if (idx.length < 2) { toast("Select 2 or more rows to change spacing"); return false; }
  idx.forEach(i => toPolygon(S.shapes[i]));
  const ax = idx.map(i => axisOf(S.shapes[i].points));
  let ux = 0, uy = 0; ax.forEach(a => { const sg = (a.u[0] * ax[0].u[0] + a.u[1] * ax[0].u[1]) < 0 ? -1 : 1; ux += a.u[0] * sg; uy += a.u[1] * sg; });
  const L = Math.hypot(ux, uy) || 1, v = [-uy / L, ux / L];
  const gc = centroid(ax.map(a => a.c)), t = ax.map(a => (a.c[0] - gc[0]) * v[0] + (a.c[1] - gc[1]) * v[1]);
  const span = Math.max(...t) - Math.min(...t); if (span < 1) return false;
  const pitch = span / (idx.length - 1); if (pitch + d < 1) return false;
  const f = (pitch + d) / pitch;
  idx.forEach((i, k) => { const sh = t[k] * (f - 1); S.shapes[i].points = S.shapes[i].points.map(p => [p[0] + v[0] * sh, p[1] + v[1] * sh]); });
  return true;
}
function moveSel(dx, dy) {
  const idx = [...S.sel]; if (!idx.length) return false;
  idx.forEach(i => S.shapes[i].points = S.shapes[i].points.map(p => [p[0] + dx, p[1] + dy]));
  return true;
}
const stepPx = () => Math.max(0.5, +$("#stepPx").value || 10);
const stepDeg = () => Math.max(0.05, +$("#stepDeg").value || 1);
function doAct(act, mult = 1) {
  if (!S.sel.size) { toast("Select rows first (click a row, or Ctrl+A for all)"); return; }
  pushUndo("act:" + act);
  const px = stepPx() * mult, rad = stepDeg() * mult * Math.PI / 180;
  const ok = {
    "rot-": () => rotateSel(-rad), "rot+": () => rotateSel(rad),
    "wid-": () => resizeSel("wid", -px), "wid+": () => resizeSel("wid", px),
    "len-": () => resizeSel("len", -px), "len+": () => resizeSel("len", px),
    "gap-": () => spacingSel(-px), "gap+": () => spacingSel(px),
    "mvL": () => moveSel(-px, 0), "mvR": () => moveSel(px, 0), "mvU": () => moveSel(0, -px), "mvD": () => moveSel(0, px),
  }[act]();
  if (ok) {
    if ((act === "rot-" || act === "rot+") && !BOX()) reclassifyIndices(selEditable());
    markDirty();
  } else S.undo.pop();
}
document.querySelectorAll("[data-act]").forEach(b => {
  let t1, t2;
  const stop = () => { clearTimeout(t1); clearInterval(t2); };
  b.addEventListener("pointerdown", e => { if (e.button) return; e.preventDefault(); doAct(b.dataset.act); t1 = setTimeout(() => t2 = setInterval(() => doAct(b.dataset.act), 60), 380); });
  ["pointerup", "pointerleave", "pointercancel"].forEach(ev => b.addEventListener(ev, stop));
});
$("#pivotSeg").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return; S.pivot = b.dataset.v; store("pivot", S.pivot);
  $("#pivotSeg").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
});
["stepPx", "stepDeg"].forEach(id => { const el = $("#" + id); el.value = recall(id, el.value); el.addEventListener("change", () => store(id, el.value)); });

// ---------------------------------------------------------------- copy / paste / duplicate
function nextOffset(list) {
  const ax = list.map(p => axisOf(p));
  let ux = 0, uy = 0; ax.forEach(a => { const sg = (a.u[0] * ax[0].u[0] + a.u[1] * ax[0].u[1]) < 0 ? -1 : 1; ux += a.u[0] * sg; uy += a.u[1] * sg; });
  const L = Math.hypot(ux, uy) || 1, v = [-uy / L, ux / L];
  if (Math.abs(v[0]) >= Math.abs(v[1]) ? v[0] < 0 : v[1] < 0) { v[0] = -v[0]; v[1] = -v[1]; }
  const width = pts => { const c = centroid(pts), pr = pts.map(p => (p[0] - c[0]) * v[0] + (p[1] - c[1]) * v[1]); return Math.max(...pr) - Math.min(...pr); };
  let d;
  if (list.length > 1) {
    const t = ax.map(a => a.c[0] * v[0] + a.c[1] * v[1]), span = Math.max(...t) - Math.min(...t);
    d = span > 1 ? span / (list.length - 1) * list.length : Math.max(...list.map(width)) * 1.5;
  } else d = width(list[0]) * 1.5;
  d = Math.max(d, 10);
  return [v[0] * d, v[1] * d];
}
function cleanCopy(s) {
  const o = {}; for (const k in s) if (k[0] !== "_") o[k] = s[k];
  o.points = ptsOf(s).map(p => [p[0], p[1]]); o.shape_type = "polygon"; o.flags = { ...(s.flags || {}) };
  return o;
}
function selShapes() { return [...S.sel].sort((a, b) => a - b).map(i => S.shapes[i]).filter(s => s && isClosed(s)); }
function copySel(quiet) {
  const list = selShapes();
  if (!list.length) { toast("Select rows to copy first"); return false; }
  S.clip = { shapes: list.map(cleanCopy), file: S.files[S.idx] && S.files[S.idx].name };
  if (!quiet) toast(`${list.length} row${list.length > 1 ? "s" : ""} copied. Ctrl+V to paste (also on another image)`);
  return true;
}
function pasteClip() {
  if (S.idx < 0) return;
  if (!S.clip || !S.clip.shapes.length) { toast("Nothing copied yet. Select rows and press Ctrl+C"); return; }
  const sameImage = S.files[S.idx] && S.clip.file === S.files[S.idx].name;
  const off = sameImage ? nextOffset(S.clip.shapes.map(s => s.points)) : [0, 0];
  const add = S.clip.shapes.map(s => ({ ...cleanCopy(s), points: s.points.map(p => [p[0] + off[0], p[1] + off[1]]) }));
  pushUndo(); const start = S.shapes.length;
  S.shapes.push(...add);
  const newIdx = add.map((_, k) => start + k);
  if (!BOX()) reclassifyIndices(newIdx);
  S.sel = new Set(newIdx); S.selV = null;
  if (sameImage) S.clip.shapes = add.map(cleanCopy);
  setMode("edit"); markDirty(); renderLabels();
  toast(`${add.length} row${add.length > 1 ? "s" : ""} pasted and selected. Drag or use the arrows to place them.`);
}
function duplicateRowAt(hs, ip) {
  const src = S.shapes[hs];
  if (!src || !isClosed(src)) return false;
  toPolygon(src);
  if (!src.points || src.points.length < 3) return false;

  const avgW = defaultRowWidthFor(src);
  const { pitch, proj, v, c } = calcRowPitch(src, avgW);

  // Determine direction: side of double-click relative to row centerline, or towards open neighbor-free side
  const dAcross = (ip[0] - c[0]) * v[0] + (ip[1] - c[1]) * v[1];
  let dir = 1;
  if (Math.abs(dAcross) > 1.5) {
    dir = dAcross > 0 ? 1 : -1;
  } else {
    const hasPos = proj.some(d => d > 0 && d < pitch * 1.5);
    const hasNeg = proj.some(d => d < 0 && d > -pitch * 1.5);
    if (hasPos && !hasNeg) dir = -1;
    else if (hasNeg && !hasPos) dir = 1;
    else {
      const centerVec = [S.W / 2 - c[0], S.H / 2 - c[1]];
      dir = (centerVec[0] * v[0] + centerVec[1] * v[1]) >= 0 ? 1 : -1;
    }
  }

  const newSh = cleanCopy(src);
  const shift = [v[0] * pitch * dir, v[1] * pitch * dir];
  newSh.points = newSh.points.map(p => [p[0] + shift[0], p[1] + shift[1]]);

  // Normalize new row width to same-direction parallel neighbors (preserves perpendicular row width)
  setRowWidth(newSh, avgW);

  // Only snap to calibrated perspective if the row is roughly aligned with it (< 30 deg);
  // never snap perpendicular / cross-direction rows to the main field direction!
  if (S.gradient || S.vp) {
    const newAx = axisOf(newSh.points);
    const targetAng = getPerspectiveAngleAt(newAx.c);
    if (targetAng != null) {
      const curAng = Math.atan2(newAx.u[1], newAx.u[0]);
      let diff = Math.abs(normAngle(curAng - targetAng));
      if (diff > Math.PI / 2) diff = Math.PI - diff;
      if (diff < (30 * Math.PI / 180)) {
        snapAngleToVP(newSh);
      }
    }
  }

  pushUndo("duplicateRow");
  S.shapes.push(newSh);
  const newIdx = S.shapes.length - 1;
  if (!BOX()) reclassifyIndices([newIdx]);
  S.sel = new Set([newIdx]);
  S.selV = null;
  setMode("edit");
  markDirty();
  refreshAll();
  toast("Row duplicated");
  return true;
}

function setRowWidth(sh, targetWidth) {
  if (!isClosed(sh)) return false;
  toPolygon(sh);
  const pts = sh.points;
  if (!pts || pts.length < 3) return false;
  const { c, v } = axisOf(pts);
  const pr = pts.map(p => (p[0] - c[0]) * v[0] + (p[1] - c[1]) * v[1]);
  let lo = Infinity, hi = -Infinity;
  for (const val of pr) { if (val < lo) lo = val; if (val > hi) hi = val; }
  const curWidth = hi - lo;
  if (curWidth < 1e-3) return false;
  const scale = targetWidth / curWidth;
  const mid = (hi + lo) / 2;
  sh.points = pts.map((p, k) => {
    const shift = (pr[k] - mid) * (scale - 1);
    return [p[0] + v[0] * shift, p[1] + v[1] * shift];
  });
  return true;
}

function calcRowPitch(srcSh, avgW) {
  const pts = ptsOf(srcSh);
  if (!pts || pts.length < 3) return { pitch: avgW * 1.25, proj: [], v: [0, 1], c: [0, 0] };
  const { c, u, v } = axisOf(pts);
  const angSrc = normAngle(Math.atan2(u[1], u[0]));

  // Find neighboring rows roughly parallel to this row
  const valid = S.shapes.filter(s => s !== srcSh && isClosed(s) && ptsOf(s).length === ROW_VERTS && s._vis !== false);
  const proj = [];
  for (const s of valid) {
    const sPts = ptsOf(s);
    const sAx = axisOf(sPts);
    const sAng = normAngle(Math.atan2(sAx.u[1], sAx.u[0]));
    let dAng = Math.abs(sAng - angSrc);
    if (dAng > Math.PI / 2) dAng = Math.PI - dAng;
    if (dAng < 0.6) {
      const dV = (sAx.c[0] - c[0]) * v[0] + (sAx.c[1] - c[1]) * v[1];
      proj.push(dV);
    }
  }

  if (proj.length) {
    proj.sort((a, b) => a - b);
    const diffs = [];
    const pos = proj.filter(d => d > avgW * 0.4);
    const neg = proj.filter(d => d < -avgW * 0.4);
    if (pos.length) diffs.push(Math.min(...pos));
    if (neg.length) diffs.push(Math.abs(Math.max(...neg)));

    for (let i = 0; i < proj.length - 1; i++) {
      const step = proj[i + 1] - proj[i];
      if (step >= avgW * 0.6 && step <= avgW * 3.5) diffs.push(step);
    }

    if (diffs.length) {
      diffs.sort((a, b) => a - b);
      const medianPitch = diffs[Math.floor(diffs.length / 2)];
      if (medianPitch >= avgW * 0.5 && medianPitch <= avgW * 4) {
        return { pitch: medianPitch, proj, v, c };
      }
    }
  }

  const gapPct = (S.multi && typeof S.multi.gap === "number") ? S.multi.gap : 25;
  const fallbackPitch = Math.max(10, avgW * (1 + gapPct / 100));
  return { pitch: fallbackPitch, proj, v, c };
}

function duplicateSel() {
  const list = selShapes();
  if (list.length === 1) {
    const idx = [...S.sel][0];
    const ax = axisOf(ptsOf(list[0]));
    if (duplicateRowAt(idx, ax.c)) return;
  }
  const keep = S.clip;
  if (!copySel(true)) return;
  pasteClip();
  S.clip = keep;
}
$("#btnCopy").onclick = () => copySel();
$("#btnPaste").onclick = pasteClip;
$("#btnDup").onclick = duplicateSel;

function deleteVertex(hv) {
  const sh = S.shapes[hv.s];
  if (ptsOf(sh).length <= 3) { toast("A segment needs at least 3 vertices. Delete the whole segment instead."); return; }
  pushUndo(); toPolygon(sh); sh.points.splice(hv.v, 1); S.selV = null; S.hoverV = null; markDirty();
}
function deleteSelected() {
  if (S.selV && S.shapes[S.selV.s]) return deleteVertex(S.selV);
  if (!S.sel.size) return;
  pushUndo(); S.shapes = S.shapes.filter((_, i) => !S.sel.has(i)); S.sel = new Set(); S.hover = -1;
  if (!BOX() && S.shapes.length) reclassifyIndices([]);
  markDirty(); renderLabels();
}
function selectAll() { S.sel = new Set(S.shapes.map((_, i) => i).filter(i => S.shapes[i]._vis !== false)); S.selV = null; setMode("edit"); refreshAll(); }
function nextBad() {
  const bads = S.shapes.map((s, i) => isBad(s) ? i : -1).filter(i => i >= 0);
  if (!bads.length) {
    const j = S.files.findIndex((f, k) => k > S.idx && f.bad > 0);
    if (j >= 0) { toast("No problems left here. Opening the next image that has problems."); openImage(j); } else toast("No segments need fixing ✓");
    return;
  }
  const cur = S.sel.size === 1 ? [...S.sel][0] : -1, nx = bads.find(i => i > cur) ?? bads[0];
  S.sel = new Set([nx]); S.selV = null; setMode("edit"); zoomToShape(nx); refreshAll();
}

// ---------------------------------------------------------------- mouse
function local(e) { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
cv.addEventListener("contextmenu", e => e.preventDefault());
cv.addEventListener("pointerdown", e => {
  if (!S.img) return;
  cv.setPointerCapture(e.pointerId);
  const [sx, sy] = local(e), ip = toImg(sx, sy);
  S.down = { sx, sy, ip, btn: e.button, moved: false, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, view: { ...S.view } };
  if (e.button === 1 || e.button === 2 || S.space) { S.drag = { type: "pan" }; cv.style.cursor = "grabbing"; return; }
  if (e.button !== 0) return;
  if (S.mode === "poly") { S.drag = { type: "click" }; return; }
  if (S.mode === "box") {
    const p = [clampX(ip[0]), clampY(ip[1])];
    if (S.boxStart) { const a = S.boxStart; S.boxStart = null; S.drag = null; createBox(a, p); updateHint(); return; }
    S.drag = { type: "newbox", a: p, b: p }; return;
  }
  if (S.mode === "slice") {
    const hs = hitShape(ip);
    const selRows = [...S.sel].filter(i => S.shapes[i] && isClosed(S.shapes[i]) && S.shapes[i]._vis !== false);
    if (selRows.length > 1) {
      sliceMultipleRowsAt(selRows, ip, hs);
      return;
    }
    if (hs >= 0) sliceShapeAt(hs, ip);
    else toast("Click directly on a row to slice it");
    return;
  }
  if (S.mode === "multi") { S.drag = { type: "multi", a: ip, b: ip }; return; }
  if (hitHandle(sx, sy)) {
    const g = selGeom(); pushUndo(); g.idx.forEach(i => toPolygon(S.shapes[i]));
    S.drag = { type: "rotate", c: g.c, a0: Math.atan2(ip[1] - g.c[1], ip[0] - g.c[0]), snap: new Map(g.idx.map(i => [i, S.shapes[i].points.map(p => [p[0], p[1]])])), cur: 0 };
    return;
  }
  const hsd = hitSide(sx, sy);
  const hv = hitVertex(sx, sy);
  let useSide = hsd;
  if (hsd && hv) {
    const dSide = Math.hypot(toScr(hsd.pos)[0] - sx, toScr(hsd.pos)[1] - sy);
    const vPt = ptsOf(S.shapes[hv.s])[hv.v];
    const dVert = vPt ? Math.hypot(toScr(vPt)[0] - sx, toScr(vPt)[1] - sy) : Infinity;
    if (dVert < dSide - 2) useSide = null;
  }
  if (useSide) {
    pushUndo();
    if (!S.sel.has(useSide.s)) { S.sel = new Set([useSide.s]); S.selV = null; }
    const idx = [...S.sel].filter(i => S.shapes[i] && isClosed(S.shapes[i]) && S.shapes[i]._vis !== false);
    idx.forEach(i => toPolygon(S.shapes[i]));
    S.selV = null;
    S.drag = { type: "side", h: useSide, start: ip, snap: new Map(idx.map(i => [i, S.shapes[i].points.map(p => [p[0], p[1]])])), t: 0 };
    return;
  }
  if (hv) {
    if (e.altKey) { deleteVertex(hv); S.drag = null; return; }
    if (!S.sel.has(hv.s)) S.sel = new Set([hv.s]);
    S.selV = hv; S.drag = { type: "vertex", s: hv.s, v: hv.v, pushed: false }; refreshAll(); return;
  }
  if (e.shiftKey) {
    const keep = e.ctrlKey || e.metaKey;
    S.drag = {
      type: "box",
      a: [sx, sy],
      b: [sx, sy],
      baseSel: keep ? new Set(S.sel) : new Set(),
      hits: new Set(keep ? S.sel : [])
    };
    return;
  }
  S.selV = null;
  const hs = hitShape(ip);
  if (hs >= 0) {
    if (S.down.ctrl) { S.sel.has(hs) ? S.sel.delete(hs) : S.sel.add(hs); S.drag = null; refreshAll(); return; }
    if (!S.sel.has(hs)) S.sel = new Set([hs]);
    S.drag = { type: "move", last: ip, pushed: false }; refreshAll(); return;
  }
  S.drag = { type: "pan", clear: !S.down.ctrl };
});
cv.addEventListener("pointermove", e => {
  if (!S.img) return;
  const [sx, sy] = local(e), ip = toImg(sx, sy);
  S.cursor = ip; updateCursorPos();
  const d = S.drag;
  if (d && S.down) {
    if (Math.hypot(sx - S.down.sx, sy - S.down.sy) > 4) S.down.moved = true;
    if (d.type === "click" && S.down.moved) { d.type = "pan"; }
    if (d.type === "pan") { S.view.x = S.down.view.x + sx - S.down.sx; S.view.y = S.down.view.y + sy - S.down.sy; cv.style.cursor = "grabbing"; }
    else if (d.type === "vertex" && S.down.moved) {
      const sh = S.shapes[d.s];
      if (!d.pushed) {
        pushUndo(); d.pushed = true;
        if (isBoxShape(sh)) d.opp = rectPts(sh)[(d.v + 2) % 4];
        else toPolygon(sh);
      }
      if (isBoxShape(sh)) {
        const opp = d.opp, p = [clampX(ip[0]), clampY(ip[1])];
        sh.points = [[Math.min(opp[0], p[0]), Math.min(opp[1], p[1])], [Math.max(opp[0], p[0]), Math.max(opp[1], p[1])]];
      } else {
        const ms = magneticSnapPt(ip, e.altKey);
        sh.points[d.v] = ms.pt;
        S.snapEdges = ms.edges.length ? new Set(ms.edges) : null;
      }
    } else if (d.type === "newbox") {
      d.b = [clampX(ip[0]), clampY(ip[1])];
    } else if (d.type === "move" && S.down.moved) {
      if (!d.pushed) { pushUndo(); d.pushed = true; }
      moveSel(ip[0] - d.last[0], ip[1] - d.last[1]); d.last = ip;
    } else if (d.type === "rotate") {
      let a = Math.atan2(ip[1] - d.c[1], ip[0] - d.c[0]) - d.a0;
      if (e.shiftKey) a = Math.round(a / (Math.PI / 36)) * (Math.PI / 36);
      d.cur = a; rotateSel(a, d.snap);
    } else if (d.type === "side") {
      d.t = Math.hypot(ip[0] - d.start[0], ip[1] - d.start[1]);
      applySideDrag(d, ip, e.shiftKey, e.altKey); cv.style.cursor = sideCursor(d.h.d);
    } else if (d.type === "box") {
      d.b = [sx, sy];
      const x0 = Math.min(d.a[0], d.b[0]), x1 = Math.max(d.a[0], d.b[0]);
      const y0 = Math.min(d.a[1], d.b[1]), y1 = Math.max(d.a[1], d.b[1]);
      const hits = new Set(d.baseSel || []);
      if (x1 - x0 > 3 || y1 - y0 > 3) {
        S.shapes.forEach((s, i) => {
          if (s._vis === false) return;
          const scrPts = ptsOf(s).map(toScr);
          if (polyHitsBox(scrPts, x0, y0, x1, y1)) hits.add(i);
        });
      }
      d.hits = hits;
      S.sel = hits;
      S.selV = null;
      draw(); return;
    }
    else if (d.type === "multi") d.b = ip;
    draw(); return;
  }
  let hv = null, hs = -1, hh = false, hsd = null;
  if (S.mode === "edit") {
    hh = hitHandle(sx, sy);
    if (!hh) {
      hsd = hitSide(sx, sy);
      hv = hitVertex(sx, sy);
      if (hsd && hv) {
        const dSide = Math.hypot(toScr(hsd.pos)[0] - sx, toScr(hsd.pos)[1] - sy);
        const vPt = ptsOf(S.shapes[hv.s])[hv.v];
        const dVert = vPt ? Math.hypot(toScr(vPt)[0] - sx, toScr(vPt)[1] - sy) : Infinity;
        if (dVert < dSide - 2) hsd = null; else hv = null;
      }
      if (!hsd && !hv) hs = hitShape(ip);
    }
  }
  const sideKey = h => h ? h.s + h.key : "";
  const sameV = (!hv && !S.hoverV) || (hv && S.hoverV && hv.s === S.hoverV.s && hv.v === S.hoverV.v);
  const changed = hh !== S.hoverHandle || hs !== S.hover || !sameV || sideKey(hsd) !== sideKey(S.hoverSide);
  S.hoverHandle = hh; S.hoverV = hv; S.hoverSide = hsd; S.hover = hv ? hv.s : (hsd ? hsd.s : hs);
  if (S.mode === "edit") cv.style.cursor = S.space ? "grab" : hh ? "grab" : hsd ? sideCursor(hsd.d) : hv ? "crosshair" : e.shiftKey ? "crosshair" : hs >= 0 ? "move" : "default";
  else if (S.mode === "poly") cv.style.cursor = S.space ? "grab" : "none";
  else cv.style.cursor = S.space ? "grab" : "crosshair";
  if (!S.drag) showTip(e, hs);
  if (changed || S.mode !== "edit") draw();
});
function endDrag(e) {
  S.snapEdges = null;
  const d = S.drag; if (!d || !S.down) { S.drag = null; return; }
  const [sx, sy] = local(e), ip = toImg(sx, sy), moved = S.down.moved;
  S.drag = null;
  if (S.down.btn === 2 && !moved && (S.mode === "edit" || S.mode === "box")) {
    const hv = !BOX() && S.mode === "edit" ? hitVertex(sx, sy) : null;
    if (hv) deleteVertex(hv);
    else if (!S.boxStart) {
      let hs = hitShape(ip);
      if (hs < 0 && BOX()) { const v = hitVertex(sx, sy); if (v) hs = v.s; }
      openCtx(hs, e.clientX, e.clientY);
    }
  }
  else if (d.type === "click" && !moved) addDraftPoint(ip);
  else if (d.type === "newbox") { if (moved) createBox(d.a, d.b); else S.boxStart = d.a; updateHint(); }
  else if (d.type === "pan" && d.clear && !moved) { S.sel = new Set(); S.selV = null; refreshAll(); }
  else if (d.type === "box") {
    if (!moved) {
      const hs = hitShape(ip);
      if (hs >= 0) {
        if (S.sel.has(hs)) S.sel.delete(hs);
        else S.sel.add(hs);
      }
    } else {
      S.sel = d.hits || new Set();
    }
    S.selV = null;
    refreshAll();
  } else if (d.type === "multi") {
    const a = toScr(d.a), b = toScr(d.b);
    if (Math.abs(a[0] - b[0]) > 8 && Math.abs(a[1] - b[1]) > 8) createRows(d.a, d.b); else draw();
  } else if ((d.type === "vertex" || d.type === "move") && d.pushed) markDirty();
  else if (d.type === "rotate") { if (d.cur) { if (!BOX()) reclassifyIndices(selEditable()); markDirty(); } else { S.undo.pop(); draw(); } }
  else if (d.type === "side") { if (moved && d.t > 1) markDirty(); else { S.undo.pop(); draw(); } }
  if (S.mode === "edit") cv.style.cursor = S.space ? "grab" : "default";
  else if (S.mode === "poly") cv.style.cursor = "none";
  else cv.style.cursor = "crosshair";
  S.down = null; draw();
}
cv.addEventListener("pointerup", endDrag);
cv.addEventListener("pointercancel", endDrag);
cv.addEventListener("pointerleave", () => { if (!S.drag) { S.cursor = null; updateCursorPos(); draw(); } });
cv.addEventListener("wheel", e => { if (!S.img) return; e.preventDefault(); const [sx, sy] = local(e); zoomAt(sx, sy, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
cv.addEventListener("dblclick", e => {
  if (!S.img) return;
  const [sx, sy] = local(e), ip = toImg(sx, sy);
  const hs = hitShape(ip);
  if (hs >= 0) {
    duplicateRowAt(hs, ip);
    return;
  }
  setMode("poly");
  S.draft = [];
  draw();
  toast("Draw mode activated: click start and end of row centerline");
});
document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("button"); if (b && !b.closest("dialog")) b.blur(); });

// ---------------------------------------------------------------- keyboard
// Left-hand ergonomic layout: right hand stays on mouse at all times.
// Navigation: A = Prev image, D = Next image
// Modes: E / Esc = Edit mode, W (or P) = Draw polygon, R (or M) = Multi rows
// Perspective / AI tools: Q = Rectify, Alt+A = Snap angle to VP, C = Calibrate VP, V = Fill between
// Nudge: Shift + W/A/S/D = Nudge selected rows up/left/down/right
// Transforms: 1/2 = Rotate left/right, 3/4 = Thinner/wider, 5/6 = Shorter/longer (Shift = 5x)
// Deletion: ` (backquote) or Del = Delete selected, Backspace/` in poly = undo point
// Panels & View: Z (or L) = Images list, X (or T) = Tools panel, F = Fit, G (or H) = Hide, B (or N) = Next bad
// Clipboard & System: Ctrl+Z/Y = Undo/Redo, Ctrl+S = Save, Ctrl+A = Select all, Ctrl+C/V/D = Copy/Paste/Duplicate
document.addEventListener("keydown", e => {
  const tag = (e.target.tagName || "").toLowerCase();
  if ((tag === "input" || tag === "select" || tag === "textarea") && e.key !== "Escape") return;
  if (document.querySelector("dialog[open]")) return;
  const k = e.key, ctrl = e.ctrlKey || e.metaKey;
  if (k === "Shift" && S.mode === "edit" && !S.drag && !S.space && !S.hoverHandle && !S.hoverSide && !S.hoverV) { cv.style.cursor = "crosshair"; }
  if (ctrl && (k.toLowerCase() === "w" || e.code === "KeyW")) { e.preventDefault(); e.stopPropagation(); toast("Ctrl+W tab close disabled"); return; }
  if (k === " ") { if (!S.space) { S.space = true; cv.style.cursor = "grab"; } e.preventDefault(); return; }
  if (ctrl && k.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (ctrl && k.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
  if (ctrl && k.toLowerCase() === "s") { e.preventDefault(); saveNow(); return; }
  if (ctrl && k.toLowerCase() === "a") { e.preventDefault(); selectAll(); return; }
  if (ctrl && k.toLowerCase() === "c") { if (S.sel.size) { e.preventDefault(); copySel(); } return; }
  if (ctrl && k.toLowerCase() === "v") { e.preventDefault(); pasteClip(); return; }
  if (ctrl && k.toLowerCase() === "d") { e.preventDefault(); duplicateSel(); return; }
  if (ctrl && (k === "Delete" || k === "Del" || e.code === "Delete" || k === "Backspace")) { e.preventDefault(); deleteCurrentJson(); return; }
  if (ctrl) return;

  // Alt shortcuts (left hand thumb on Alt)
  if (e.altKey && k.toLowerCase() === "p") { e.preventDefault(); alignSelToPlants(); return; }
  if (e.altKey && k.toLowerCase() === "g") { e.preventDefault(); alignAngleGradientSel(); return; }
  if (e.altKey && k.toLowerCase() === "a") { e.preventDefault(); snapAngleSel(); return; }
  if (e.altKey && k.toLowerCase() === "b") { e.preventDefault(); snapRowsToBeds(); return; }
  if (e.altKey && k.toLowerCase() === "e") { e.preventDefault(); alignEndsToMasters(); return; }
  if (e.altKey && k.toLowerCase() === "c") { e.preventDefault(); calibrateVP(); return; }
  if (e.altKey && k.toLowerCase() === "v") { e.preventDefault(); fillBetween(); return; }

  // Cancel / Edit
  if (k === "Escape") { if (S.mode === "poly" && S.draft.length) { S.draft = []; draw(); } else if (S.mode !== "edit") setMode("edit"); else { S.sel = new Set(); S.selV = null; refreshAll(); } return; }
  if (k === "Enter" && S.mode === "poly") { finishDraft(); return; }

  // Left-hand deletion: ` (tilde key directly above Tab / left of 1) and standard Del/Backspace
  if ((k === "Backspace" || k === "`" || k === "~") && S.mode === "poly") { e.preventDefault(); S.draft.pop(); draw(); return; }
  if (k === "Delete" || k === "Backspace" || k === "`" || k === "~") { e.preventDefault(); deleteSelected(); return; }

  // Left-hand WASD nudging when rows are selected: Shift + W/A/S/D
  if (e.shiftKey && S.sel.size && (k === "W" || k === "w" || k === "A" || k === "a" || k === "S" || k === "s" || k === "D" || k === "d")) {
    e.preventDefault();
    const st = 5;
    const dx = (k.toLowerCase() === "a") ? -st : (k.toLowerCase() === "d") ? st : 0;
    const dy = (k.toLowerCase() === "w") ? -st : (k.toLowerCase() === "s") ? st : 0;
    pushUndo("arrow"); moveSel(dx, dy); markDirty(); return;
  }

  // Left-hand number row transformations: 1/2 rotate, 3/4 width, 5/6 length (Shift = 5x)
  if (k === "1" || k === "!") { doAct("rot-", e.shiftKey ? 5 : 1); return; }
  if (k === "2" || k === "@") { doAct("rot+", e.shiftKey ? 5 : 1); return; }
  if (k === "3" || k === "#") { doAct("wid-", e.shiftKey ? 5 : 1); return; }
  if (k === "4" || k === "$") { doAct("wid+", e.shiftKey ? 5 : 1); return; }
  if (k === "5" || k === "%") { doAct("len-", e.shiftKey ? 5 : 1); return; }
  if (k === "6" || k === "^") { doAct("len+", e.shiftKey ? 5 : 1); return; }

  // Arrow keys (standard / right-hand fallback)
  if (k.startsWith("Arrow")) {
    e.preventDefault(); if (!S.sel.size) return;
    if (e.altKey) {
      const act = { ArrowLeft: "wid-", ArrowRight: "wid+", ArrowDown: "len-", ArrowUp: "len+" }[k];
      doAct(act, e.shiftKey ? 5 : 1); return;
    }
    const st = e.shiftKey ? 10 : 1, dx = k === "ArrowLeft" ? -st : k === "ArrowRight" ? st : 0, dy = k === "ArrowUp" ? -st : k === "ArrowDown" ? st : 0;
    pushUndo("arrow"); moveSel(dx, dy); markDirty(); return;
  }
  if (k === "[" || k === "{") { doAct("rot-", e.shiftKey ? 5 : 1); return; }
  if (k === "]" || k === "}") { doAct("rot+", e.shiftKey ? 5 : 1); return; }

  switch (k.toLowerCase()) {
    case "d": nextImageOrUpload(); break;
    case "a": openImage(S.idx - 1); break;
    case "w":
    case "p": setMode(BOX() ? "box" : "poly"); break;
    case "r":
      if (BOX()) setMode("box");
      else openMulti();
      break;
    case "m": openMulti(); break;
    case "e": setMode("edit"); break;
    case "s":
    case "k": if (!BOX()) setMode(S.mode === "slice" ? "edit" : "slice"); break;
    case "q": if (!BOX()) rectifySel(); break;
    case "c":
      if (BOX()) {
        const selIdx = [...S.sel];
        if (selIdx.length) askClass(null, selIdx);
      } else {
        calibrateVP();
      }
      break;
    case "v": if (!BOX()) fillBetween(); break;
    case "f": fit(); break;              // F = Fit image
    case "g":
    case "h": toggleHide(); break;       // G = Hide/show segments (H = legacy alias)
    case "b":
    case "n": nextBad(); break;          // B = Next problem row (N = legacy alias)
    case "z":
    case "l": toggleFiles(); break;      // Z = Toggle images list (L = legacy alias)
    case "x":
    case "t": toggleTools(); break;      // X = Toggle tools panel (T = legacy alias)
  }
});
document.addEventListener("keyup", e => {
  if (e.key === " ") { S.space = false; cv.style.cursor = S.mode === "edit" ? "default" : S.mode === "poly" ? "none" : "crosshair"; }
  if (e.key === "Shift" && S.mode === "edit" && !S.drag && !S.space && !S.hoverHandle && !S.hoverSide && !S.hoverV) {
    cv.style.cursor = S.hover >= 0 ? "move" : "default";
  }
});

// ---------------------------------------------------------------- toolbar + dialogs
function toggleHide() {
  S.hideAll = !S.hideAll;
  $("#btnHide").classList.toggle("on", S.hideAll);
  const ic = $("#hideIcon"), tx = $("#hideText");
  if (ic) ic.textContent = S.hideAll ? "visibility_off" : "visibility";
  if (tx) tx.textContent = S.hideAll ? "Show segments" : "Hide segments";
  draw();
}
function toggleFiles(show) {
  const app = $("#app"), cx = S.cw / 2, cy = S.ch / 2;
  const hide = show === undefined ? !app.classList.contains("noleft") : !show;
  app.classList.toggle("noleft", hide); $("#btnFiles").classList.toggle("on", !hide); store("hideFiles", hide);
  requestAnimationFrame(() => { const r = $("#stage").getBoundingClientRect(); S.view.x += r.width / 2 - cx; S.view.y += r.height / 2 - cy; resize(); });
}
$("#btnFiles").onclick = () => toggleFiles();
function toggleTools(show) {
  const app = $("#app"), cx = S.cw / 2, cy = S.ch / 2;
  const hide = show === undefined ? !app.classList.contains("noright") : !show;
  app.classList.toggle("noright", hide); $("#btnTools").classList.toggle("on", !hide); store("hideTools", hide);
  requestAnimationFrame(() => { const r = $("#stage").getBoundingClientRect(); S.view.x += r.width / 2 - cx; S.view.y += r.height / 2 - cy; resize(); });
}
$("#btnTools").onclick = () => toggleTools();

// ---------------------------------------------------------------- HUD system
// Floating interactive tool HUD with live transform sliders & quick action buttons
const hudEl = $("#hud"), hudPuck = $("#hudPuck"), hudPanel = $("#hudPanel");
let hudSliderDragging = false;
let hudSliderSnap = null;
let hudSliderStartVal = 0;
let hudSliderActive = null;

function hudDefaultPos() {
  const r = $("#stage").getBoundingClientRect();
  return { x: Math.max(10, r.width - 70), y: 80 };
}

function adjustHudPanelPlacement(x, y) {
  const r = $("#stage").getBoundingClientRect();
  if (!r.width || !r.height) return;
  // If puck is in top 52% of the stage, open downward; otherwise open upward
  const isTopHalf = y < r.height * 0.52;
  hudEl.classList.toggle("open-down", isTopHalf);
  hudEl.classList.toggle("open-up", !isTopHalf);

  // Horizontal alignment: ensure panel stays within canvas
  const panelW = 296;
  if (x < 140) {
    hudPanel.style.left = "0px";
    hudPanel.style.right = "auto";
    hudPanel.style.transform = "none";
  } else if (x > r.width - 160) {
    hudPanel.style.left = "auto";
    hudPanel.style.right = "0px";
    hudPanel.style.transform = "none";
  } else {
    hudPanel.style.left = "50%";
    hudPanel.style.right = "auto";
    hudPanel.style.transform = "translateX(-50%)";
  }
}

function applyHudPos(pos) {
  const r = $("#stage").getBoundingClientRect();
  const puckSz = 38;
  const x = Math.max(6, Math.min(r.width  - puckSz - 6, pos.x));
  const y = Math.max(6, Math.min(r.height - puckSz - 6, pos.y));
  hudEl.style.left = x + "px";
  hudEl.style.top  = y + "px";
  adjustHudPanelPlacement(x, y);
  return { x, y };
}

function updateHudVpStyle() {
  hudEl.classList.toggle("vp-active", !!(S.vp || S.gradient));
}

function syncHudSliders() {
  if (hudSliderDragging) return;
  const sel = selEditable();
  const angSlider = $("#hudAngle"), angVal = $("#hudAngleVal");
  const widSlider = $("#hudWidth"), widVal = $("#hudWidthVal");
  const lenSlider = $("#hudLen"), lenVal = $("#hudLenVal");
  const badge = $("#hudSelBadge");

  if (badge) {
    badge.textContent = sel.length === 0 ? "No row" : sel.length === 1 ? "1 row" : `${sel.length} rows`;
    badge.classList.toggle("active", sel.length > 0);
  }

  if (!sel.length) {
    if (angSlider) { angSlider.disabled = true; angSlider.value = 0; }
    if (angVal) angVal.textContent = "–";
    if (widSlider) {
      widSlider.disabled = false;
      const defW = defaultRowWidth();
      widSlider.value = defW;
      if (widVal) widVal.textContent = defW + "px";
    }
    if (lenSlider) { lenSlider.disabled = true; lenSlider.value = 200; }
    if (lenVal) lenVal.textContent = "–";
    return;
  }

  let sumAng = 0, sumW = 0, sumL = 0;
  for (const i of sel) {
    const pts = ptsOf(S.shapes[i]);
    const { c, u, v } = axisOf(pts);
    sumAng += normAngle(Math.atan2(u[1], u[0]));
    const prV = pts.map(p => (p[0] - c[0]) * v[0] + (p[1] - c[1]) * v[1]);
    sumW += (Math.max(...prV) - Math.min(...prV));
    const prU = pts.map(p => (p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1]);
    sumL += (Math.max(...prU) - Math.min(...prU));
  }
  const avgDeg = Math.round((sumAng / sel.length) * 180 / Math.PI * 10) / 10;
  const avgW = Math.round(sumW / sel.length);
  const avgL = Math.round(sumL / sel.length);

  if (angSlider) {
    angSlider.disabled = false;
    angSlider.value = avgDeg;
    if (angVal) angVal.textContent = (avgDeg > 0 ? "+" : "") + avgDeg + "°";
  }
  if (widSlider) {
    widSlider.disabled = false;
    widSlider.value = avgW;
    if (widVal) widVal.textContent = avgW + "px";
  }
  if (lenSlider) {
    lenSlider.disabled = false;
    lenSlider.value = avgL;
    if (lenVal) lenVal.textContent = avgL + "px";
  }
}

function setupHudSliders() {
  const angSlider = $("#hudAngle"), widSlider = $("#hudWidth"), lenSlider = $("#hudLen");
  const angMinus = $("#hudAngMinus"), angPlus = $("#hudAngPlus");
  const widMinus = $("#hudWidMinus"), widPlus = $("#hudWidPlus");
  const lenMinus = $("#hudLenMinus"), lenPlus = $("#hudLenPlus");

  function startSliderDrag(type, currentVal) {
    hudSliderDragging = true;
    hudSliderActive = type;
    const idx = selEditable();
    hudSliderSnap = new Map(idx.map(i => [i, ptsOf(S.shapes[i]).map(p => [p[0], p[1]])]));
    hudSliderStartVal = currentVal;
    pushUndo("hud:" + type);
  }

  function endSliderDrag() {
    if (!hudSliderDragging) return;
    hudSliderDragging = false;
    hudSliderActive = null;
    hudSliderSnap = null;
    markDirty();
    syncHudSliders();
  }

  // --- Angle Slider ---
  if (angSlider) {
    angSlider.addEventListener("pointerdown", () => startSliderDrag("angle", +angSlider.value));
    angSlider.addEventListener("input", () => {
      const idx = selEditable();
      if (!idx.length || !hudSliderSnap) return;
      const newDeg = +angSlider.value;
      const deltaDeg = newDeg - hudSliderStartVal;
      const deltaRad = deltaDeg * Math.PI / 180;
      rotateSel(deltaRad, hudSliderSnap);
      $("#hudAngleVal").textContent = (newDeg > 0 ? "+" : "") + newDeg + "°";
      draw();
    });
    angSlider.addEventListener("pointerup", endSliderDrag);
    angSlider.addEventListener("change", endSliderDrag);
  }

  if (angMinus) {
    angMinus.addEventListener("click", () => {
      const idx = selEditable();
      if (!idx.length) return toast("Select rows first");
      pushUndo("hud:angle");
      rotateSel(-1 * Math.PI / 180);
      markDirty();
      syncHudSliders();
    });
  }
  if (angPlus) {
    angPlus.addEventListener("click", () => {
      const idx = selEditable();
      if (!idx.length) return toast("Select rows first");
      pushUndo("hud:angle");
      rotateSel(1 * Math.PI / 180);
      markDirty();
      syncHudSliders();
    });
  }

  // --- Width Slider ---
  if (widSlider) {
    widSlider.addEventListener("pointerdown", () => startSliderDrag("width", +widSlider.value));
    widSlider.addEventListener("input", () => {
      const newW = +widSlider.value;
      const idx = selEditable();
      if (!idx.length) {
        store("rowWidth", newW);
        $("#hudWidthVal").textContent = newW + "px";
        return;
      }
      if (!hudSliderSnap) return;
      const delta = newW - hudSliderStartVal;
      idx.forEach(i => {
        const src = hudSliderSnap.get(i);
        if (!src || src.length < 3) return;
        const { c, v } = axisOf(src);
        const pr = src.map(p => (p[0] - c[0]) * v[0] + (p[1] - c[1]) * v[1]);
        let lo = Infinity, hi = -Infinity;
        for (const val of pr) { if (val < lo) lo = val; if (val > hi) hi = val; }
        const ext = hi - lo;
        if (ext < 1e-4) return;
        const targetW = Math.max(3, ext + delta);
        const f = targetW / ext, mid = (hi + lo) / 2;
        S.shapes[i].points = src.map((p, k) => {
          const a = pr[k], na = (a - mid) * f + mid;
          return [p[0] + v[0] * (na - a), p[1] + v[1] * (na - a)];
        });
      });
      $("#hudWidthVal").textContent = newW + "px";
      draw();
    });
    widSlider.addEventListener("pointerup", endSliderDrag);
    widSlider.addEventListener("change", endSliderDrag);
  }

  if (widMinus) {
    widMinus.addEventListener("click", () => {
      const idx = selEditable();
      if (!idx.length) {
        const cur = Math.max(4, defaultRowWidth() - 2);
        store("rowWidth", cur);
        syncHudSliders();
        toast(`Default row width: ${cur}px`);
        return;
      }
      pushUndo("hud:width");
      resizeSel("wid", -2);
      markDirty();
      syncHudSliders();
    });
  }
  if (widPlus) {
    widPlus.addEventListener("click", () => {
      const idx = selEditable();
      if (!idx.length) {
        const cur = Math.min(150, defaultRowWidth() + 2);
        store("rowWidth", cur);
        syncHudSliders();
        toast(`Default row width: ${cur}px`);
        return;
      }
      pushUndo("hud:width");
      resizeSel("wid", 2);
      markDirty();
      syncHudSliders();
    });
  }

  // --- Length Slider ---
  if (lenSlider) {
    lenSlider.addEventListener("pointerdown", () => startSliderDrag("len", +lenSlider.value));
    lenSlider.addEventListener("input", () => {
      const idx = selEditable();
      if (!idx.length || !hudSliderSnap) return;
      const newL = +lenSlider.value;
      const delta = newL - hudSliderStartVal;
      idx.forEach(i => {
        const src = hudSliderSnap.get(i);
        if (!src || src.length < 3) return;
        const { c, u } = axisOf(src);
        const pr = src.map(p => (p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1]);
        let lo = Infinity, hi = -Infinity;
        for (const val of pr) { if (val < lo) lo = val; if (val > hi) hi = val; }
        const ext = hi - lo;
        if (ext < 1e-4) return;
        const targetL = Math.max(8, ext + delta);
        const f = targetL / ext, mid = (hi + lo) / 2;
        S.shapes[i].points = src.map((p, k) => {
          const a = pr[k], na = (a - mid) * f + mid;
          return [p[0] + u[0] * (na - a), p[1] + u[1] * (na - a)];
        });
      });
      $("#hudLenVal").textContent = newL + "px";
      draw();
    });
    lenSlider.addEventListener("pointerup", endSliderDrag);
    lenSlider.addEventListener("change", endSliderDrag);
  }

  if (lenMinus) {
    lenMinus.addEventListener("click", () => {
      const idx = selEditable();
      if (!idx.length) return toast("Select rows first");
      pushUndo("hud:length");
      resizeSel("len", -10);
      markDirty();
      syncHudSliders();
    });
  }
  if (lenPlus) {
    lenPlus.addEventListener("click", () => {
      const idx = selEditable();
      if (!idx.length) return toast("Select rows first");
      pushUndo("hud:length");
      resizeSel("len", 10);
      markDirty();
      syncHudSliders();
    });
  }
}

// HUD drag management
let hudDrag = null;
function attachHudDrag(targetEl, isPuck = false) {
  targetEl.addEventListener("pointerdown", e => {
    if (e.target.closest("button") && !isPuck) return;
    e.stopPropagation();
    e.preventDefault();
    targetEl.setPointerCapture(e.pointerId);
    const r = hudEl.getBoundingClientRect(), sr = $("#stage").getBoundingClientRect();
    hudDrag = {
      startX: e.clientX, startY: e.clientY,
      originX: r.left - sr.left, originY: r.top - sr.top,
      moved: false, isPuck
    };
  });
  targetEl.addEventListener("pointermove", e => {
    e.stopPropagation();
    if (!hudDrag) return;
    const dx = e.clientX - hudDrag.startX, dy = e.clientY - hudDrag.startY;
    if (!hudDrag.moved && Math.hypot(dx, dy) > 4) hudDrag.moved = true;
    if (hudDrag.moved) {
      S.hudPos = applyHudPos({ x: hudDrag.originX + dx, y: hudDrag.originY + dy });
    }
  });
  targetEl.addEventListener("pointerup", e => {
    e.stopPropagation();
    if (!hudDrag) return;
    if (!hudDrag.moved && hudDrag.isPuck) {
      S.hudOpen = !S.hudOpen;
      hudEl.classList.toggle("open", S.hudOpen);
      if (S.hudOpen) {
        adjustHudPanelPlacement(S.hudPos.x, S.hudPos.y);
        syncHudSliders();
      }
      store("hudOpen", S.hudOpen);
    } else if (hudDrag.moved) {
      store("hudPos", S.hudPos);
    }
    hudDrag = null;
  });
  targetEl.addEventListener("pointercancel", e => { e.stopPropagation(); hudDrag = null; });
}

function initHud() {
  S.hudPos  = recall("hudPos",  null);
  S.hudOpen = recall("hudOpen", false);
  const pos = S.hudPos || hudDefaultPos();
  S.hudPos = applyHudPos(pos);
  if (S.hudOpen) {
    hudEl.classList.add("open");
    adjustHudPanelPlacement(S.hudPos.x, S.hudPos.y);
  }
  updateHudVpStyle();
  setupHudSliders();
  syncHudSliders();
}

attachHudDrag(hudPuck, true);
const hudHdr = $("#hudHeader");
if (hudHdr) attachHudDrag(hudHdr, false);

const hudCloseBtn = $("#hudCloseBtn");
if (hudCloseBtn) {
  hudCloseBtn.addEventListener("click", e => {
    e.stopPropagation();
    S.hudOpen = false;
    hudEl.classList.remove("open");
    store("hudOpen", false);
  });
}

// Prevent any event on the HUD panel from reaching the canvas
hudPanel.addEventListener("pointerdown", e => e.stopPropagation());
hudPanel.addEventListener("pointermove", e => e.stopPropagation());
hudPanel.addEventListener("wheel", e => e.stopPropagation(), { passive: true });
hudPanel.addEventListener("dblclick", e => e.stopPropagation());

// HUD button bindings
$("#hudRectify").onclick  = () => rectifySel();
const hudSliceBtn = $("#hudSlice"); if (hudSliceBtn) hudSliceBtn.onclick = () => { if (S.img) setMode(S.mode === "slice" ? "edit" : "slice"); };
$("#hudPlant").onclick    = () => alignSelToPlants();
$("#hudGradient").onclick = () => alignAngleGradientSel();
$("#hudCalib").onclick    = () => calibrateVP();
$("#hudSnap").onclick     = () => snapAngleSel();
const hudSnapBedsBtn = $("#hudSnapBeds"); if (hudSnapBedsBtn) hudSnapBedsBtn.onclick = () => snapRowsToBeds();
const hudAlignEndsBtn = $("#hudAlignEnds"); if (hudAlignEndsBtn) hudAlignEndsBtn.onclick = () => alignEndsToMasters();
const hudFullFitBtn = $("#hudFullFit"); if (hudFullFitBtn) hudFullFitBtn.onclick = () => fullCalibAutoFit();
$("#hudFill").onclick     = () => fillBetween();
$("#hudMulti").onclick    = () => openMulti();
$("#hudDup").onclick      = () => duplicateSel();

// ---------------------------------------------------------------- remaining toolbar bindings
$("#btnOpen").onclick = $("#btnOpen2").onclick = openFolder;
$("#btnPrev").onclick = () => openImage(S.idx - 1);
$("#btnNext").onclick = () => nextImageOrUpload();

// Class selector & indicator bindings
const hdrClassSelect = $("#hdrClassSelect");
if (hdrClassSelect) {
  hdrClassSelect.addEventListener("change", e => {
    applyClassChange(e.target.value, false);
    e.target.blur();
  });
}
const btnSelAllClass = $("#btnSelectAllRowsClass");
if (btnSelAllClass) {
  btnSelAllClass.addEventListener("click", () => {
    const cls = (hdrClassSelect && hdrClassSelect.value) || S.label;
    applyClassChange(cls, true);
    btnSelAllClass.blur();
  });
}
const hdrClassSwatch = $("#hdrClassSwatch");
if (hdrClassSwatch) {
  hdrClassSwatch.style.cursor = "pointer";
  hdrClassSwatch.title = "Click to customize class color · Right-click to reset";
  hdrClassSwatch.addEventListener("click", e => {
    e.stopPropagation();
    openColorPickerFor(S.label);
  });
  hdrClassSwatch.addEventListener("contextmenu", e => {
    e.preventDefault();
    e.stopPropagation();
    resetClassColor(S.label);
  });
}
const colorPicker = $("#classColorPicker");
if (colorPicker) {
  colorPicker.addEventListener("input", e => {
    const lbl = colorPicker.dataset.targetLabel;
    if (!lbl) return;
    const rgb = parseHex(e.target.value);
    if (rgb) {
      customClassColors[lbl.toLowerCase()] = rgb;
      store("classColors", customClassColors);
      renderLabels();
      refreshAll();
    }
  });
  colorPicker.addEventListener("change", e => {
    const lbl = colorPicker.dataset.targetLabel;
    if (!lbl) return;
    const rgb = parseHex(e.target.value);
    if (rgb) {
      customClassColors[lbl.toLowerCase()] = rgb;
      store("classColors", customClassColors);
      renderLabels();
      refreshAll();
      toast(`Updated color for “${lbl}” to ${e.target.value}`, 2000);
    }
  });
}
$("#appMode").addEventListener("change", e => { applyAppMode(e.target.value); e.target.blur(); });
const mBoxBtn = $("#mBox"); if (mBoxBtn) mBoxBtn.onclick = () => setMode("box");
const askEachBox = $("#askEach"); if (askEachBox) askEachBox.addEventListener("change", e => { S.rememberClass = !e.target.checked; });
$("#mEdit").onclick = () => setMode("edit");
$("#mPoly").onclick = () => { if (S.img) setMode("poly"); };

// Context menu bindings
$("#ctxDraw").onclick = () => { closeCtx(); setMode(BOX() ? "box" : "poly"); };
$("#ctxBox").onclick = () => { closeCtx(); setMode("edit"); };
$("#ctxEdit").onclick = () => {
  const i = S.ctx; closeCtx();
  if (i == null || !S.shapes[i]) return;
  askClass(null, ctxTargets(i));
};
$("#ctxDelete").onclick = () => {
  const i = S.ctx; closeCtx();
  if (i == null || !S.shapes[i]) return;
  S.sel = new Set(ctxTargets(i)); deleteSelected();
};
document.addEventListener("click", e => { if (!e.target.closest("#ctxMenu")) closeCtx(); });

// Class picker dialog bindings
$("#clsCancel").onclick = () => closeClass(null);
$("#clsOk").onclick = () => { const v = $("#clsInput").value.trim(); if (v) closeClass(v); else closeClass(null); };
$("#clsList").onclick = e => { const it = e.target.closest(".clsItem"); if (it) { $("#clsInput").value = it.dataset.l; closeClass(it.dataset.l); } };
$("#clsInput").oninput = () => { S.clsTyped = true; renderClassList(); };
$("#clsInput").onkeydown = e => {
  if (e.key === "Enter") { e.preventDefault(); $("#clsOk").click(); }
  else if (e.key === "Escape") { e.preventDefault(); closeClass(null); }
  else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const items = [...$("#clsList").querySelectorAll(".clsItem:not(.dim)")];
    if (!items.length) return;
    const cur = items.findIndex(el => el.classList.contains("on"));
    const next = e.key === "ArrowDown" ? (cur + 1) % items.length : (cur - 1 + items.length) % items.length;
    items.forEach((el, idx) => el.classList.toggle("on", idx === next));
    if (items[next]) { $("#clsInput").value = items[next].dataset.l; items[next].scrollIntoView({ block: "nearest" }); }
  }
};
cv.addEventListener("pointerdown", hideTip);
cv.addEventListener("wheel", hideTip, { passive: true });
cv.addEventListener("pointerleave", hideTip);
const mSliceBtn = $("#mSlice"); if (mSliceBtn) mSliceBtn.onclick = () => { if (S.img) setMode(S.mode === "slice" ? "edit" : "slice"); };
// #mMulti button removed from header; kept only in HUD panel via #hudMulti
$("#btnSave").onclick = saveNow;
$("#btnUndo").onclick = undo; $("#btnRedo").onclick = redo;
$("#btnDel").onclick = deleteSelected;
const btnDelJsonEl = $("#btnDelJson"); if (btnDelJsonEl) btnDelJsonEl.onclick = deleteCurrentJson;
$("#btnFit").onclick = fit;
$("#btnHide").onclick = toggleHide;
$("#btnSelAll").onclick = selectAll;
$("#btnSelNone").onclick = () => { S.sel = new Set(); S.selV = null; refreshAll(); };
$("#btnNextBad").onclick = nextBad;
$("#btnHelp").onclick = () => $("#dlgHelp").showModal();
$("#helpClose").onclick = () => $("#dlgHelp").close();

function openMulti() {
  if (!S.img) return toast("Open a folder first");
  $("#mN").value = S.multi.n; $("#mGap").value = S.multi.gap;
  $("#mDirSeg").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === S.multi.dir));
  $("#dlgMulti").showModal(); $("#mN").select();
}
$("#mDirSeg").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; $("#mDirSeg").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); });
$("#mCancel").onclick = () => $("#dlgMulti").close();
$("#mOk").onclick = () => {
  const n = Math.round(+$("#mN").value);
  if (!(n >= 1 && n <= 200)) return toast("Enter a number of rows between 1 and 200");
  S.multi = { n, dir: $("#mDirSeg .on").dataset.v, gap: Math.max(0, +$("#mGap").value || 0) };
  store("multi", S.multi); $("#dlgMulti").close(); setMode("multi");
};
$("#dlgMulti").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("#mOk").click(); } });

// ---------------------------------------------------------------- zip (stored, no compression needed for a few JSONs)
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function makeZip(entries) {
  const enc = new TextEncoder(), parts = [], central = [], d = new Date(); let off = 0;
  const tm = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dt = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const e of entries) {
    const nm = enc.encode(e.name), crc = crc32(e.data), sz = e.data.length;
    const h = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, tm, 2], [12, dt, 2], [14, crc, 4], [18, sz, 4], [22, sz, 4], [26, nm.length, 2], [28, 0, 2]]
      .forEach(([o, v, n]) => n === 4 ? h.setUint32(o, v, true) : h.setUint16(o, v, true));
    parts.push(new Uint8Array(h.buffer), nm, e.data);
    const c = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, tm, 2], [14, dt, 2], [16, crc, 4], [20, sz, 4], [24, sz, 4],
     [28, nm.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, off, 4]]
      .forEach(([o, v, n]) => n === 4 ? c.setUint32(o, v, true) : c.setUint16(o, v, true));
    central.push(new Uint8Array(c.buffer), nm);
    off += 30 + nm.length + sz;
  }
  const csz = central.reduce((s, a) => s + a.length, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, csz, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
}
const blobToBase64 = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = () => rej(r.error); r.readAsDataURL(b); });

// ---------------------------------------------------------------- Personal Google Sheet Auto-Sync (Restricted Sheet + Secret Token + TSV Fallback)
function generateSheetSecret(len = 24) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function getSheetConfig() {
  const cfg = recall("sheetConfig", { url: "", token: "", enabled: false });
  if (!cfg.token) {
    cfg.token = generateSheetSecret();
    store("sheetConfig", cfg);
  }
  return cfg;
}

function saveSheetConfig(cfg) {
  store("sheetConfig", cfg);
  updateSheetStatusUI();
}

function buildAppsScriptCode(secret) {
  const safeSecret = String(secret || generateSheetSecret()).replace(/["\\]/g, "");
  return `// ============================================================================
// Personal Daily Work Tracker — Private Apps Script (Code.gs)
// Keep your Google Sheet RESTRICTED (Private). Do NOT share the sheet link publicly.
// Deploy -> New deployment -> Web app -> Execute as: Me -> Who has access: Anyone
// ============================================================================
const SECRET = "${safeSecret}";

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const d = JSON.parse(e.postData.contents);
    if (!SECRET || d.token !== SECRET) {
      return jsonOut({ ok: false, error: "Invalid or missing secret token" });
    }
    if (d.test) {
      const shTest = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
      const sheetName = shTest.getName();
      return jsonOut({ ok: true, mode: "test", message: "Connected & authorized to edit sheet: " + sheetName });
    }
    const sh = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    const items = Array.isArray(d.batch) ? d.batch : [d];
    const results = [];

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      const lastRow = Math.max(1, sh.getLastRow());
      // Read Columns B (Date), C (Block No), and D (Total Plots) only — never touch Columns G-J summary table!
      const colB = sh.getRange(1, 2, lastRow, 1).getValues();
      const colC = sh.getRange(1, 3, lastRow, 1).getValues();
      const colD = sh.getRange(1, 4, lastRow, 1).getValues();

      let targetRow = -1;
      let firstEmptySlot = -1;
      let lastFilledRow = 1;
      const reqBlockNo = String(item.blockNo != null ? item.blockNo : "").trim();
      const reqBlockId = String(item.blockId || "").trim().toUpperCase();

      for (let r = 1; r < colC.length; r++) {
        const bVal = String(colB[r][0]).trim();
        const cVal = String(colC[r][0]).trim();
        const dVal = String(colD[r][0]).trim();
        if (cVal !== "") {
          lastFilledRow = r + 1;
          // 1. If Block No is already pre-filled (e.g. 472..476) or matches this block, update in place!
          if (cVal === reqBlockNo || cVal.toUpperCase() === reqBlockId) {
            targetRow = r + 1;
            break;
          }
        } else if (dVal === "" && bVal === "" && firstEmptySlot === -1) {
          firstEmptySlot = r + 1;
        }
      }

      if (targetRow === -1) {
        targetRow = firstEmptySlot !== -1 ? firstEmptySlot : (lastFilledRow + 1);
        if (lastFilledRow >= 2) {
          // Copy formatting from previous entry for Columns A-E only (safe try/catch for Google Sheets Typed Tables!)
          try { sh.getRange(lastFilledRow, 1, 1, 5).copyFormatToRange(sh, 1, 5, targetRow, targetRow); } catch (fmtErr) {}
        }
      }

      const dt = (item.year && item.month && item.day) ? new Date(item.year, item.month - 1, item.day) : new Date();
      const imgCount = Number(item.imageCount);
      const blockVal = /^\\d+$/.test(reqBlockNo) ? Number(reqBlockNo) : (reqBlockNo || reqBlockId || item.folder);

      // Write Columns B, C, D, E in one atomic range write (do NOT call setNumberFormat on Google Sheets Typed Columns!)
      sh.getRange(targetRow, 2, 1, 4).setValues([[dt, blockVal, isFinite(imgCount) ? imgCount : 0, "Done"]]);
      results.push({ row: targetRow, blockNo: blockVal, imageCount: imgCount });
    }

    SpreadsheetApp.flush();
    const firstRes = results[0] || {};
    return jsonOut({ ok: true, count: results.length, row: firstRes.row, blockNo: firstRes.blockNo, imageCount: firstRes.imageCount, results });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}`;
}

function buildBlockSheetEntry(folder, totalImages, jsonCount, totalBlockSec) {
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth() + 1, day = now.getDate();
  const dateStr = `${month}/${day}/${year}`;
  const blockId = extractBlockId(folder);
  const blockNo = extractBlockNumber(folder);
  return {
    id: `${folder}_${Date.now()}`,
    ts: Date.now(),
    year, month, day, dateStr,
    folder,
    blockId,
    blockNo,
    imageCount: totalImages,
    jsonCount,
    blockTimeSeconds: totalBlockSec,
    synced: false
  };
}

function recordSheetLocalLog(entry) {
  const logs = recall("sheetLog", []);
  const idx = logs.findIndex(x => x.folder === entry.folder && x.dateStr === entry.dateStr);
  if (idx >= 0) logs[idx] = { ...logs[idx], ...entry };
  else logs.push(entry);
  if (logs.length > 300) logs.splice(0, logs.length - 300);
  store("sheetLog", logs);
}

function enqueueSheetRetry(entry) {
  const q = recall("sheetQueue", []);
  const idx = q.findIndex(x => x.folder === entry.folder);
  if (idx >= 0) q[idx] = entry;
  else q.push(entry);
  store("sheetQueue", q);
  updateSheetStatusUI();
}

async function postEntryToPersonalSheet(cfg, entry) {
  const body = JSON.stringify({
    token: cfg.token,
    year: entry.year,
    month: entry.month,
    day: entry.day,
    dateStr: entry.dateStr,
    blockNo: entry.blockNo,
    blockId: entry.blockId,
    folder: entry.folder,
    imageCount: entry.imageCount,
    jsonCount: entry.jsonCount,
    blockTimeSeconds: entry.blockTimeSeconds
  });
  const r = await fetch(cfg.url, { method: "POST", body, redirect: "follow" });
  let j;
  try { j = await r.json(); } catch (e) { throw new Error("Sheet Web App answered with HTTP " + r.status); }
  if (!j || !j.ok) throw new Error((j && j.error) || "Sheet sync refused");
  return j;
}

async function postBatchToPersonalSheet(cfg, entries) {
  const body = JSON.stringify({
    token: cfg.token,
    batch: entries.map(entry => ({
      year: entry.year,
      month: entry.month,
      day: entry.day,
      dateStr: entry.dateStr,
      blockNo: entry.blockNo,
      blockId: entry.blockId,
      folder: entry.folder,
      imageCount: entry.imageCount,
      jsonCount: entry.jsonCount,
      blockTimeSeconds: entry.blockTimeSeconds
    }))
  });
  const r = await fetch(cfg.url, { method: "POST", body, redirect: "follow" });
  let j;
  try { j = await r.json(); } catch (e) { throw new Error("Sheet Web App answered with HTTP " + r.status); }
  if (!j || !j.ok) throw new Error((j && j.error) || "Sheet sync refused");
  return j;
}

async function syncBlockToPersonalSheet(entry) {
  recordSheetLocalLog(entry);
  const cfg = getSheetConfig();
  if (!cfg.enabled || !cfg.url) {
    return { skipped: true, html: `<span class="muted">Personal Sheet: logged locally (${entry.blockNo} · ${entry.imageCount} plots). Copy TSV anytime in Report → Sheet Sync.</span>` };
  }
  try {
    const res = await postEntryToPersonalSheet(cfg, entry);
    entry.synced = true;
    recordSheetLocalLog(entry);
    // Remove from retry queue if present
    const q = recall("sheetQueue", []).filter(x => x.folder !== entry.folder);
    store("sheetQueue", q);
    updateSheetStatusUI();
    return {
      ok: true,
      row: res.row,
      html: `<span style="color:var(--ok)">✓ Logged to Personal Google Sheet: Block <b>${esc(String(entry.blockNo))}</b> · <b>${entry.imageCount}</b> plots${res.row ? ` (Row ${res.row})` : ""}</span>`
    };
  } catch (e) {
    enqueueSheetRetry(entry);
    return {
      ok: false,
      error: e.message,
      html: `<span style="color:var(--warn)">⚠ Personal Sheet offline queue: Block <b>${esc(String(entry.blockNo))}</b> (${entry.imageCount} plots) saved to retry queue (${esc(e.message)})</span>`
    };
  }
}

async function retrySheetQueue() {
  const cfg = getSheetConfig();
  const msgEl = $("#sheetMsg");
  if (!cfg.url) {
    if (msgEl) msgEl.innerHTML = `<span style="color:var(--bad)">Paste your Apps Script Web App URL first.</span>`;
    return { synced: 0, remaining: recall("sheetQueue", []).length };
  }
  const q = recall("sheetQueue", []);
  if (!q.length) {
    updateSheetStatusUI();
    return { synced: 0, remaining: 0 };
  }
  const rem = [];
  let synced = 0, lastErr = "";
  for (const item of q) {
    try {
      await postEntryToPersonalSheet(cfg, item);
      item.synced = true;
      recordSheetLocalLog(item);
      synced++;
    } catch (e) {
      lastErr = e.message;
      rem.push(item);
    }
  }
  store("sheetQueue", rem);
  updateSheetStatusUI();
  if (msgEl) {
    msgEl.innerHTML = rem.length
      ? `<span style="color:var(--warn)">Synced ${synced} block(s); ${rem.length} still pending (${esc(lastErr)}).</span>`
      : `<span style="color:var(--ok)">✓ All ${synced} queued block(s) synced to your Google Sheet!</span>`;
  }
  return { synced, remaining: rem.length };
}

function formatSheetTsvRows(entries) {
  return entries.map(e => `${e.dateStr}\t${e.blockNo}\t${e.imageCount}\tDone`).join("\n");
}

function collectTodayRetroBlocks() {
  const logs = recall("sheetLog", []);
  const q = recall("sheetQueue", []);
  const now = new Date();
  const todayStr = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;
  const stats = getDailyStats(getTodayDateStr());
  const byFolder = new Map();

  for (const item of logs) {
    if (item && item.folder && (item.dateStr === todayStr || !item.synced)) byFolder.set(item.folder, item);
  }
  for (const item of q) {
    if (item && item.folder) byFolder.set(item.folder, item);
  }

  // Reconstruct any blocks finished earlier today BEFORE Sheet Sync was configured!
  if (stats && Array.isArray(stats.blocks)) {
    const imgs = Array.isArray(stats.images) ? stats.images : [];
    for (const folder of stats.blocks) {
      if (!folder || byFolder.has(folder)) continue;
      const prefix = folder.toLowerCase() + "/";
      const matchedImgs = imgs.filter(k => String(k).toLowerCase().startsWith(prefix)).length;
      const imgCnt = matchedImgs > 0 ? matchedImgs : 8;
      const entry = buildBlockSheetEntry(folder, imgCnt, imgCnt, 0);
      recordSheetLocalLog(entry);
      byFolder.set(folder, entry);
    }
  }
  return [...byFolder.values()];
}

async function syncAllTodayDoneBlocks() {
  const btn = $("#btnSyncTodayBlocks");
  if (btn && btn.disabled) return;
  if (btn) btn.disabled = true;
  try {
    const urlEl = $("#sheetUrl"), tokEl = $("#sheetToken"), enEl = $("#sheetEnabled"), msgEl = $("#sheetMsg");
    if (urlEl && tokEl) {
      const url = urlEl.value.trim();
      const token = tokEl.value.trim() || generateSheetSecret();
      const enabled = enEl ? enEl.checked : true;
      if (url) saveSheetConfig({ url, token, enabled });
    }
    const cfg = getSheetConfig();
    if (!cfg.url) {
      if (msgEl) msgEl.innerHTML = `<span style="color:var(--bad)">Paste your Web App URL first, or click <b>Copy Rows for Sheet (TSV)</b>.</span>`;
      return;
    }

    // Also auto-archive any completed (0 images + *_jsons.zip) block folders sitting in the root Workspace ('Potato Rows')
    let archivedCnt = 0;
    if (S.workspace && S.workspace.root) {
      const unarchivedDone = S.workspace.blocks.filter(b => b.status === "done" && !b.archived && b.handle);
      for (const b of unarchivedDone) {
        try {
          let zipBlob = null, zipName = null;
          for await (const [nm, fh] of b.handle.entries()) {
            if (fh.kind === "file" && /_jsons\.zip$/i.test(nm)) {
              zipName = nm;
              zipBlob = await fh.getFile();
              break;
            }
          }
          if (zipBlob && zipName) {
            const ar = await archiveBlockFolder(S.workspace.root, b.name, zipBlob, zipName);
            if (ar.ok) archivedCnt++;
          }
        } catch (e) {}
      }
      if (archivedCnt > 0) await scanWorkspace(S.workspace.root, false);
    }

    const entries = collectTodayRetroBlocks();
    if (!entries.length) {
      if (msgEl) {
        msgEl.innerHTML = archivedCnt
          ? `<span style="color:var(--ok)">✓ Moved ${archivedCnt} completed folder(s) into <code>uploaded/</code>. No today blocks found to sync.</span>`
          : `<span style="color:var(--warn)">No completed blocks found for today yet.</span>`;
      }
      return;
    }

    if (msgEl) msgEl.innerHTML = `<span class="muted">Syncing ${entries.length} completed block(s) to your Google Sheet…</span>`;
    let synced = 0, lastErr = "";
    let rem = [];
    // Send all blocks in a single batch POST first (avoids Google Apps Script rapid-fire CORS/rate drops!)
    try {
      const bRes = await postBatchToPersonalSheet(cfg, entries);
      if (bRes && bRes.count >= entries.length) {
        entries.forEach(item => { item.synced = true; recordSheetLocalLog(item); });
        synced = entries.length;
      } else {
        throw new Error("NO_BATCH");
      }
    } catch (batchErr) {
      for (const item of entries) {
        try {
          await postEntryToPersonalSheet(cfg, item);
          item.synced = true;
          recordSheetLocalLog(item);
          synced++;
        } catch (e) {
          lastErr = e.message;
          rem.push(item);
        }
        await new Promise(res => setTimeout(res, 250));
      }
    }
    store("sheetQueue", rem);
    updateSheetStatusUI();
    const arcTxt = archivedCnt ? ` &amp; moved <b>${archivedCnt}</b> done folder(s) to <code>uploaded/</code>` : "";
    if (msgEl) {
      msgEl.innerHTML = rem.length
        ? `<span style="color:var(--warn)">Synced <b>${synced}</b> block(s)${arcTxt}; ${rem.length} failed (${esc(lastErr)}). <b>Fix:</b> Click <b>Copy Apps Script</b> → paste in Apps Script → <b>Deploy → Manage deployments → ✏️ Edit → New version → Deploy</b>.</span>`
        : `<span style="color:var(--ok)">✓ Synced all <b>${synced}</b> completed block(s) (${entries.map(e => esc(String(e.blockNo))).join(", ")}) to your Google Sheet${arcTxt}!</span>`;
    }
    toast(`Synced ${synced} completed block(s) to Google Sheet!`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function copyUnsyncedSheetTsv() {
  collectTodayRetroBlocks();
  const logs = recall("sheetLog", []);
  const q = recall("sheetQueue", []);
  const unsynced = logs.filter(x => !x.synced);
  const now = new Date();
  const todayStr = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;
  const todayLogs = logs.filter(x => x.dateStr === todayStr);
  const target = unsynced.length ? unsynced : q.length ? q : todayLogs.length ? todayLogs : logs.slice(-15);
  const msgEl = $("#sheetMsg");
  if (!target.length) {
    if (msgEl) msgEl.innerHTML = `<span style="color:var(--warn)">No completed blocks logged yet.</span>`;
    toast("No completed blocks to copy yet");
    return "";
  }
  const tsv = formatSheetTsvRows(target);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(tsv);
    }
  } catch (e) {}
  if (msgEl) {
    msgEl.innerHTML = `<span style="color:var(--ok)">✓ Copied <b>${target.length}</b> row(s) as TSV (<code>Date | Block No | Total Plots | Done</code>). Click Column B in your Google Sheet and press <kbd>Ctrl+V</kbd>!</span>`;
  }
  toast(`Copied ${target.length} row(s) for Google Sheet (paste into Column B)`);
  return tsv;
}

function updateSheetStatusUI() {
  const cfg = getSheetConfig();
  const pill = $("#sheetStatusPill");
  const q = recall("sheetQueue", []);
  if (pill) {
    if (cfg.enabled && cfg.url) {
      pill.className = "badge";
      pill.style.background = "rgba(40,225,115,0.2)";
      pill.style.color = "var(--ok)";
      pill.textContent = q.length ? `Active · ${q.length} queued` : "Active";
    } else {
      pill.className = "badge none";
      pill.style.background = "";
      pill.style.color = "";
      pill.textContent = "Not set";
    }
  }
  const qBox = $("#sheetQueueBox"), qTxt = $("#sheetQueueText");
  if (qBox && qTxt) {
    qBox.style.display = q.length ? "" : "none";
    qTxt.textContent = `${q.length} pending block sync(s) in offline queue`;
  }
}

function openSheetDialog() {
  const cfg = getSheetConfig();
  const urlEl = $("#sheetUrl"), tokEl = $("#sheetToken"), enEl = $("#sheetEnabled"), msgEl = $("#sheetMsg");
  if (urlEl) urlEl.value = cfg.url || "";
  if (tokEl) tokEl.value = cfg.token || "";
  if (enEl) enEl.checked = !!cfg.enabled;
  if (msgEl) msgEl.textContent = "";
  updateSheetStatusUI();
  const dlg = $("#dlgSheet");
  if (dlg) dlg.showModal();
}

async function testSheetConnection() {
  const urlEl = $("#sheetUrl"), tokEl = $("#sheetToken"), msgEl = $("#sheetMsg"), btn = $("#btnTestSheet");
  const url = (urlEl && urlEl.value.trim()) || "";
  const token = (tokEl && tokEl.value.trim()) || "";
  if (!url) {
    if (msgEl) msgEl.innerHTML = `<span style="color:var(--bad)">Enter your deployed Apps Script Web App URL ending in <code>/exec</code>.</span>`;
    return;
  }
  if (btn && btn.disabled) return;
  if (btn) btn.disabled = true;
  if (msgEl) msgEl.innerHTML = `<span class="muted">Testing connection to private Google Sheet…</span>`;
  try {
    const r = await fetch(url, { method: "POST", body: JSON.stringify({ token, test: true }), redirect: "follow" });
    let j;
    try { j = await r.json(); } catch (e) { throw new Error("HTTP " + r.status + " (check Who has access: Anyone)"); }
    if (!j.ok) throw new Error(j.error || "Connection refused");
    if (msgEl) msgEl.innerHTML = `<span style="color:var(--ok)">✓ ${esc(j.message || "Connected to your Google Sheet!")}</span>`;
  } catch (e) {
    if (msgEl) msgEl.innerHTML = `<span style="color:var(--bad)">✖ Test failed: ${esc(e.message)}. Make sure you deployed as <b>Who has access: Anyone</b> and authorized Spreadsheet access, or use <b>Copy Rows for Sheet (TSV)</b>.</span>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---------------------------------------------------------------- upload to Drive
function taskFolderName() {
  const rels = [...new Set(S.files.map(f => f.rel))];
  return rels.length === 1 && rels[0] ? rels[0].split("/").pop() : S.root.name;
}
async function collectJsons() {
  const rels = [...new Set(S.files.map(f => f.rel))], single = rels.length === 1;
  const out = { entries: [], bad: [], unreadable: [], missing: [], segments: 0 };
  const enc = new TextEncoder(), folder = taskFolderName();
  for (const f of S.files) {
    if (!f.json) { out.missing.push(f.name); continue; }
    let text;
    try { text = await (await f.json.getFile()).text(); const d = JSON.parse(text), sh = (d.shapes || []).map(normShape);
      out.segments += sh.length; const nb = sh.filter(isBad).length; f.bad = nb; f.count = sh.length;
      if (nb) out.bad.push(`${f.name} (${nb})`);
    } catch (e) { out.unreadable.push(f.name); continue; }
    const inner = single ? "" : (f.rel ? f.rel + "/" : "");
    out.entries.push({ name: `${folder}/${inner}${stem(f.name)}.json`, data: enc.encode(text) });
  }
  renderFiles();
  return out;
}
let upState = null;
let upProgTimer = null;
function setUploadProgress(pct, label, state = "active") {
  const wrap = $("#upProgWrap"), fill = $("#upProgFill"), lbl = $("#upProgLabel"), pctEl = $("#upProgPct");
  if (!wrap || !fill) return;
  if (pct === null) {
    clearInterval(upProgTimer); upProgTimer = null;
    wrap.style.display = "none";
    return;
  }
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  wrap.style.display = "flex";
  fill.style.width = clamped + "%";
  fill.classList.toggle("active", state === "active");
  fill.classList.toggle("done", state === "done");
  fill.classList.toggle("err", state === "err");
  if (lbl && label != null) lbl.textContent = label;
  if (pctEl) {
    pctEl.textContent = clamped + "%";
    pctEl.style.color = state === "done" ? "var(--ok)" : state === "err" ? "var(--bad)" : "var(--accent)";
  }
}
function startUploadCreep(startPct, maxPct, label) {
  clearInterval(upProgTimer);
  let cur = startPct;
  setUploadProgress(cur, label, "active");
  upProgTimer = setInterval(() => {
    const step = Math.max(0.4, (maxPct - cur) * 0.08);
    cur = Math.min(maxPct, cur + step);
    setUploadProgress(cur, label, "active");
    if (cur >= maxPct - 0.1) { clearInterval(upProgTimer); upProgTimer = null; }
  }, 180);
}
async function openUpload() {
  if (BOX()) return; // Upload to Drive is for Row Labeler Mode only
  if (!S.root || !S.files.length) return toast("Open a task folder first");
  setUploadProgress(null);
  await fitAndSave(true); await flush();
  const c = await collectJsons(), folder = taskFolderName();
  upState = c;
  const totalBlockSec = blockSeconds;
  const avgSec = S.files.length ? Math.round(totalBlockSec / S.files.length) : 0;
  const li = (k, v) => `<span class="muted">${k}</span><span>${v}</span>`;
  const btnNextUp = $("#btnNextBlockUp");
  if (btnNextUp) btnNextUp.style.display = "none";
  const thenDesc = (S.workspace && S.workspace.root)
    ? `<span style="color:var(--warn)">images &amp; loose JSONs are deleted; <b>${esc(folder)}/${esc(folder)}_jsons.zip</b> is automatically moved to <b>uploaded/</b></span>`
    : `<span style="color:var(--warn)">the images and JSONs are <b>deleted from this computer</b>; ${esc(folder)}_jsons.zip stays in the folder</span>`;
  $("#upInfo").innerHTML = li("Folder", `<b>${esc(folder)}</b>`) +
    li("Time spent on block", `<b>${formatDuration(totalBlockSec)}</b> <span class="muted">(${avgSec}s avg / image)</span>`) +
    li("Images", S.files.length) +
    li("JSONs to upload", c.entries.length) + li("Segments", c.segments) +
    li("Goes to", `Shared Drive › Labeled JSONs › ${esc(folder)} › ${esc(folder)}_jsons.zip`) +
    li("Then", thenDesc);
  $("#upName").value = recall("labeler", "");
  const msg = [];
  if (!UPLOAD.url) msg.push(`<div style="color:var(--bad)">Upload is not set up in this copy of the tool. Ask the manager for the updated file.</div>`);
  if (c.bad.length) msg.push(`<div style="color:var(--bad)"><b>Fix these first.</b> Some segments don't have exactly ${ROW_VERTS} vertices:<br>${c.bad.map(esc).join("<br>")}</div>`);
  if (c.unreadable.length) msg.push(`<div style="color:var(--bad)">These JSONs can't be read:<br>${c.unreadable.map(esc).join("<br>")}</div>`);
  if (c.missing.length) msg.push(`<div style="color:var(--warn)">${c.missing.length} image(s) have no JSON and will be skipped:<br>${c.missing.slice(0, 8).map(esc).join("<br>")}${c.missing.length > 8 ? "<br>…" : ""}</div>`);
  if (!c.entries.length) msg.push(`<div style="color:var(--bad)">There are no JSONs to upload.</div>`);
  $("#upMsg").innerHTML = msg.join("<br>");
  $("#upGo").disabled = !UPLOAD.url || !!c.bad.length || !!c.unreadable.length || !c.entries.length;
  $("#upGo").textContent = "Upload";
  S.folderDone = true;
  $("#dlgUp").showModal();
  checkTabActive();
}
async function doUpload() {
  const name = $("#upName").value.trim();
  if (!name) { $("#upName").focus(); $("#upMsg").innerHTML = `<div style="color:var(--bad)">Enter your name.</div>`; return; }
  store("labeler", name);
  const go = $("#upGo"); go.disabled = true; go.textContent = "Uploading…";
  $("#upMsg").innerHTML = "";
  setUploadProgress(8, "Saving & checking JSONs…", "active");
  try {
    await flush();
    const c = await collectJsons();
    if (c.bad.length || c.unreadable.length || !c.entries.length) throw new Error("QC check failed, close this window and check again");
    setUploadProgress(22, `Zipping ${c.entries.length} JSON file${c.entries.length === 1 ? "" : "s"}…`, "active");
    const folder = taskFolderName(), zip = makeZip(c.entries);
    const totalImages = S.files.length; // Capture TOTAL image count BEFORE cleanupLocal wipes S.files!
    const totalBlockSec = blockSeconds;
    const body = JSON.stringify({ token: UPLOAD.token, folder, fileName: folder + "_jsons.zip", data: await blobToBase64(zip),
      labeler: name, jsonCount: c.entries.length, imageCount: totalImages, segmentCount: c.segments,
      blockTimeSeconds: totalBlockSec, blockTimeFormatted: formatDuration(totalBlockSec) });
    startUploadCreep(32, 74, `Uploading ${folder}_jsons.zip (${(zip.size / 1024).toFixed(0)} KB) to Drive…`);
    const r = await fetch(UPLOAD.url, { method: "POST", body });
    clearInterval(upProgTimer); upProgTimer = null;
    let j; try { j = await r.json(); } catch (e) { throw new Error("Drive answered with HTTP " + r.status); }
    if (!j.ok) throw new Error(j.error || "upload refused");
    recordBlockDone(folder);
    S.files.forEach(f => {
      if (f.json && f.count > 0 && !f.bad) recordImageDone(f);
    });
    const done = `<div style="color:var(--ok)"><b>✓ Uploaded</b> ${c.entries.length} JSONs (${(zip.size / 1024).toFixed(0)} KB)` +
      (j.replaced ? `. The earlier upload was replaced.` : ".") +
      `<br><b>Total working time on this block:</b> ${formatDuration(totalBlockSec)}` +
      `<br><a href="${esc(j.folderUrl || "#")}" target="_blank" style="color:var(--accent)">Open the Drive folder</a></div>`;
    go.textContent = "Uploaded ✓";
    toast(`Uploaded to Drive! Total time on block: ${formatDuration(totalBlockSec)}`, 8000);

    // Fire Personal Google Sheet sync in the background (non-blocking — never delays cleanup or Open Next Block!)
    const sheetSlotId = "upSheetStatus";
    const sheetCfg = getSheetConfig();
    const initialSheetHtml = (sheetCfg.enabled && sheetCfg.url)
      ? `<div id="${sheetSlotId}" style="margin-top:6px;font-size:12px"><span class="muted">Logging Block ${esc(String(extractBlockNumber(folder)))} (${totalImages} plots) to Google Sheet in background…</span></div>`
      : `<div id="${sheetSlotId}" style="margin-top:6px;font-size:12px"></div>`;

    try {
      const entry = buildBlockSheetEntry(folder, totalImages, c.entries.length, totalBlockSec);
      syncBlockToPersonalSheet(entry).then(shRes => {
        const slot = $("#" + sheetSlotId);
        if (slot && shRes && shRes.html) slot.innerHTML = shRes.html;
      }).catch(sheetErr => {
        console.warn("Personal sheet sync error:", sheetErr);
      });
    } catch (sheetErr) {
      console.warn("Personal sheet sync error:", sheetErr);
    }

    setUploadProgress(88, (S.workspace && S.workspace.root) ? "Archiving to uploaded/…" : "Cleaning up…", "active");
    $("#upMsg").innerHTML = done + initialSheetHtml;
    const cl = await cleanupLocal(zip, folder + "_jsons.zip");
    setUploadProgress(100, cl.ok ? "Complete!" : "Cleanup warning", cl.ok ? "done" : "err");
    // Append cleanup line without wiping any background Sheet update that may have already landed in #upSheetStatus
    const existingSlot = $("#" + sheetSlotId);
    const liveSheetHtml = existingSlot ? existingSlot.outerHTML : initialSheetHtml;
    $("#upMsg").innerHTML = done + liveSheetHtml + `<div style="margin-top:8px;color:${cl.ok ? "var(--ok)" : "var(--warn)"}">${cl.html}</div>`;
  } catch (e) {
    clearInterval(upProgTimer); upProgTimer = null;
    setUploadProgress(100, "Upload failed", "err");
    $("#upMsg").innerHTML = `<div style="color:var(--bad)">Upload failed: ${esc(e.message)}. Check your internet connection and try again.</div>`;
    go.disabled = false; go.textContent = "Try again";
  }
}
function taskDir() {
  const dirs = [...new Set(S.files.map(f => f.dir))];
  return dirs.length === 1 ? dirs[0] : S.root;
}
async function cleanupLocal(zip, zipName) {
  const dir = taskDir();
  const blockFolderName = (S.root && S.root.name) || taskFolderName();
  try {
    const h = await dir.getFileHandle(zipName, { create: true });
    const w = await h.createWritable(); await w.write(zip); await w.close();
    const back = await h.getFile();
    if (back.size !== zip.size) throw new Error("the saved zip has the wrong size");
  } catch (e) {
    return { ok: false, html: `Could not save ${esc(zipName)} in the folder (${esc(e.message)}). <b>No files were deleted.</b>` };
  }
  clearTimeout(S.saveTimer); S.saveTimer = null; S.dirty = false;
  let n = 0; const failed = [];
  for (const f of S.files) {
    const names = [f.name]; if (f.json) names.push(f.json.name || stem(f.name) + ".json");
    for (const nm of names) {
      try { await f.dir.removeEntry(nm); n++; } catch (e) { if (e.name !== "NotFoundError") failed.push(nm); }
    }
  }
  S.cache.forEach(p => p.then(b => b.close && b.close()).catch(() => {})); S.cache.clear();
  if (S.root) store("blocktime." + S.root.name, 0);
  blockSeconds = 0;
  imgSeconds = 0;
  updateTimerDisplay();
  S.files = []; S.idx = -1; S.img = null; S.data = null; S.shapes = []; S.sel = new Set(); S.undo = []; S.redo = [];
  S.vp = null; S.gradient = null; S.calibMasters = null; S.calibBounds = null; S.snapEdges = null;
  offscreenCv = null; offscreenCtx = null; offscreenBuf = null; offscreenW = 0; offscreenH = 0;
  S.folderDone = true;
  checkTabActive();

  // If inside a multi-block Workspace ('Potato Rows'), automatically archive the completed block folder into 'uploaded/'!
  let archiveNote = "";
  if (!failed.length && S.workspace && S.workspace.root && blockFolderName) {
    const ar = await archiveBlockFolder(S.workspace.root, blockFolderName, zip, zipName);
    if (ar.ok) {
      archiveNote = ` Moved folder to <b>${esc(ar.archivedPath)}</b>.`;
    } else if (ar.error) {
      archiveNote = ` <span style="color:var(--warn)">(Kept in root folder: ${esc(ar.error)})</span>`;
    }
    await scanWorkspace(S.workspace.root, false);
  }

  $("#folderInfo").textContent = `Uploaded ✓ · only ${zipName} is left in this folder`;
  $("#empty b").textContent = "Task uploaded"; $("#empty").style.display = "flex";
  setSave("none"); refreshAll(); renderLabels();
  updateNextBlockButtons();
  return failed.length
    ? { ok: false, html: `${esc(zipName)} saved in the folder. ${n} files deleted, but these could not be deleted: ${failed.slice(0, 6).map(esc).join(", ")}${failed.length > 6 ? "…" : ""}. Close other programs using them and delete them by hand.` }
    : { ok: true, html: `✓ ${n} image and JSON files deleted from this computer. Only <b>${esc(zipName)}</b> is kept.${archiveNote}` };
}
$("#btnUpload").onclick = openUpload;
$("#upGo").onclick = doUpload;
$("#upClose").onclick = () => $("#dlgUp").close();
const dlgUpEl = $("#dlgUp");
if (dlgUpEl) {
  dlgUpEl.addEventListener("close", () => {
    if (S.files.length > 0 && S.img && S.idx >= 0) S.folderDone = false;
    checkTabActive();
  });
}
const repBtn = $("#btnReport"); if (repBtn) repBtn.onclick = openReport;
const timerBadge = $("#workTimer"); if (timerBadge) timerBadge.onclick = openReport;
const repClose = $("#reportClose"); if (repClose) repClose.onclick = () => $("#dlgReport").close();
const dlgRepEl = $("#dlgReport");
if (dlgRepEl) {
  dlgRepEl.addEventListener("close", () => checkTabActive());
}
const copyRepBtn = $("#btnCopyReport"); if (copyRepBtn) copyRepBtn.onclick = copyReportSummary;

// Workspace Block Queue UI bindings
const wsTabsEl = $("#wsTabs");
if (wsTabsEl) {
  wsTabsEl.addEventListener("click", e => {
    const btn = e.target.closest(".ws-tab");
    if (!btn) return;
    S.workspace.tab = btn.dataset.tab || "pending";
    renderWorkspaceQueue();
  });
}
const wsListEl = $("#wsList");
if (wsListEl) {
  wsListEl.addEventListener("click", async e => {
    const item = e.target.closest(".ws-item");
    if (!item || !S.workspace || !S.workspace.root) return;
    const bname = item.dataset.bname;
    const block = S.workspace.blocks.find(b => b.name === bname);
    if (!block) return;
    if (block.status === "done") {
      toast(`${block.blockId} is already completed (${block.archived ? "in uploaded/" : "ZIP ready"})`);
      return;
    }
    S.workspace.currentName = block.name;
    store("lastWsBlock." + S.workspace.root.name, block.name);
    renderWorkspaceQueue();
    await loadDirectory(block.handle);
  });
}
const btnWsRef = $("#btnWsRefresh");
if (btnWsRef) {
  btnWsRef.onclick = async () => {
    if (S.workspace && S.workspace.root) {
      await scanWorkspace(S.workspace.root, false);
      toast("Workspace queue refreshed");
    }
  };
}
const btnNextUpEl = $("#btnNextBlockUp");
if (btnNextUpEl) btnNextUpEl.onclick = () => openNextPendingBlock();
const btnNextEmpEl = $("#btnNextBlockEmpty");
if (btnNextEmpEl) btnNextEmpEl.onclick = () => openNextPendingBlock();

// Personal Google Sheet Sync Dialog UI bindings
const btnSheetSet = $("#btnSheetSettings");
if (btnSheetSet) btnSheetSet.onclick = openSheetDialog;
const btnGenTok = $("#btnGenSheetToken");
if (btnGenTok) {
  btnGenTok.onclick = () => {
    const tokEl = $("#sheetToken");
    if (tokEl) tokEl.value = generateSheetSecret();
    const msgEl = $("#sheetMsg");
    if (msgEl) msgEl.innerHTML = `<span style="color:var(--warn)">New token generated. Click <b>Copy Apps Script</b> and re-deploy your Web App if you change tokens.</span>`;
  };
}
const btnCopyScript = $("#btnCopySheetScript");
if (btnCopyScript) {
  btnCopyScript.onclick = async () => {
    const tokEl = $("#sheetToken");
    const secret = (tokEl && tokEl.value.trim()) || generateSheetSecret();
    if (tokEl && !tokEl.value.trim()) tokEl.value = secret;
    const code = buildAppsScriptCode(secret);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(code);
    } catch (e) {}
    const msgEl = $("#sheetMsg");
    if (msgEl) {
      msgEl.innerHTML = `<span style="color:var(--ok)">✓ Copied <b>Code.gs</b> with your secret token! In your Google Sheet: <b>Extensions → Apps Script</b>, paste, then <b>Deploy → New deployment → Web app</b> (Execute as: <b>Me</b>, Access: <b>Anyone</b>).</span>`;
    }
    toast("Copied Apps Script (Code.gs) to clipboard");
  };
}
const btnTestSh = $("#btnTestSheet");
if (btnTestSh) btnTestSh.onclick = () => testSheetConnection();
const btnSyncToday = $("#btnSyncTodayBlocks");
if (btnSyncToday) btnSyncToday.onclick = () => syncAllTodayDoneBlocks();
const btnCopyTsv = $("#btnCopySheetTsv");
if (btnCopyTsv) btnCopyTsv.onclick = () => copyUnsyncedSheetTsv();
const btnRetrySh = $("#btnRetrySheetQueue");
if (btnRetrySh) btnRetrySh.onclick = () => retrySheetQueue();
const btnSheetClose = $("#sheetClose");
if (btnSheetClose) btnSheetClose.onclick = () => $("#dlgSheet").close();
const btnSheetSave = $("#sheetSave");
if (btnSheetSave) {
  btnSheetSave.onclick = () => {
    const url = ($("#sheetUrl") && $("#sheetUrl").value.trim()) || "";
    const token = ($("#sheetToken") && $("#sheetToken").value.trim()) || generateSheetSecret();
    const enabled = !!($("#sheetEnabled") && $("#sheetEnabled").checked);
    saveSheetConfig({ url, token, enabled });
    $("#dlgSheet").close();
    toast(enabled && url ? "Personal Google Sheet sync enabled ✓" : "Sheet settings saved");
  };
}

// ---------------------------------------------------------------- start
S.multi = { ...S.multi, ...recall("multi", {}) };
S.pivot = recall("pivot", "group");
$("#pivotSeg").querySelectorAll("button").forEach(x => x.classList.toggle("on", x.dataset.v === S.pivot));
if (!window.showDirectoryPicker) $("#browserNote").textContent = "This browser cannot save into folders. Please open this file in Google Chrome or Microsoft Edge.";
if (recall("hideFiles", false)) { $("#app").classList.add("noleft"); $("#btnFiles").classList.remove("on"); }
if (recall("hideTools", false)) { $("#app").classList.add("noright"); $("#btnTools").classList.remove("on"); }
applyAppMode(S.app, true);
renderLabels(); refreshAll(); resize();
initHud();
initTimers();
checkRestoreSession();
