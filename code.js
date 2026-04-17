figma.showUI(__html__, { width: 400, height: 420 });

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'export') {
    await runExport(msg.quality || 0.85, msg.scale || 1);
  }
};

async function runExport(quality, requestedScale) {
  const selection = figma.currentPage.selection;

  if (selection.length !== 1) {
    figma.ui.postMessage({ type: 'error', message: 'Please select exactly one frame or group.' });
    return;
  }

  const root = selection[0];
  figma.ui.postMessage({ type: 'status', message: 'Exporting SVG...' });

  // Export the entire selection as SVG
  let svgString;
  try {
    const svgBytes = await root.exportAsync({ format: 'SVG' });
    // Decode in chunks to avoid call stack overflow on large exports
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

  // Find all nodes with image fills (walk the tree)
  const imageNodes = [];
  findImageNodes(root, imageNodes);

  figma.ui.postMessage({
    type: 'status',
    message: `Found ${imageNodes.length} image(s). Exporting at display scale...`
  });

  // Export each image node as PNG, capped by the underlying bitmap's native size
  const imageData = [];
  for (let i = 0; i < imageNodes.length; i++) {
    const node = imageNodes[i];
    const scale = await resolveExportScale(node, requestedScale);
    figma.ui.postMessage({
      type: 'status',
      message: `Exporting image ${i + 1}/${imageNodes.length} @${scale.toFixed(2)}x: ${node.name}`
    });

    const pngBytes = await node.exportAsync({
      format: 'PNG',
      constraint: { type: 'SCALE', value: scale }
    });

    imageData.push({
      nodeId: node.id,
      nodeName: node.name,
      width: Math.round(node.width),
      height: Math.round(node.height),
      pngBytes: Array.from(pngBytes)
    });
  }

  figma.ui.postMessage({
    type: 'process',
    svgString: svgString,
    images: imageData,
    quality: quality,
    fileName: sanitizeFileName(root.name)
  });
}

async function resolveExportScale(node, requestedScale) {
  if (requestedScale <= 1) return 1;
  if (!('fills' in node) || !Array.isArray(node.fills)) return requestedScale;

  // Cap the scale so we never upscale beyond the largest underlying bitmap.
  let maxFromImages = 0;
  for (const fill of node.fills) {
    if (fill.type !== 'IMAGE' || fill.visible === false || !fill.imageHash) continue;
    const image = figma.getImageByHash(fill.imageHash);
    if (!image) continue;
    const { width, height } = await image.getSizeAsync();
    const fit = Math.min(width / node.width, height / node.height);
    if (fit > maxFromImages) maxFromImages = fit;
  }

  if (maxFromImages === 0) return requestedScale;
  return Math.max(1, Math.min(requestedScale, maxFromImages));
}

function findImageNodes(node, result) {
  // Check if this node has image fills
  if ('fills' in node) {
    const fills = node.fills;
    if (Array.isArray(fills)) {
      for (const fill of fills) {
        if (fill.type === 'IMAGE' && fill.visible !== false) {
          result.push(node);
          break;
        }
      }
    }
  }

  // Recurse into children
  if ('children' in node) {
    for (const child of node.children) {
      findImageNodes(child, result);
    }
  }
}

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '_') || 'export';
}
