figma.showUI(__html__, { width: 400, height: 380 });

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'export') {
    await runExport(msg);
  }
};

async function runExport({ quality = 0.75, factor = 2, format = 'image/webp', detail = '1' }) {
  const selection = figma.currentPage.selection;
  if (selection.length !== 1) {
    figma.ui.postMessage({ type: 'error', message: 'Please select exactly one frame or group.' });
    return;
  }

  const root = selection[0];
  figma.ui.postMessage({ type: 'status', message: 'Exporting SVG...' });

  let svgString;
  try {
    const svgBytes = await root.exportAsync({ format: 'SVG', svgIdAttribute: true });
    const chunks = [];
    const CHUNK = 8192;
    for (let i = 0; i < svgBytes.length; i += CHUNK) {
      chunks.push(String.fromCharCode.apply(null, svgBytes.subarray(i, i + CHUNK)));
    }
    svgString = chunks.join('');
  } catch (e) {
    figma.ui.postMessage({ type: 'error', message: 'SVG export failed: ' + e.message });
    return;
  }

  // Walk the scene graph, collecting one entry per unique image hash. The
  // key trick vs. v2.0.0: we fetch the NATIVE bitmap bytes via
  // getImageByHash, not the rendered node via exportAsync. exportAsync
  // bakes skew/rotate/crop into the PNG, which then renders again under
  // the ancestor <g transform> — the double-transform bug. Native bytes
  // flow through Figma's original <image width/height> and <use
  // transform> coordinate system exactly as designed.
  const hashToEntry = new Map();
  const entries = [];
  collectImageFills(root, hashToEntry, entries, factor);

  figma.ui.postMessage({
    type: 'status',
    message: `Fetching ${entries.length} unique image(s)...`,
  });

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    try {
      const image = figma.getImageByHash(entry.hash);
      if (!image) {
        figma.ui.postMessage({ type: 'error', message: `Missing image for hash ${entry.hash}` });
        return;
      }
      const [bytes, size] = await Promise.all([image.getBytesAsync(), image.getSizeAsync()]);
      entry.bytes = bytes;
      entry.nativeW = size.width;
      entry.nativeH = size.height;
    } catch (e) {
      figma.ui.postMessage({ type: 'error', message: `Failed to load image: ${e.message}` });
      return;
    }
  }

  figma.ui.postMessage({
    type: 'process',
    svgString,
    images: entries,
    quality,
    format,
    detail,
    factor,
    fileName: sanitizeFileName(root.name),
  });
}

function collectImageFills(node, hashToEntry, entries, factor) {
  if ('fills' in node && Array.isArray(node.fills)) {
    for (const fill of node.fills) {
      if (!fill || fill.type !== 'IMAGE' || fill.visible === false) continue;
      if (!fill.imageHash) continue;

      const ancestorScale = absoluteScale(node);
      const localMax = Math.max(node.width, node.height);
      const displayMax = localMax * ancestorScale;
      // factor = 0 ("Original") → targetMax = 0 → UI keeps native resolution.
      const targetMax = factor === 0 ? 0 : Math.ceil(displayMax * factor);

      const existing = hashToEntry.get(fill.imageHash);
      if (!existing) {
        const entry = {
          hash: fill.imageHash,
          sampleNodeName: node.name,
          targetMax,
        };
        hashToEntry.set(fill.imageHash, entry);
        entries.push(entry);
      } else {
        // The same bitmap may be used by several nodes at different sizes.
        // Downsize to the largest requested resolution so no consumer is
        // starved. "Original" (0) wins if any consumer asked for native.
        if (existing.targetMax === 0 || targetMax === 0) {
          existing.targetMax = 0;
        } else if (targetMax > existing.targetMax) {
          existing.targetMax = targetMax;
        }
      }
    }
  }

  if ('children' in node) {
    for (const c of node.children) {
      collectImageFills(c, hashToEntry, entries, factor);
    }
  }
}

// Extract the rendered scale factor from the node's absoluteTransform.
// Skew and rotation don't change how many pixels the image needs, so we
// only look at the scaling magnitude of each axis.
function absoluteScale(node) {
  if (!node.absoluteTransform) return 1;
  const m = node.absoluteTransform;
  const sx = Math.hypot(m[0][0], m[1][0]);
  const sy = Math.hypot(m[0][1], m[1][1]);
  return Math.max(1, Math.max(sx, sy));
}

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '_') || 'export';
}
