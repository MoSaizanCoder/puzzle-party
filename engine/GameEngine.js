import { generatePuzzlePieces } from './PuzzleGenerator.js';

export default class GameEngine {
  constructor(canvas, sourceImageUrl, { onGameState = () => {}, socket, localPlayerId, initialGameState, onPieceSnap = () => {} } = {}) {
    this.canvas = canvas;
    this.onPieceSnap = onPieceSnap;
    this.sourceImageUrl = sourceImageUrl;
    this.context = null;
    this.image = null;
    this.pieces = {};
    this.drawOrder = [];
    this.paths = new Map();
    this.onGameState = onGameState;
    this.playerId = localPlayerId;
    this.socket = socket;
    this.latestGameState = null;
    this.hasServerPieces = false;
    this.initialPiecesSent = false;
    this.lastMovementSentAt = 0;
    this.focusTimeout = null;
    this.guideHighlight = null;
    this.width = 0;
    this.height = 0;
    this.viewportWidth = 0;
    this.viewportHeight = 0;
    this.viewScale = 1;
    this.viewOffsetX = 0;
    this.viewOffsetY = 0;
    this.pixelRatio = 1;
    this.frameId = null;
    this.dragState = null;
    this.groupSequence = 0;
    this.destroyed = false;
    this.userZoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.latestGameState = initialGameState || null;

    this.handleWheel = (event) => {
      event.preventDefault();
      const bounds = this.canvas.getBoundingClientRect();
      const canvasX = ((event.clientX - bounds.left) / bounds.width) * this.viewportWidth;
      const canvasY = ((event.clientY - bounds.top) / bounds.height) * this.viewportHeight;

      // Find where the mouse is pointing in the world
      const worldX = (canvasX - this.viewOffsetX) / this.viewScale;
      const worldY = (canvasY - this.viewOffsetY) / this.viewScale;

      // Adjust Zoom
      const zoomFactor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      this.userZoom = Math.max(0.2, Math.min(this.userZoom * zoomFactor, 5));
      this.viewScale = this.baseScale * this.userZoom;

      // Adjust pan so the mouse stays over the exact same puzzle piece
      this.viewOffsetX = canvasX - worldX * this.viewScale;
      this.viewOffsetY = canvasY - worldY * this.viewScale;
      this.panX = this.viewOffsetX - this.baseOffsetX;
      this.panY = this.viewOffsetY - this.baseOffsetY;

      this.context?.setTransform(
        this.pixelRatio * this.viewScale, 0, 0,
        this.pixelRatio * this.viewScale,
        this.pixelRatio * this.viewOffsetX,
        this.pixelRatio * this.viewOffsetY,
      );
    };
    this.handleSocketDisconnect = () => {
      this.initialPiecesSent = false;
      this.hasServerPieces = false;
      this.latestGameState = null;
      this.pieces = {};
      this.drawOrder = [];
      this.paths.clear();
    };
    this.handleForceReset = () => {
      this.pieces = {};
      this.drawOrder = [];
      this.hasServerPieces = false;
      this.initialPiecesSent = false;
      this.dragState = null;
      this.width = this.viewportWidth;
      this.height = this.viewportHeight;
      this.resize();
      this.regeneratePieces();
      this.publishInitialPieces();
    };
    this.handleGameState = (state) => {
      this.latestGameState = state;
      if (state.boardWidth > 0 && state.boardHeight > 0
        && (this.width !== state.boardWidth || this.height !== state.boardHeight)) {
        this.width = state.boardWidth;
        this.height = state.boardHeight;
        this.resize();
      }
      if (Object.keys(state.pieces ?? {}).length > 0 && !this.hasServerPieces) {
        this.installPieces(state.pieces);
        this.hasServerPieces = true;
      } else if (Object.keys(state.pieces ?? {}).length > 0) {
        this.syncPieceState(state.pieces);
      } else if (state.status === 'PLAYING' && !this.initialPiecesSent) {
        // --- NEW: Fix Race Condition! ONLY the Host can generate starting positions ---
        if (state.hostId === this.playerId) {
          if (this.drawOrder.length === 0) this.regeneratePieces();
          this.publishInitialPieces();
        }
      }
      this.onGameState(state);
    };
    this.handleRemoteMovement = ({ pieces = [] } = {}) => {
      for (const update of pieces) {
        const piece = this.pieces[update.id];
        if (!piece || this.dragState?.pieceIds.includes(update.id)) continue;
        piece.x = update.x;
        piece.y = update.y;
      }
    };
    this.handleFocusCracker = ({ durationMs = 15000 } = {}) => {
      const target = this.canvas.parentElement;
      if (!target) return;
      clearTimeout(this.focusTimeout);
      target.classList.add('effect-focus-cracker');
      this.focusTimeout = setTimeout(() => {
        target.classList.remove('effect-focus-cracker');
        this.focusTimeout = null;
      }, Math.max(0, Math.min(durationMs, 15000)));
    };
    this.handleGuidePieceHighlight = ({ pieceIds = [], durationMs = 5000 } = {}) => {
      if (pieceIds.length === 0) return;
      this.guideHighlight = {
        pieceIds,
        startedAt: performance.now(),
        durationMs: Math.max(0, Math.min(durationMs, 5000)),
      };
    };
    this.renderFrame = this.renderFrame.bind(this);
    this.resize = this.resize.bind(this);
    this.handleMouseDown = this.beginDrag.bind(this);
    this.handleMouseMove = this.moveDrag.bind(this);
    this.handleMouseUp = this.endDrag.bind(this);
    this.handleTouchStart = (event) => {
      // This is attached only to the canvas, so it safely prevents 
      // the page from scrolling when you try to grab a piece.
      event.preventDefault();
      this.beginDrag(event);
    };
    this.handleTouchMove = (event) => {
      // ONLY prevent default scrolling if we are actively holding a piece
      if (this.dragState) {
        event.preventDefault();
      }
      this.moveDrag(event);
    };
    this.handleTouchEnd = (event) => {
      // ONLY intercept the tap if we are actively dropping a piece
      if (this.dragState) {
        event.preventDefault();
      }
      this.endDrag(event);
    };
    this.socket.on('disconnect', this.handleSocketDisconnect);
    this.socket.on('force_reset', this.handleForceReset);
    this.socket.on('game_state', this.handleGameState);
    this.socket.on('piece_moved', this.handleRemoteMovement);
    this.socket.on('focus_cracker', this.handleFocusCracker);
    this.socket.on('guide_piece_highlight', this.handleGuidePieceHighlight);
  }

  async start(imageUrl = this.sourceImageUrl ?? '/puzzle-reference.svg') {
    this.sourceImageUrl = imageUrl;
    this.context = this.canvas.getContext('2d');
    if (!this.context) throw new Error('A 2D canvas context is required.');

    this.image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Unable to load puzzle image: ${imageUrl}`));
      img.src = imageUrl;
    });
    if (this.destroyed) return;

    window.addEventListener('resize', this.resize);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.resize);
      this.resizeObserver.observe(this.canvas.parentElement ?? this.canvas);
    }
    this.addInputListeners();

    this.resize();
    this.frameId = requestAnimationFrame(this.renderFrame);

    this.regeneratePieces();
    if (this.latestGameState) {
      this.handleGameState(this.latestGameState);
    }
  }

  resize() {
    const bounds = this.canvas.getBoundingClientRect();
    const container = this.canvas.parentElement;
    this.viewportWidth = container?.clientWidth || bounds.width || 0;
    this.viewportHeight = container?.clientHeight || bounds.height || 0;
    
    // --- NEW: Force a standardized virtual coordinate space for all devices ---
    if (this.width === 0 || this.height === 0) {
      this.width = 1600;
      this.height = 1200;
    }
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.viewportWidth * this.pixelRatio);
    this.canvas.height = Math.round(this.viewportHeight * this.pixelRatio);
    
    this.baseScale = Math.min(this.viewportWidth / this.width, this.viewportHeight / this.height) || 1;
    this.baseOffsetX = (this.viewportWidth - this.width * this.baseScale) / 2;
    this.baseOffsetY = (this.viewportHeight - this.height * this.baseScale) / 2;

    this.viewScale = this.baseScale * this.userZoom;
    this.viewOffsetX = this.baseOffsetX + this.panX;
    this.viewOffsetY = this.baseOffsetY + this.panY;
    
    this.context?.setTransform(
      this.pixelRatio * this.viewScale, 0, 0,
      this.pixelRatio * this.viewScale,
      this.pixelRatio * this.viewOffsetX,
      this.pixelRatio * this.viewOffsetY,
    );
  }

  regeneratePieces() {
    this.pieces = generatePuzzlePieces(this.image, this.width, this.height);
    this.drawOrder = Object.keys(this.pieces);
    this.paths = new Map(Object.values(this.pieces).map((piece) => [piece.id, this.createPath(piece)]));
    this.dragState = null;
  }

  installPieces(pieces) {
    this.pieces = pieces;
    this.drawOrder = Object.keys(pieces);
    this.paths = new Map(Object.values(pieces).map((piece) => [piece.id, this.createPath(piece)]));
  }

  syncPieceState(pieces) {
    for (const [pieceId, update] of Object.entries(pieces)) {
      const piece = this.pieces[pieceId];
      if (!piece || this.dragState?.pieceIds.includes(pieceId)) continue;
      piece.x = update.x;
      piece.y = update.y;
      piece.groupId = update.groupId;
      piece.isLockedInFrame = update.isLockedInFrame;
      piece.placedBy = update.placedBy;
    }
  }

  publishInitialPieces() {
    if (!this.socket.connected || this.initialPiecesSent || this.drawOrder.length === 0) return;
    this.initialPiecesSent = true;
    this.socket.emit('initialize_pieces', {
      pieces: Object.values(this.pieces),
      boardWidth: this.width,
      boardHeight: this.height,
    });
  }

  createPath(piece) {
    const path = new Path2D();

    for (const segment of piece.shapeData.path) {
      if (segment.command === 'moveTo') path.moveTo(segment.x, segment.y);
      if (segment.command === 'lineTo') path.lineTo(segment.x, segment.y);
      if (segment.command === 'bezierCurveTo') {
        path.bezierCurveTo(
          segment.control1X,
          segment.control1Y,
          segment.control2X,
          segment.control2Y,
          segment.x,
          segment.y,
        );
      }
      if (segment.command === 'closePath') path.closePath();
    }

    return path;
  }

  addInputListeners() {
    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseup', this.handleMouseUp);
    this.canvas.addEventListener('touchstart', this.handleTouchStart, { passive: false });
    window.addEventListener('touchmove', this.handleTouchMove, { passive: false });
    window.addEventListener('touchend', this.handleTouchEnd, { passive: false });
    window.addEventListener('touchcancel', this.handleTouchEnd, { passive: false });
    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
  }

  removeInputListeners() {
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mouseup', this.handleMouseUp);
    this.canvas.removeEventListener('touchstart', this.handleTouchStart);
    window.removeEventListener('touchmove', this.handleTouchMove);
    window.removeEventListener('touchend', this.handleTouchEnd);
    window.removeEventListener('touchcancel', this.handleTouchEnd);
    this.canvas.removeEventListener('wheel', this.handleWheel);
  }

  eventPoint(event) {
    const pointer = event.changedTouches?.[0] ?? event.touches?.[0] ?? event;
    const bounds = this.canvas.getBoundingClientRect();
    const canvasX = ((pointer.clientX - bounds.left) / bounds.width) * this.viewportWidth;
    const canvasY = ((pointer.clientY - bounds.top) / bounds.height) * this.viewportHeight;

    return {
      x: (canvasX - this.viewOffsetX) / this.viewScale,
      y: (canvasY - this.viewOffsetY) / this.viewScale,
    };
  }

  beginDrag(event) {
    if (event.button !== undefined && event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
    const point = this.eventPoint(event);
    this.context.save();
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    const pieceId = [...this.drawOrder].reverse().find((id) => {
      const piece = this.pieces[id];
      return this.context.isPointInPath(this.paths.get(id), point.x - piece.x, point.y - piece.y);
    });
    this.context.restore();

    // Safely define the selected piece first
    const selectedPiece = pieceId ? this.pieces[pieceId] : null;

    // FIX: If empty space, middle click, OR a completed locked piece is clicked, PAN the camera
    if (!selectedPiece || selectedPiece.isLockedInFrame || event.button === 1) {
      const rawPointer = event.changedTouches?.[0] ?? event.touches?.[0] ?? event;
      this.dragState = {
        isPanning: true,
        lastRawX: rawPointer.clientX,
        lastRawY: rawPointer.clientY
      };
      this.canvas.classList.add('is-panning');
      return;
    }
    const draggedIds = Object.values(this.pieces)
      .filter((piece) => selectedPiece.groupId ? piece.groupId === selectedPiece.groupId : piece.id === pieceId)
      .map((piece) => piece.id);

    this.dragState = {
      anchorId: pieceId,
      pieceIds: draggedIds,
      lastX: point.x,
      lastY: point.y,
    };
    this.bringToFront(new Set(draggedIds));
    this.canvas.classList.add('is-dragging');
  }

  moveDrag(event) {
    if (!this.dragState) return;
    
    // Handle Camera Panning
    if (this.dragState.isPanning) {
      const rawPointer = event.changedTouches?.[0] ?? event.touches?.[0] ?? event;
      const deltaX = rawPointer.clientX - this.dragState.lastRawX;
      const deltaY = rawPointer.clientY - this.dragState.lastRawY;
      
      const bounds = this.canvas.getBoundingClientRect();
      const scaleX = this.viewportWidth / bounds.width;
      const scaleY = this.viewportHeight / bounds.height;

      this.panX += deltaX * scaleX;
      this.panY += deltaY * scaleY;
      
      this.dragState.lastRawX = rawPointer.clientX;
      this.dragState.lastRawY = rawPointer.clientY;
      
      this.viewOffsetX = this.baseOffsetX + this.panX;
      this.viewOffsetY = this.baseOffsetY + this.panY;
      
      this.context?.setTransform(
        this.pixelRatio * this.viewScale, 0, 0,
        this.pixelRatio * this.viewScale,
        this.pixelRatio * this.viewOffsetX,
        this.pixelRatio * this.viewOffsetY,
      );
      return;
    }

    // Handle Piece Dragging
    const point = this.eventPoint(event);
    const deltaX = point.x - this.dragState.lastX;
    const deltaY = point.y - this.dragState.lastY;

    for (const pieceId of this.dragState.pieceIds) {
      this.pieces[pieceId].x += deltaX;
      this.pieces[pieceId].y += deltaY;
    }

    this.dragState.lastX = point.x;
    this.dragState.lastY = point.y;
    this.emitMovement();
  }

  endDrag() {
    if (!this.dragState) return;
    
    if (this.dragState.isPanning) {
      this.dragState = null;
      this.canvas.classList.remove('is-panning');
      return;
    }

    const movingIds = new Set(this.dragState.pieceIds);
    const connected = this.snapDraggedGroup();
    if (!connected && this.isNearWrongPiece(movingIds)) {
      this.socket.emit('wrong_placement', { playerId: this.playerId });
    }
    
    this.emitMovement(true);
    this.dragState = null;
    this.canvas.classList.remove('is-dragging');
  }

  snapDraggedGroup() {
    const movingIds = new Set(this.dragState.pieceIds);
    const anchor = this.pieces[this.dragState.anchorId];
    const { gridRow, gridColumn, cellWidth, cellHeight, boardWidth, boardHeight } = anchor.shapeData;
    const frameX = (this.width - boardWidth) / 2;
    const frameY = (this.height - boardHeight) / 2;
    const frameDeltaX = frameX + gridColumn * cellWidth - anchor.x;
    const frameDeltaY = frameY + gridRow * cellHeight - anchor.y;
    const threshold = Math.min(
      Math.min(cellWidth, cellHeight) * 0.28,
      16 / Math.max(this.viewScale, 0.01),
    );

    if (Math.hypot(frameDeltaX, frameDeltaY) <= threshold) {
      for (const pieceId of movingIds) {
        const piece = this.pieces[pieceId];
        piece.x += frameDeltaX;
        piece.y += frameDeltaY;
        piece.isLockedInFrame = true;
      }
      this.emitPieceConnected(movingIds);
      this.onPieceSnap(); // <-- ADD THIS
      return true;
    }

    let closest = null;

    for (const movingId of movingIds) {
      const movingPiece = this.pieces[movingId];
      const { gridRow, gridColumn, cellWidth, cellHeight } = movingPiece.shapeData;

      for (const targetPiece of Object.values(this.pieces)) {
        if (movingIds.has(targetPiece.id)) continue;
        const rowDistance = targetPiece.shapeData.gridRow - gridRow;
        const columnDistance = targetPiece.shapeData.gridColumn - gridColumn;
        if (Math.abs(rowDistance) + Math.abs(columnDistance) !== 1) continue;

        const deltaX = targetPiece.x - movingPiece.x - columnDistance * cellWidth;
        const deltaY = targetPiece.y - movingPiece.y - rowDistance * cellHeight;
        const distance = Math.hypot(deltaX, deltaY);
        if (distance <= threshold && (!closest || distance < closest.distance)) {
          closest = { movingPiece, targetPiece, deltaX, deltaY, distance };
        }
      }
    }

    if (!closest) return false;

    for (const pieceId of movingIds) {
      this.pieces[pieceId].x += closest.deltaX;
      this.pieces[pieceId].y += closest.deltaY;
    }

    const targetGroupIds = Object.values(this.pieces)
      .filter((piece) => piece.id === closest.targetPiece.id
        || (closest.targetPiece.groupId && piece.groupId === closest.targetPiece.groupId))
      .map((piece) => piece.id);
    const groupId = this.pieces[[...movingIds][0]].groupId
      || closest.targetPiece.groupId
      || `group-${this.playerId}-${++this.groupSequence}`;
    const targetIsLocked = targetGroupIds.some((pieceId) => this.pieces[pieceId].isLockedInFrame);

    for (const pieceId of [...movingIds, ...targetGroupIds]) {
      this.pieces[pieceId].groupId = groupId;
      if (movingIds.has(pieceId)) this.pieces[pieceId].isLockedInFrame = targetIsLocked;
    }

    this.bringToFront(new Set([...movingIds, ...targetGroupIds]));
    this.emitPieceConnected(new Set([...movingIds, ...targetGroupIds]));
    this.onPieceSnap(); // <-- ADD THIS
    return true;
  }

  isNearWrongPiece(movingIds) {
    for (const movingId of movingIds) {
      const movingPiece = this.pieces[movingId];
      const { cellWidth, cellHeight, gridRow: mRow, gridColumn: mCol } = movingPiece.shapeData;
      
      // TIGHTENED RADIUS: Caps the penalty zone to a strict 25 pixels (scaling with zoom).
      // This allows players to safely sweep pieces into piles without losing their streak.
      const guessRadius = Math.min(Math.min(cellWidth, cellHeight) * 0.2, 25 / Math.max(this.viewScale, 0.01));

      for (const targetPiece of Object.values(this.pieces)) {
        if (movingIds.has(targetPiece.id)) continue;

        const physicalDeltaX = targetPiece.x - movingPiece.x;
        const physicalDeltaY = targetPiece.y - movingPiece.y;

        const distancesToSockets = [
          Math.hypot(physicalDeltaX, physicalDeltaY - cellHeight), 
          Math.hypot(physicalDeltaX - cellWidth, physicalDeltaY),  
          Math.hypot(physicalDeltaX, physicalDeltaY + cellHeight), 
          Math.hypot(physicalDeltaX + cellWidth, physicalDeltaY),  
          Math.hypot(physicalDeltaX, physicalDeltaY)               
        ];

        // Did the user drop it EXTREMELY close to a connection socket?
        if (distancesToSockets.some(dist => dist < guessRadius)) {
           const { gridRow: tRow, gridColumn: tCol } = targetPiece.shapeData;
           
           const isNeighbor = Math.abs(tRow - mRow) + Math.abs(tCol - mCol) === 1;
           
           if (!isNeighbor) {
              return true; 
           }
        }
      }
    }
    return false;
  }

  emitMovement(force = false) {
    if (!this.socket.connected || !this.dragState) return;
    const now = performance.now();
    if (!force && now - this.lastMovementSentAt < 50) return;

    this.lastMovementSentAt = now;
    this.socket.emit('piece_moved', {
      pieces: this.dragState.pieceIds.map((pieceId) => {
        const { id, x, y } = this.pieces[pieceId];
        return { id, x, y };
      }),
    });
  }

  emitPieceConnected(pieceIds) {
    if (!this.socket.connected) return;
    this.socket.emit('piece_connected', {
      pieces: [...pieceIds].map((pieceId) => {
        const { id, x, y, groupId, isLockedInFrame } = this.pieces[pieceId];
        return { id, x, y, groupId, isLockedInFrame };
      }),
    });
  }

  bringToFront(pieceIds) {
    this.drawOrder = this.drawOrder.filter((pieceId) => !pieceIds.has(pieceId));
    this.drawOrder.push(...pieceIds);
  }

  renderFrame() {
    if (this.destroyed) return;

    const context = this.context;
    context.clearRect(
      -this.viewOffsetX / this.viewScale,
      -this.viewOffsetY / this.viewScale,
      this.viewportWidth / this.viewScale,
      this.viewportHeight / this.viewScale,
    );

    for (const pieceId of this.drawOrder) {
      const piece = this.pieces[pieceId];
      const { path, sourceX, sourceY, boardWidth, boardHeight } = piece.shapeData;
      const piecePath = this.paths.get(pieceId);
      context.save();
      context.translate(piece.x, piece.y);
      context.clip(piecePath);
      context.drawImage(this.image, -sourceX, -sourceY, boardWidth, boardHeight);
      context.strokeStyle = 'rgba(26, 35, 58, 0.62)';
      context.lineWidth = 1.5;
      context.stroke(piecePath);
      context.restore();
    }

    if (this.guideHighlight) {
      const elapsed = performance.now() - this.guideHighlight.startedAt;

      if (elapsed >= this.guideHighlight.durationMs) {
        this.guideHighlight = null;
      } else {
        const pulse = (Math.sin(elapsed / 220) + 1) / 2;
        
        for (const pieceId of this.guideHighlight.pieceIds) {
          const guidePath = this.paths.get(pieceId);
          const piece = this.pieces[pieceId];
          if (!guidePath || !piece) continue;

          context.save();
          context.translate(piece.x, piece.y); // Highlights current position!
          context.globalAlpha = 0.4 + pulse * 0.45;
          context.shadowColor = 'rgba(74, 222, 128, 0.95)';
          context.shadowBlur = 12 + pulse * 18;
          context.fillStyle = 'rgba(74, 222, 128, 0.2)';
          context.fill(guidePath);
          context.strokeStyle = 'rgba(74, 222, 128, 0.95)';
          context.lineWidth = 3;
          context.stroke(guidePath);
          context.restore();
        }
      }
    }

    this.frameId = requestAnimationFrame(this.renderFrame);
  }

  destroy() {
    this.destroyed = true;
    this.removeInputListeners();
    this.socket.off('connect', this.handleSocketConnect);
    this.socket.off('disconnect', this.handleSocketDisconnect);
    this.socket.off('force_reset', this.handleForceReset);
    this.socket.off('game_state', this.handleGameState);
    this.socket.off('piece_moved', this.handleRemoteMovement);
    this.socket.off('focus_cracker', this.handleFocusCracker);
    this.socket.off('guide_piece_highlight', this.handleGuidePieceHighlight);
    clearTimeout(this.focusTimeout);
    this.canvas.parentElement?.classList.remove('effect-focus-cracker');
    window.removeEventListener('resize', this.resize);
    this.resizeObserver?.disconnect();
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
  }
}