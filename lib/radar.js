/**
 * Airvee — Canvas Radar Scope
 * Cockpit Minimal Design Language
 * - Rotating sweep beam with Signal Orange (#FF5A1F) trail
 * - Polar-to-cartesian coordinate mapping
 * - Concentric range rings with North indicator and scope radius label
 * - User facing vision cone (oriented to user facing angle, e.g. South 180°)
 * - Inbound aircraft: pulsing orange ring, dotted trajectory line, white callsign label
 * - Traffic aircraft: white points
 * - Center observer white dot
 * - 100% Canvas API, zero external dependencies, robust lifecycle handling
 */

import { classifyPass } from './geo.js';

export class RadarScope {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.options = {
      maxRadiusKm: 15,
      overheadThresholdKm: 5,
      minElevationDeg: 15,
      userFacing: '',
      orientation: 'facing_up', // 'facing_up' (relative to user view) or 'north_up'
      units: 'km',
      onSelectFlight: null,
      ...options
    };

    this.flights = [];
    this.trails = new Map();
    this.selectedFlightId = null;
    this.hoveredFlightId = null;
    this.sweepAngle = 0;
    this.lastRenderTime = performance.now();
    this.animationFrameId = null;

    this._setupCanvas();
    this._bindEvents();
    this.start();
  }

  _setupCanvas() {
    const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    let width = 340;
    let height = 340;

    if (this.canvas && typeof this.canvas.getBoundingClientRect === 'function') {
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width > 0) width = rect.width;
      if (rect.height > 0) height = rect.height;
    }

    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);

    // Use setTransform to avoid cumulative scale bugs on repeated setup calls
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.centerX = width / 2;
    this.centerY = height / 2;
    this.scopeRadius = (Math.min(width, height) / 2) - 16;
  }

  _bindEvents() {
    if (!this.canvas) return;
    this.canvas.addEventListener('mousemove', (e) => this._handlePointerMove(e));
    this.canvas.addEventListener('mouseleave', () => {
      this.hoveredFlightId = null;
      this.canvas.style.cursor = 'default';
    });
    this.canvas.addEventListener('click', (e) => this._handlePointerClick(e));
  }

  setFlights(flights) {
    this.flights = flights || [];
    this._updateTrails();
  }

  setOptions(newOpts) {
    this.options = { ...this.options, ...newOpts };
  }

  setSelectedFlight(id) {
    this.selectedFlightId = id;
  }

  _updateTrails() {
    const now = Date.now();
    const activeIds = new Set();

    for (const f of this.flights) {
      activeIds.add(f.id);
      const pos = this._projectFlightToCanvas(f);
      if (!pos) continue;

      if (!this.trails.has(f.id)) {
        this.trails.set(f.id, []);
      }
      const flightTrail = this.trails.get(f.id);

      const lastPoint = flightTrail[flightTrail.length - 1];
      if (!lastPoint || Math.hypot(pos.x - lastPoint.x, pos.y - lastPoint.y) > 2) {
        flightTrail.push({ x: pos.x, y: pos.y, time: now });
        if (flightTrail.length > 8) flightTrail.shift();
      }
    }

    for (const id of this.trails.keys()) {
      if (!activeIds.has(id)) this.trails.delete(id);
    }
  }

  _getFacingDeg() {
    const facing = this.options.userFacing;
    if (!facing) return null;
    if (typeof facing === 'number') return facing;
    const dirs = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
    return dirs[facing] != null ? dirs[facing] : null;
  }

  _getRotationOffsetDeg() {
    if (!this.options.userFacing) {
      return 0; // north_up: North is at 0° (top) when userFacing is not set
    }
    if (this.options.orientation === 'facing_up') {
      const facingDeg = this._getFacingDeg();
      return facingDeg != null ? facingDeg : 0;
    }
    return 0; // north_up: North is at 0° (top)
  }

  _projectFlightToCanvas(flight) {
    const distKm = flight.distance != null ? flight.distance : 0;
    const bearingDeg = flight.currentBearing != null
      ? flight.currentBearing
      : (flight.bearingAtCpa != null ? flight.bearingAtCpa : 0);

    const maxR = Math.max(1, this.options.maxRadiusKm);
    const normalizedDist = Math.min(1.05, distKm / maxR);
    const pixelDist = normalizedDist * this.scopeRadius;

    // Apply orientation rotation (facing_up rotates so facing direction is at 12 o'clock)
    const rotOffset = this._getRotationOffsetDeg();
    const effectiveBearing = (bearingDeg - rotOffset + 360) % 360;

    // Convert bearing to math angle: 0° is Top (-Y), 90° Right (+X)
    const bearingRad = (effectiveBearing * Math.PI) / 180;
    const x = this.centerX + pixelDist * Math.sin(bearingRad);
    const y = this.centerY - pixelDist * Math.cos(bearingRad);

    return { x, y, distKm, bearingDeg, effectiveBearing, rotOffset, outOfScope: distKm > maxR * 1.05 };
  }

  _handlePointerMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const hit = this._hitTest(px, py);
    if (hit) {
      this.hoveredFlightId = hit.id;
      this.canvas.style.cursor = 'pointer';
    } else {
      this.hoveredFlightId = null;
      this.canvas.style.cursor = 'default';
    }
  }

  _handlePointerClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const hit = this._hitTest(px, py);
    if (hit) {
      this.selectedFlightId = hit.id;
      if (typeof this.options.onSelectFlight === 'function') {
        this.options.onSelectFlight(hit);
      }
    } else {
      this.selectedFlightId = null;
      if (typeof this.options.onSelectFlight === 'function') {
        this.options.onSelectFlight(null);
      }
    }
  }

  _hitTest(px, py) {
    for (const f of this.flights) {
      const pos = this._projectFlightToCanvas(f);
      if (!pos || pos.outOfScope) continue;
      const dist = Math.hypot(px - pos.x, py - pos.y);
      if (dist <= 16) {
        return f;
      }
    }
    return null;
  }

  start() {
    if (typeof requestAnimationFrame === 'undefined') return;
    if (this.animationFrameId) return;
    const loop = (now) => {
      this._render(now);
      this.animationFrameId = requestAnimationFrame(loop);
    };
    this.animationFrameId = requestAnimationFrame(loop);
  }

  stop() {
    if (typeof cancelAnimationFrame === 'undefined') return;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  _render(timestamp) {
    const ctx = this.ctx;
    const cx = this.centerX;
    const cy = this.centerY;
    const r = this.scopeRadius;

    ctx.clearRect(0, 0, this.width, this.height);

    // Update radar sweep rotation
    const dt = (timestamp - this.lastRenderTime) / 1000;
    this.lastRenderTime = timestamp;
    this.sweepAngle = (this.sweepAngle + dt * 1.5) % (Math.PI * 2);

    // 1. Clip inside scope circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    // Dark radar cockpit gradient (deep pitch black)
    const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    bgGrad.addColorStop(0, '#09090B');
    bgGrad.addColorStop(0.7, '#08080A');
    bgGrad.addColorStop(1, '#050507');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, this.width, this.height);

    // 2. Observer Facing Orientation Vision Cone ("YOU FACE S")
    this._renderFacingCone(ctx, cx, cy, r);

    // 3. Sweeping Beam in Signal Orange
    this._renderSweepBeam(ctx, cx, cy, r);

    // 4. Distance Range Rings
    this._renderRangeRings(ctx, cx, cy, r);

    // 5. Azimuth Radial Axis
    this._renderRadialSpokes(ctx, cx, cy, r);

    // 6. Kinematic Motion Trails
    this._renderTrails(ctx);

    // 7. Aircraft Targets
    this._renderAircraft(ctx);

    // End Clip
    ctx.restore();

    // 8. Scope Bezel & Compass Labels
    this._renderScopeBezel(ctx, cx, cy, r);

    // 9. Observer Center Dot (You Are Here)
    this._renderCenterObserver(ctx, cx, cy);
  }

  _renderFacingCone(ctx, cx, cy, r) {
    if (!this.options.userFacing) return; // Draw no facing wedge when userFacing is ''
    const facingDeg = this._getFacingDeg();
    if (facingDeg === null) return;
    const rotOffset = this._getRotationOffsetDeg();

    // In facing_up, the user's facing direction is at 0° (top: -PI/2).
    // In north_up, facing direction is at (facingDeg * PI / 180 - PI / 2).
    const effectiveFacingDeg = (facingDeg - rotOffset + 360) % 360;
    const centerRad = (effectiveFacingDeg * Math.PI) / 180 - Math.PI / 2;
    const coneHalfWidth = (38 * Math.PI) / 180; // ~76° field of view

    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, centerRad - coneHalfWidth, centerRad + coneHalfWidth);
    ctx.closePath();
    ctx.fill();

    // Subtle edge boundary lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  _renderSweepBeam(ctx, cx, cy, r) {
    ctx.save();
    // Signal Orange sweeping beam with fading trail (~35° arc)
    const trailAngle = (35 * Math.PI) / 180;
    const sweepGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    sweepGrad.addColorStop(0, 'rgba(255, 90, 31, 0.30)');
    sweepGrad.addColorStop(0.65, 'rgba(255, 90, 31, 0.10)');
    sweepGrad.addColorStop(1, 'rgba(255, 90, 31, 0.00)');

    ctx.fillStyle = sweepGrad;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, this.sweepAngle - trailAngle, this.sweepAngle);
    ctx.closePath();
    ctx.fill();

    // Leading crisp orange stroke line
    ctx.strokeStyle = '#FF5A1F';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + r * Math.cos(this.sweepAngle), cy + r * Math.sin(this.sweepAngle));
    ctx.stroke();
    ctx.restore();
  }

  _renderRangeRings(ctx, cx, cy, r) {
    const maxR = this.options.maxRadiusKm || 30;
    const numRings = 3;

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.font = "500 11px 'Martian Mono', 'Geist Mono', 'JetBrains Mono', Consolas, monospace";
    ctx.fillStyle = '#71717A';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 1; i <= numRings; i++) {
      const ringRadius = (r / numRings) * i;

      ctx.beginPath();
      ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Range number label along North spoke (Page 2 screenshot shows "30" at middle/outer ring)
      if (i === 2) {
        ctx.fillText(String(maxR), cx + 18, cy - ringRadius + 14);
      }
    }
    ctx.restore();
  }

  _renderRadialSpokes(ctx, cx, cy, r) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;

    // Primary vertical axis (North - South)
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.stroke();

    // Subtle horizontal axis (West - East)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.stroke();

    ctx.restore();
  }

  _renderTrails(ctx) {
    // Optional past positions fade trail
    ctx.save();
    for (const [id, points] of this.trails.entries()) {
      if (points.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  _renderAircraft(ctx) {
    for (const f of this.flights) {
      const pos = this._projectFlightToCanvas(f);
      if (!pos || pos.outOfScope) continue;

      const isSelected = this.selectedFlightId === f.id;
      const isHovered = this.hoveredFlightId === f.id;
      const passType = f.passClassification || classifyPass(f, {
        overheadThresholdKm: this.options.overheadThresholdKm,
        minElevationDeg: this.options.minElevationDeg
      });
      const isOverhead = passType === 'overhead';

      const heading = Number(f.heading || f.trackDeg || 0);
      const callsign = f.flightNumber || f.callsign || 'FLIGHT';

      ctx.save();

      // For inbound overhead flights, draw dotted trajectory line leading back along heading
      if (isOverhead) {
        const rotOffset = this._getRotationOffsetDeg();
        const effectiveTrack = (heading - rotOffset + 360) % 360;
        const trackRad = (effectiveTrack * Math.PI) / 180;
        ctx.save();
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = 'rgba(255, 90, 31, 0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.lineTo(pos.x - 45 * Math.sin(trackRad), pos.y + 45 * Math.cos(trackRad));
        ctx.stroke();
        ctx.restore();
      }

      // Glowing alert halo only for overhead targets
      if (isOverhead) {
        const isReducedMotion = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const pulse = isReducedMotion ? 0 : Math.sin(Date.now() / 200) * 2.2;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 11 + pulse, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 90, 31, 0.15)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 90, 31, 0.75)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      // Selected focus indicator
      if (isSelected || isHovered) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 10, 0, Math.PI * 2);
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      // Aircraft Point Blip: overhead uses accent orange (#FF5A1F), near flights are neutral white
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, isOverhead ? 4 : 3, 0, Math.PI * 2);
      ctx.fillStyle = isOverhead ? '#FF5A1F' : '#FFFFFF';
      ctx.fill();

      // Callsign text label for overhead or selected target
      if (isOverhead || isSelected || isHovered) {
        ctx.font = "500 12px 'Martian Mono', 'Geist Mono', 'JetBrains Mono', Consolas, monospace";
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(callsign, pos.x + 8, pos.y + 4);
      }

      ctx.restore();
    }
  }

  _renderScopeBezel(ctx, cx, cy, r) {
    ctx.save();
    // Scope outer hairline circle
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const rotOffset = this._getRotationOffsetDeg();
    const cardinals = [
      { label: 'N', deg: 0 },
      { label: 'E', deg: 90 },
      { label: 'S', deg: 180 },
      { label: 'W', deg: 270 }
    ];

    ctx.font = "600 11px 'Martian Mono', 'Geist Mono', 'JetBrains Mono', Consolas, monospace";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const card of cardinals) {
      const effDeg = (card.deg - rotOffset + 360) % 360;
      const rad = (effDeg * Math.PI) / 180 - Math.PI / 2;
      const labelRadius = r - 12;
      const lx = cx + labelRadius * Math.cos(rad);
      const ly = cy + labelRadius * Math.sin(rad);

      const isTopFacing = Math.abs(effDeg) < 1 || Math.abs(effDeg - 360) < 1;
      if (isTopFacing) {
        ctx.fillStyle = '#FF5A1F'; // Signal orange for top facing direction
      } else {
        ctx.fillStyle = '#71717A';
      }
      ctx.fillText(card.label, lx, ly);
    }

    ctx.restore();
  }

  _renderCenterObserver(ctx, cx, cy) {
    ctx.save();
    // Solid white observer center dot
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.restore();
  }
}
