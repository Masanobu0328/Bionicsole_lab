'use client';

import React, { Suspense, useRef, useEffect, useLayoutEffect, useState, useMemo } from 'react';
import { Canvas, useThree, extend } from '@react-three/fiber';
import { Grid, Environment, OrbitControls, shaderMaterial } from '@react-three/drei';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';
import { useStore } from '@/lib/store';

// --- Custom Height Heatmap Shader with Lighting ---
// Maps relative height (Z - BaseThickness) to a highly sensitive 5-color gradient
// Max sensitivity at 5.0mm
// 0.0 - 0.1mm: Blue (Base)
// 0.1 - 1.5mm: Blue -> Cyan (Slight rise)
// 1.5 - 3.0mm: Cyan -> Green (Low Arch)
// 3.0 - 4.5mm: Green -> Yellow (Mid Arch)
// 4.5 - 5.0mm: Yellow -> Red (Max Arch)
// 5.0mm+     : Solid Red
const HeightHeatmapMaterial = shaderMaterial(
    {
        uBaseThickness: 3.0,
        uColorBlue: new THREE.Color('#0000ff'),
        uColorCyan: new THREE.Color('#00ffff'),
        uColorGreen: new THREE.Color('#00ff00'),
        uColorYellow: new THREE.Color('#ffff00'),
        uColorRed: new THREE.Color('#ff0000'),
    },
    // Vertex Shader
    `
    varying float vZ;
    varying vec3 vNormal;
    void main() {
        vZ = position.z; 
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
    `,
    // Fragment Shader
    `
    uniform float uBaseThickness;
    uniform vec3 uColorBlue;
    uniform vec3 uColorCyan;
    uniform vec3 uColorGreen;
    uniform vec3 uColorYellow;
    uniform vec3 uColorRed;
    
    varying float vZ;
    varying vec3 vNormal;

    void main() {
        float h = vZ - uBaseThickness;
        vec3 baseColor;
        
        // Non-linear mapping to emphasize low height changes
        if (h <= 0.1) {
            baseColor = uColorBlue;
        } else if (h < 1.5) {
            // 0.1mm - 1.5mm: Blue -> Cyan
            float t = (h - 0.1) / (1.5 - 0.1);
            baseColor = mix(uColorBlue, uColorCyan, t);
        } else if (h < 3.0) {
            // 1.5mm - 3.0mm: Cyan -> Green
            float t = (h - 1.5) / (3.0 - 1.5);
            baseColor = mix(uColorCyan, uColorGreen, t);
        } else if (h < 4.5) {
            // 3.0mm - 4.5mm: Green -> Yellow
            float t = (h - 3.0) / (4.5 - 3.0);
            baseColor = mix(uColorGreen, uColorYellow, t);
        } else if (h < 5.0) {
            // 4.5mm - 5.0mm: Yellow -> Red
            float t = (h - 4.5) / (5.0 - 4.5);
            baseColor = mix(uColorYellow, uColorRed, t);
        } else {
            // 5.0mm+: Solid Red
            baseColor = uColorRed;
        }
        
        // Lighting
        vec3 lightDir = normalize(vec3(1.0, 1.0, 1.0)); 
        float diff = max(dot(vNormal, lightDir), 0.0);
        vec3 lighting = vec3(0.6) + vec3(0.4) * diff;
        
        gl_FragColor = vec4(baseColor * lighting, 1.0);
    }
    `
);

extend({ HeightHeatmapMaterial });

// Add type definition for the custom material
declare global {
    namespace JSX {
        interface IntrinsicElements {
            heightHeatmapMaterial: any;
        }
    }
}

type ModelBounds = {
    center: THREE.Vector3;
    radius: number;
};

function InsoleModel({
    url,
    baseThickness,
    onDimensionsCalculated,
    onBoundsCalculated,
}: {
    url: string | null;
    baseThickness: number;
    onDimensionsCalculated: (dim: THREE.Vector3) => void;
    onBoundsCalculated: (bounds: ModelBounds) => void;
}) {
    const meshRef = useRef<THREE.Mesh>(null);
    const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);

    useEffect(() => {
        if (!url) {
            setGeometry(null);
            return;
        }

        let cancelled = false;
        console.log("Loading 3D Model from:", url);
        const isGLB = url.toLowerCase().split('?')[0].endsWith('.glb');

        const handleGeometry = (geo: THREE.BufferGeometry) => {
            if (cancelled) return;

            // FIX: Do NOT use geo.center() as it centers Z axis too, breaking height map calculations.
            // We want X and Y centered, but Z to start at 0 (bottom aligned to floor).
            geo.computeBoundingBox();
            if (geo.boundingBox) {
                const center = new THREE.Vector3();
                geo.boundingBox.getCenter(center);
                const minZ = geo.boundingBox.min.z;

                // Translate: Center X/Y, Align Bottom Z to 0
                geo.translate(-center.x, -center.y, -minZ);

                // Recompute after translation
                geo.computeBoundingBox();
                const size = new THREE.Vector3();
                geo.boundingBox.getSize(size);
                onDimensionsCalculated(size);

                // Orbiting happens after the mesh rotation, so calculate the bounds in the
                // displayed coordinate system instead of using the bottom-aligned local origin.
                const displayBox = geo.boundingBox.clone().applyMatrix4(
                    new THREE.Matrix4().makeRotationX(-Math.PI / 2)
                );
                const displayCenter = displayBox.getCenter(new THREE.Vector3());
                const displaySize = displayBox.getSize(new THREE.Vector3());
                onBoundsCalculated({
                    center: displayCenter,
                    radius: displaySize.length() / 2,
                });
            }
            geo.computeVertexNormals();
            setGeometry(geo);
        };

        if (isGLB) {
            const loader = new GLTFLoader();
            loader.load(url, (gltf) => {
                let foundGeometry: THREE.BufferGeometry | null = null;
                gltf.scene.traverse((child) => {
                    if (!foundGeometry && (child as THREE.Mesh).isMesh) {
                        foundGeometry = (child as THREE.Mesh).geometry;
                    }
                });
                if (foundGeometry) handleGeometry(foundGeometry);
            }, undefined, (e) => console.error('Error loading GLB:', e));
        } else {
            const loader = new STLLoader();
            loader.load(url, (geo) => {
                handleGeometry(geo);
            }, undefined, (e) => console.error('Error loading STL:', e));
        }

        return () => {
            cancelled = true;
        };
    }, [url, onDimensionsCalculated, onBoundsCalculated]);

    const materialProps = useMemo(() => ({
        uBaseThickness: baseThickness,
        uColorBlue: new THREE.Color('#0000ff'),
        uColorCyan: new THREE.Color('#00ffff'),
        uColorGreen: new THREE.Color('#00ff00'),
        uColorYellow: new THREE.Color('#ffff00'),
        uColorRed: new THREE.Color('#ff0000'),
    }), [baseThickness]);

    if (!geometry) return null;

    return (
        <group>
            <mesh ref={meshRef} geometry={geometry} rotation={[-Math.PI / 2, 0, 0]}>
                <heightHeatmapMaterial {...materialProps} />
            </mesh>
            <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]}>
                <meshBasicMaterial color="white" wireframe transparent opacity={0.1} />
            </mesh>
        </group>
    );
}

function LoadingFallback() {
    return (
        <mesh>
            <boxGeometry args={[10, 10, 10]} />
            <meshStandardMaterial color="#888888" wireframe />
        </mesh>
    );
}

function ModelOrbitControls({ bounds }: { bounds: ModelBounds | null }) {
    const controlsRef = useRef<React.ElementRef<typeof OrbitControls>>(null);
    const { camera, size } = useThree();
    const minDistance = bounds ? Math.max(10, bounds.radius * 1.1) : 10;

    const fitDistance = useMemo(() => {
        if (!bounds || !(camera instanceof THREE.PerspectiveCamera)) return minDistance;

        const verticalFov = THREE.MathUtils.degToRad(camera.fov);
        const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
        const limitingFov = Math.min(verticalFov, horizontalFov);
        return Math.max(minDistance, (bounds.radius * 1.5) / Math.sin(limitingFov / 2));
    }, [bounds, camera, minDistance, size.width, size.height]);

    const maxDistance = Math.max(500, fitDistance * 2);

    useLayoutEffect(() => {
        const controls = controlsRef.current;
        if (!bounds || !controls || !(camera instanceof THREE.PerspectiveCamera)) return;

        const viewDirection = camera.position.clone().sub(controls.target);

        if (viewDirection.lengthSq() === 0) viewDirection.set(0, 1, 1);
        viewDirection.normalize();

        controls.target.copy(bounds.center);
        camera.position.copy(bounds.center).addScaledVector(viewDirection, fitDistance);
        camera.near = Math.max(0.1, minDistance - bounds.radius * 1.05);
        camera.far = maxDistance + bounds.radius * 2;
        camera.updateProjectionMatrix();
        controls.update();
    }, [bounds, camera, fitDistance, maxDistance, minDistance]);

    return (
        <OrbitControls
            ref={controlsRef}
            makeDefault
            enableDamping
            dampingFactor={0.1}
            rotateSpeed={0.5}
            panSpeed={0.5}
            zoomSpeed={0.8}
            minDistance={minDistance}
            maxDistance={maxDistance}
        />
    );
}

// city preset HDR is fetched from an external CDN; if it's unreachable
// (offline, corporate firewall), fall back to no env map instead of crashing.
class EnvironmentErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
    constructor(props: { children: React.ReactNode }) {
        super(props);
        this.state = { hasError: false };
    }
    static getDerivedStateFromError() {
        return { hasError: true };
    }
    render() {
        if (this.state.hasError) return null;
        return this.props.children;
    }
}

export default function Canvas3D() {
    const currentModelUrl = useStore((state) => state.currentModelUrl);
    const baseThickness = useStore((state) => state.baseThickness);
    const [dimensions, setDimensions] = useState<THREE.Vector3 | null>(null);
    const [modelBounds, setModelBounds] = useState<ModelBounds | null>(null);

    useEffect(() => {
        setDimensions(null);
        setModelBounds(null);
    }, [currentModelUrl]);

    return (
        <div className="absolute inset-0 w-full h-full relative">
            <Canvas
                gl={{ antialias: true, preserveDrawingBuffer: true }}
                camera={{ fov: 45, position: [0, 80, 120] }}
            >
                <ambientLight intensity={0.6} />
                <directionalLight position={[50, 100, 50]} intensity={1.2} />
                <EnvironmentErrorBoundary>
                    <Suspense fallback={null}>
                        <Environment preset="city" />
                    </Suspense>
                </EnvironmentErrorBoundary>

                <Grid
                    args={[300, 300]}
                    cellSize={10}
                    cellThickness={0.5}
                    cellColor="#888888"
                    sectionSize={50}
                    sectionThickness={1.0}
                    sectionColor="#555555"
                    fadeDistance={400}
                    fadeStrength={1}
                    infiniteGrid={false}
                    position={[0, -5, 0]}
                />
                <axesHelper args={[50]} />

                <Suspense fallback={<LoadingFallback />}>
                    <InsoleModel
                        key={currentModelUrl}
                        url={currentModelUrl}
                        baseThickness={baseThickness}
                        onDimensionsCalculated={setDimensions}
                        onBoundsCalculated={setModelBounds}
                    />
                </Suspense>

                <ModelOrbitControls bounds={modelBounds} />
            </Canvas>

            {currentModelUrl && dimensions && (
                <div className="absolute top-4 right-4 pointer-events-none">
                    <div className="bg-card/90 backdrop-blur-md p-4 rounded-lg border shadow-lg text-xs font-mono space-y-1">
                        <div className="font-bold mb-2 text-sm border-b pb-1">Model Dimensions</div>
                        <div className="flex justify-between gap-4"><span className="text-red-500">X (Width):</span> <span>{dimensions.x.toFixed(1)} mm</span></div>
                        <div className="flex justify-between gap-4"><span className="text-green-500">Y (Height):</span> <span>{dimensions.y.toFixed(1)} mm</span></div>
                        <div className="flex justify-between gap-4"><span className="text-blue-500">Z (Length):</span> <span>{dimensions.z.toFixed(1)} mm</span></div>

                        <div className="mt-4 pt-2 border-t font-sans">
                            <div className="font-bold mb-1">Height Map (MAX 5mm)</div>
                            {/* Rainbow Gradient Bar */}
                            <div className="flex h-3 w-full rounded overflow-hidden" style={{ background: 'linear-gradient(to right, #0000ff, #00ffff, #00ff00, #ffff00, #ff0000)' }}>
                            </div>
                            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                                <span>0mm</span>
                                <span>1.5mm</span>
                                <span>3mm</span>
                                <span>4.5mm</span>
                                <span>5mm+</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}


        </div>
    );
}
