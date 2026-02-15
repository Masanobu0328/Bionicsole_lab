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
