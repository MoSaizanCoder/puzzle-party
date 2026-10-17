export function loadPuzzleImage(sourceImageUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load puzzle image: ${sourceImageUrl}`));
    image.src = sourceImageUrl;
  });
}

function edgePoint(start, direction, normal, distance, depth) {
  return {
    x: start.x + direction.x * distance + normal.x * depth,
    y: start.y + direction.y * distance + normal.y * depth,
  };
}

function appendEdge(path, start, end, outward, polarity, depth) {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const direction = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
  const normal = { x: outward.x * polarity, y: outward.y * polarity };
  const point = (along, bulge = 0) => edgePoint(start, direction, normal, length * along, depth * bulge);
  const lineTo = (position) => path.push({ command: 'lineTo', x: position.x, y: position.y });
  const curveTo = (first, second, destination) => {
    path.push({
      command: 'bezierCurveTo',
      control1X: first.x,
      control1Y: first.y,
      control2X: second.x,
      control2Y: second.y,
      x: destination.x,
      y: destination.y,
    });
  };

  if (!polarity) {
    lineTo(end);
    return;
  }

  lineTo(point(0.32));
  curveTo(point(0.37), point(0.38, 0.35), point(0.42, 0.35));
  curveTo(point(0.45, 0.35), point(0.44, 1.05), point(0.5, 1.05));
  curveTo(point(0.56, 1.05), point(0.55, 0.35), point(0.58, 0.35));
  curveTo(point(0.62, 0.35), point(0.63), point(0.68));
  lineTo(end);
}

function createPiecePath(cellWidth, cellHeight, depth, edges) {
  const path = [{ command: 'moveTo', x: 0, y: 0 }];
  appendEdge(path, { x: 0, y: 0 }, { x: cellWidth, y: 0 }, { x: 0, y: -1 }, edges.top, depth);
  appendEdge(path, { x: cellWidth, y: 0 }, { x: cellWidth, y: cellHeight }, { x: 1, y: 0 }, edges.right, depth);
  appendEdge(path, { x: cellWidth, y: cellHeight }, { x: 0, y: cellHeight }, { x: 0, y: 1 }, edges.bottom, depth);
  appendEdge(path, { x: 0, y: cellHeight }, { x: 0, y: 0 }, { x: -1, y: 0 }, edges.left, depth);
  path.push({ command: 'closePath' });
  return path;
}

function randomPosition(width, height, cellWidth, cellHeight, depth, occupied, random) {
  const minimumX = depth;
  const minimumY = depth;
  const maximumX = Math.max(minimumX, width - cellWidth - depth);
  const maximumY = Math.max(minimumY, height - cellHeight - depth);
  const center = {
    left: width * 0.31,
    right: width * 0.69,
    top: height * 0.33,
    bottom: height * 0.67,
  };
  const zones = [
    { minX: minimumX, maxX: maximumX, minY: minimumY, maxY: Math.min(maximumY, center.top - cellHeight - depth) },
    { minX: minimumX, maxX: maximumX, minY: Math.max(minimumY, center.bottom + depth), maxY: maximumY },
    { minX: minimumX, maxX: Math.min(maximumX, center.left - cellWidth - depth), minY: minimumY, maxY: maximumY },
    { minX: Math.max(minimumX, center.right + depth), maxX: maximumX, minY: minimumY, maxY: maximumY },
  ].filter((zone) => zone.maxX >= zone.minX && zone.maxY >= zone.minY);

  const choosePosition = () => {
    const zone = zones[Math.floor(random() * zones.length)];
    return {
      x: zone.minX + random() * (zone.maxX - zone.minX),
      y: zone.minY + random() * (zone.maxY - zone.minY),
    };
  };

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { x, y } = choosePosition();
    const overlaps = occupied.some((position) => (
      x < position.x + cellWidth + depth * 0.3
      && x + cellWidth + depth * 0.3 > position.x
      && y < position.y + cellHeight + depth * 0.3
      && y + cellHeight + depth * 0.3 > position.y
    ));

    if (!overlaps) return { x, y };
  }

  return choosePosition();
}

export function generatePuzzlePieces(image, canvasWidth, canvasHeight, options = {}) {
  // 1. Enforce higher density (14 columns creates roughly 70-120 pieces depending on ratio)
  const columns = options.columns ?? 14; 
  
  // 2. Calculate rows strictly based on aspect ratio so pieces remain uniform and square-ish
  const rows = options.rows ?? Math.max(4, Math.round(columns * (image.naturalHeight / image.naturalWidth)));
  
  const random = options.random ?? Math.random;
  
  // 3. Standardize the board scale to occupy exactly 80% of the viewport 
  // This decouples the piece scale from the raw image file's natural dimensions
  const imageScale = Math.min(
    (canvasWidth * 0.80) / image.naturalWidth,
    (canvasHeight * 0.80) / image.naturalHeight,
  );
  
  const boardWidth = image.naturalWidth * imageScale;
  const boardHeight = image.naturalHeight * imageScale;
  const cellWidth = boardWidth / columns;
  const cellHeight = boardHeight / rows;
  const depth = Math.min(cellWidth, cellHeight) * 0.24;
  const horizontalSeams = Array.from({ length: rows - 1 }, () => (
    Array.from({ length: columns }, () => (random() < 0.5 ? -1 : 1))
  ));
  const verticalSeams = Array.from({ length: rows }, () => (
    Array.from({ length: columns - 1 }, () => (random() < 0.5 ? -1 : 1))
  ));
  const occupied = [];
  const pieces = {};

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const edges = {
        top: row === 0 ? 0 : -horizontalSeams[row - 1][column],
        right: column === columns - 1 ? 0 : verticalSeams[row][column],
        bottom: row === rows - 1 ? 0 : horizontalSeams[row][column],
        left: column === 0 ? 0 : -verticalSeams[row][column - 1],
      };
      const id = `piece-${row}-${column}`;
      const position = randomPosition(
        canvasWidth,
        canvasHeight,
        cellWidth,
        cellHeight,
        depth,
        occupied,
        random,
      );

      occupied.push(position);
      pieces[id] = {
        id,
        shapeData: {
          path: createPiecePath(cellWidth, cellHeight, depth, edges),
          sourceX: column * cellWidth,
          sourceY: row * cellHeight,
          gridRow: row,
          gridColumn: column,
          boardWidth,
          boardHeight,
          cellWidth,
          cellHeight,
          tabDepth: depth,
        },
        x: position.x,
        y: position.y,
        groupId: null,
        isLockedInFrame: false,
      };
    }
  }

  return pieces;
}