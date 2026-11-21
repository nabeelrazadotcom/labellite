# LabelLite

A lightweight, zero-build, browser-based image annotation tool for **oriented 4-point polygons (Row Mode)** and **axis-aligned bounding boxes (Box Mode)** — built with plain HTML, CSS, and JavaScript.

## Features

- **Dual Annotation Modes**
  - **Row Mode:** Draw, slice, rectify, duplicate, and edit 4-vertex oriented polygons with centerline drawing, side/end handle dragging, and multi-row generation.
  - **Box Mode:** Fast 2-point bounding-box annotation (compatible with LabelMe / AnyLabeling JSON format) with class management and right-click context menus.
- **Perspective & Alignment Tools**
  - **Rectify (`Q`):** Snap rough polygons into clean symmetric rectangles.
  - **Perspective Calibration (`C` / `Alt+C`):** Compute vanishing-point perspective, bed color, and boundary lines from 2 outer reference rows.
  - **Perspective Fill (`V` / `Alt+V`):** Generate perspective-correct rows between two boundary rows.
  - **Auto-Align & Snap:** Smooth perspective gradients (`Alt+G`), snap angles to VP (`Alt+A`), align row ends (`Alt+E`), and perpendicular snapping (`Alt+P`, `Alt+B`).
  - **Floating HUD:** Draggable on-canvas quick-tools panel.
- **Local Folder Workflow**
  - Opens local image folders directly via the browser's File System Access API — no backend server or installation required.
  - Reads and saves per-image `.json` annotation files in place, with full Undo/Redo (`Ctrl+Z` / `Ctrl+Y`) and automatic bounds clamping on save (`Ctrl+S`).
- **Progress Tracking & Integrations**
  - Built-in daily progress report (active work time, images completed, pace, 7-day history).
  - Optional Drive upload and personal Google Sheet sync support.

## Getting Started

LabelLite requires **no build step or dependencies**:

1. Clone or download this repository:
   ```bash
   git clone https://github.com/nabeelrazadotcom/labellite.git
   ```
2. Open `index.html` in a Chromium-based browser (Chrome, Edge, Brave, etc. — required for the File System Access API), or serve the folder with any static server.
3. Click **Open** in the top bar to select your local image folder and start labeling.

## Essential Shortcuts

| Shortcut | Action |
|---|---|
| `A` / `D` | Previous / Next image |
| `E` / `Esc` | Edit mode / Cancel drawing / Clear selection |
| `W` (or `P`) | Draw row segment (Row Mode) |
| `S` (or `K`) | Slice row into two pieces (Row Mode) |
| `R` | Multi-row generator (Row Mode) / Draw box (Box Mode) |
| `Q` | Rectify selected rows |
| `C` / `V` | Calibrate perspective / Fill rows between boundaries |
| `1` / `2` | Rotate selected rows (`Shift` = 5×) |
| `3` / `4` | Adjust width (`Shift` = 5×) |
| `5` / `6` | Adjust length (`Shift` = 5×) |
| `Shift` + `WASD` | Nudge selected rows |
| `F` / `G` | Fit image to window / Toggle annotations visibility |
| `Ctrl+S` | Save current image annotations |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `` ` `` or `Del` | Delete selected segment or vertex |

Press the **Help (`?`)** button inside the app for the complete list of keyboard and mouse controls.

## Project Structure

- `index.html` — Application layout, toolbar, panels, and dialogs
- `style.css` — Dark UI styling and canvas overlay components
- `script.js` — Canvas renderer, annotation tools, File System Access I/O, and workflow utilities
