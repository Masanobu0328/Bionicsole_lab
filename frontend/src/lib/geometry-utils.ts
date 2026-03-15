export function generateFootOutline(lengthMm: number): { x: number; y: number }[] {
    // Legacy fallback
    const width = lengthMm * 0.35; 
    const normalizedPoints = [
        { x: 0, y: 0 }, { x: 0.25, y: 0.1 }, { x: 0.35, y: 0.4 }, 
        { x: 0.45, y: 0.9 }, { x: 0.2, y: 1.0 }, { x: -0.1, y: 0.95 },
        { x: -0.25, y: 0.7 }, { x: -0.3, y: 0.4 }, { x: -0.25, y: 0.1 },
    ];
    return normalizedPoints.map(p => ({
        x: p.x * width + 100, 
        y: p.y * lengthMm + 50 
    }));
}

// Distance between two points
function dist(p1: {x: number, y: number}, p2: {x: number, y: number}) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

// Perpendicular distance from point p to line segment (a, b)
function perpendicularDist(p: {x: number, y: number}, a: {x: number, y: number}, b: {x: number, y: number}): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) return dist(p, a);
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
    const cx = a.x + t * dx;
    const cy = a.y + t * dy;
    return Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
}

// Ramer-Douglas-Peucker simplification on an open segment [start..end]
function rdpSegment(points: {x: number, y: number}[], start: number, end: number, epsilon: number, keep: boolean[]): void {
    if (end <= start + 1) return;
    let maxDist = 0;
    let maxIdx = start;
    for (let i = start + 1; i < end; i++) {
        const d = perpendicularDist(points[i], points[start], points[end]);
        if (d > maxDist) { maxDist = d; maxIdx = i; }
    }
    if (maxDist > epsilon) {
        keep[maxIdx] = true;
        rdpSegment(points, start, maxIdx, epsilon, keep);
        rdpSegment(points, maxIdx, end, epsilon, keep);
    }
}

/**
 * Simplify a closed polygon using Ramer-Douglas-Peucker.
 * epsilon is the max allowed deviation in the same units as the points (mm).
 */
export function rdpSimplify(points: {x: number, y: number}[], epsilon: number): {x: number, y: number}[] {
    const n = points.length;
    if (n <= 3) return [...points];

    // Find the two points farthest apart — they become anchors for two open chains
    let maxDist = 0;
    let splitA = 0, splitB = Math.floor(n / 2);
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const d = dist(points[i], points[j]);
            if (d > maxDist) { maxDist = d; splitA = i; splitB = j; }
        }
    }

    // Reorder so splitA is at index 0
    const reordered = [...points.slice(splitA), ...points.slice(0, splitA)];
    const pivot = (splitB - splitA + n) % n;

    const keep = new Array(n).fill(false);
    keep[0] = true;
    keep[pivot] = true;

    // Chain 1: indices 0 .. pivot (valid range, no out-of-bounds)
    rdpSegment(reordered, 0, pivot, epsilon, keep);

    // Chain 2: indices pivot .. n-1, closing back to index 0
    // Build a temp array [pivot, pivot+1, ..., n-1, 0] so rdpSegment indices are safe
    const chain2 = [...reordered.slice(pivot), reordered[0]];
    const keep2 = new Array(chain2.length).fill(false);
    keep2[0] = true;
    keep2[chain2.length - 1] = true;
    rdpSegment(chain2, 0, chain2.length - 1, epsilon, keep2);
    // Map keep2 results back (skip first and last which are already in keep)
    for (let i = 1; i < chain2.length - 1; i++) {
        if (keep2[i]) keep[pivot + i] = true;
    }

    const simplified = reordered.filter((_, i) => keep[i]);
    return simplified.length >= 3 ? simplified : reordered.slice(0, 3);
}

/**
 * Simplify outline to approximately targetCount points.
 * Binary-searches epsilon to hit the target.
 */
export function simplifyToCount(points: {x: number, y: number}[], targetCount: number): {x: number, y: number}[] {
    if (points.length <= targetCount) return [...points];
    let lo = 0, hi = 100;
    let best = points;
    for (let iter = 0; iter < 20; iter++) {
        const mid = (lo + hi) / 2;
        const simplified = rdpSimplify(points, mid);
        if (simplified.length > targetCount) {
            lo = mid;
        } else {
            best = simplified;
            hi = mid;
        }
        if (Math.abs(simplified.length - targetCount) <= 2) break;
    }
    return best;
}

// Resample a polygon to have exactly n equidistant vertices
export function resamplePolygon(points: { x: number; y: number }[], targetCount: number): { x: number; y: number }[] {
    if (points.length < 2) return points;

    // 1. Calculate total perimeter
    let totalLength = 0;
    for (let i = 0; i < points.length; i++) {
        totalLength += dist(points[i], points[(i + 1) % points.length]);
    }

    const step = totalLength / targetCount;
    const newPoints: { x: number; y: number }[] = [];
    
    let currentDist = 0;
    let nextDist = step;
    let segmentIdx = 0;
    
    // Start with the first point (usually heel in our CSV)
    newPoints.push({ ...points[0] });

    // Walk the perimeter
    // Note: We need to handle the loop (closing the polygon)
    const closedPoints = [...points, points[0]];

    let accumulatedDist = 0;
    
    for (let i = 0; i < closedPoints.length - 1; i++) {
        const p1 = closedPoints[i];
        const p2 = closedPoints[i+1];
        const segmentLen = dist(p1, p2);
        
        while (accumulatedDist + segmentLen > nextDist) {
            // The next target point is on this segment
            const remaining = nextDist - accumulatedDist;
            const ratio = remaining / segmentLen;
            const nx = p1.x + (p2.x - p1.x) * ratio;
            const ny = p1.y + (p2.y - p1.y) * ratio;
            
            if (newPoints.length < targetCount) {
                newPoints.push({ x: nx, y: ny });
            }
            nextDist += step;
        }
        accumulatedDist += segmentLen;
    }

    // Ensure we have exactly targetCount (sometimes float errors result in +/- 1)
    while (newPoints.length < targetCount) {
        // Just duplicate last or append midway? 
        // Better to just push the last valid point found or interp end
        newPoints.push(points[points.length - 1]); 
    }
    
    return newPoints.slice(0, targetCount);
}

// Densify an open curve using Catmull-Rom spline interpolation
// Endpoints are duplicated as phantom points for proper tangent calculation
export function densifyOpenCurve(points: { x: number; y: number }[], subdivisions: number = 8): { x: number; y: number }[] {
    if (points.length < 2) return points;
    const extended = [points[0], ...points, points[points.length - 1]];
    const result: { x: number; y: number }[] = [];

    for (let i = 1; i < extended.length - 2; i++) {
        const p0 = extended[i - 1];
        const p1 = extended[i];
        const p2 = extended[i + 1];
        const p3 = extended[i + 2];

        for (let j = 0; j < subdivisions; j++) {
            const t = j / subdivisions;
            const t2 = t * t;
            const t3 = t2 * t;
            const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
            const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
            result.push({ x, y });
        }
    }
    // Add the final endpoint
    result.push(points[points.length - 1]);
    return result;
}

// Densify a closed polygon using Catmull-Rom spline interpolation
// Converts N control points into N*subdivisions smooth polygon points
export function densifyClosedPolygon(points: { x: number; y: number }[], subdivisions: number = 8): { x: number; y: number }[] {
    if (points.length < 3) return points;
    const n = points.length;
    const result: { x: number; y: number }[] = [];

    for (let i = 0; i < n; i++) {
        const p0 = points[(i - 1 + n) % n];
        const p1 = points[i];
        const p2 = points[(i + 1) % n];
        const p3 = points[(i + 2) % n];

        for (let j = 0; j < subdivisions; j++) {
            const t = j / subdivisions;
            const t2 = t * t;
            const t3 = t2 * t;
            // Catmull-Rom spline formula
            const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
            const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
            result.push({ x, y });
        }
    }
    return result;
}

// Generate a smooth SVG path from points (Catmull-Rom to Bezier)
export function getSmoothPath(points: { x: number; y: number }[], close: boolean = true): string {
    if (points.length < 2) return "";
    
    const getPt = (i: number) => {
        if (close) {
            return points[(i + points.length) % points.length];
        } else {
            return points[Math.max(0, Math.min(points.length - 1, i))];
        }
    };
    
    let d = `M ${points[0].x} ${points[0].y}`;
    const len = close ? points.length : points.length - 1;
    
    for (let i = 0; i < len; i++) {
        const p0 = getPt(i - 1);
        const p1 = getPt(i);
        const p2 = getPt(i + 1);
        const p3 = getPt(i + 2);

        // Catmull-Rom to Cubic Bezier conversion matrix constants
        // CP1 = P1 + (P2 - P0) / 6
        // CP2 = P2 - (P3 - P1) / 6
        
        const cp1x = p1.x + (p2.x - p0.x) / 6;
        const cp1y = p1.y + (p2.y - p0.y) / 6;

        const cp2x = p2.x - (p3.x - p1.x) / 6;
        const cp2y = p2.y - (p3.y - p1.y) / 6;

        d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }

    if (close) d += " Z";
    return d;
}

export function parseOutlineCsv(csvContent: string, targetLengthMm?: number, resampleCount: number = 0): { x: number; y: number }[] {
    const lines = csvContent.trim().split('\n');
    const points: { x: number; y: number }[] = [];
    
    // Skip header if exists
    const startIdx = lines[0].includes('x_mm') ? 1 : 0;
    
    let minX = Infinity, maxX = -Infinity;

    for (let i = startIdx; i < lines.length; i++) {
        const parts = lines[i].split(',');
        if (parts.length >= 2) {
            const x = parseFloat(parts[0]);
            const y = parseFloat(parts[1]);
            if (!isNaN(x) && !isNaN(y)) {
                points.push({ x, y });
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
            }
        }
    }

    if (points.length === 0) return [];

    let resultPoints = points;

    // Scale logic
    if (targetLengthMm) {
        const currentLength = maxX - minX;
        const scale = targetLengthMm / currentLength;
        
        resultPoints = resultPoints.map(p => ({
            x: p.x * scale,
            y: p.y * scale
        }));
    }
    
    // Resample logic
    if (resampleCount > 0) {
        resultPoints = resamplePolygon(resultPoints, resampleCount);
    }

    return resultPoints;
}

// Helper to get bounding box of outline
export function getBounds(points: {x: number, y: number}[]) {
    if (points.length === 0) return { minX: 0, maxX: 100, minY: 0, maxY: 100, width: 100, height: 100 };
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * Compute bottom outline by offsetting the medial side inward in the arch region.
 * Mirrors the Python _compute_auto_bottom_outline() logic.
 */
export function computeAutoBottomOutline(
    outlinePoints: { x: number; y: number }[],
    archSettings: { medial_start: number; medial_end: number; medial_peak: number },
    offsetMm: number = 5.0
): { x: number; y: number }[] {
    if (outlinePoints.length < 3) return [...outlinePoints];

    const bounds = getBounds(outlinePoints);
    const footLength = bounds.maxX - bounds.minX;
    if (footLength <= 0) return outlinePoints.map(p => ({ ...p }));

    const { medial_start, medial_end, medial_peak } = archSettings;

    // Build Y bounds lookup (sample at many X positions)
    const nSamples = 200;
    const yMaxAtX: number[] = [];
    const sampleXs: number[] = [];
    for (let s = 0; s < nSamples; s++) {
        const sx = bounds.minX + (footLength * s) / (nSamples - 1);
        sampleXs.push(sx);
        const yBounds = getOutlineYAtX(outlinePoints, sx);
        yMaxAtX.push(yBounds ? yBounds.max : bounds.maxY);
    }

    // Helper to get interpolated yMax at any x
    const getYMax = (x: number): number => {
        const idx = ((x - bounds.minX) / footLength) * (nSamples - 1);
        const i0 = Math.max(0, Math.min(nSamples - 2, Math.floor(idx)));
        const t = idx - i0;
        return yMaxAtX[i0] * (1 - t) + yMaxAtX[i0 + 1] * t;
    };

    return outlinePoints.map(p => {
        const xRatio = ((p.x - bounds.minX) / footLength) * 100;

        if (xRatio < medial_start || xRatio > medial_end) {
            return { ...p };
        }

        const yMaxHere = getYMax(p.x);
        const yBounds = getOutlineYAtX(outlinePoints, p.x);
        const widthHere = yBounds ? (yBounds.max - yBounds.min) : (bounds.maxY - bounds.minY);
        if (widthHere <= 0) return { ...p };

        const medialThreshold = yMaxHere - widthHere * 0.2;
        if (p.y < medialThreshold) return { ...p };

        // Smoothstep blend
        let t: number;
        if (xRatio <= medial_peak) {
            t = (xRatio - medial_start) / Math.max(medial_peak - medial_start, 0.01);
        } else {
            t = (medial_end - xRatio) / Math.max(medial_end - medial_peak, 0.01);
        }
        t = Math.max(0, Math.min(1, t));
        const blend = t * t * (3 - 2 * t);

        return { x: p.x, y: p.y - offsetMm * blend };
    });
}

// Helper to get Y intersection bounds of polygon at X
export function getOutlineYAtX(points: {x: number, y: number}[], targetX: number) {
    let intersections: number[] = [];
    for (let i = 0; i < points.length; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];
        if ((p1.x <= targetX && p2.x > targetX) || (p2.x <= targetX && p1.x > targetX)) {
            const t = (targetX - p1.x) / (p2.x - p1.x);
            const y = p1.y + t * (p2.y - p1.y);
            intersections.push(y);
        }
    }
    if (intersections.length < 2) return null;
    return { min: Math.min(...intersections), max: Math.max(...intersections) };
}
