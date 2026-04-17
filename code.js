figma.showUI(__html__, { width: 400, height: 380 });

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'export') {
    await runExport(
      msg.quality || 0.85,
      msg.factor != null ? msg.factor : 1,
      msg.format || 'image/webp'
    );
  }
};

async function runExport(quality, factor, format) {
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
    // Decode in 8 KB chunks to avoid call-stack overflow on large exports
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

  // All bitmap handling now happens in the UI iframe: it parses the SVG,
  // finds every <image> element, and recompresses the base64 pixel data
  // that Figma already embedded (un-rotated, un-skewed). That keeps the
  // surrounding transforms intact so rotated/skewed fills render correctly.
  figma.ui.postMessage({
    type: 'process',
    svgString: svgString,
    quality: quality,
    factor: factor,
    format: format,
    fileName: sanitizeFileName(root.name)
  });
}

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '_') || 'export';
}
