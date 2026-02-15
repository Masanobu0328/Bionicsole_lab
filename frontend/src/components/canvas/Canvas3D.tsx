'use client';

import React, { Suspense, useRef, useEffect, useState, useMemo } from 'react';
import { Canvas, useThree, extend, useFrame } from '@react-three/fiber';
import { Center, Grid, Environment, OrbitControls, Bounds, useBounds, shaderMaterial } from '@react-three/drei';
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

// Component to trigger bounds fit on load
function BoundsRefresher() {
    const api = useBounds();
    useEffect(() => {
        api?.refresh().clip().fit();
    }, [api]);
    return null;
}

function InsoleModel({ url, baseThickness, onDimensionsCalculated }: { url: string | null, baseThickness: number, onDimensionsCalculated: (dim: THREE.Vector3) => void }) {
    const meshRef = useRef<THREE.Mesh>(null);
    const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);

    useEffect(() => {
        if (!url) {
            setGeometry(null);
            return;
        }

        console.log("Loading 3D Model from:", url);
        const isGLB = url.toLowerCase().endsWith('.glb');

        const handleGeometry = (geo: THREE.BufferGeometry) => {
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
    }, [url, onDimensionsCalculated]);

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
            <mesh ref={meshRef} geometry={geometry} castShadow receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
                <heightHeatmapMaterial {...materialProps} />
            </mesh>
            <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]}>
                <meshBasicMaterial color="white" wireframe transparent opacity={0.1} />
            </mesh>
            <BoundsRefresher />
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

function SceneSetup() {
    return null;
}

export default function Canvas3D() {
    const currentModelUrl = useStore((state) => state.currentModelUrl);
    const baseThickness = useStore((state) => state.baseThickness);
    const [dimensions, setDimensions] = useState<THREE.Vector3 | null>(null);

    useEffect(() => {
        if (!currentModelUrl) setDimensions(null);
    }, [currentModelUrl]);

    return (
        <div className="absolute inset-0 w-full h-full relative">
            <Canvas
                shadows
                gl={{ antialias: true, preserveDrawingBuffer: true }}
                camera={{ fov: 45, position: [0, 80, 120] }}
            >
                <SceneSetup />

                <ambientLight intensity={0.6} />
                <directionalLight position={[50, 100, 50]} intensity={1.2} />
                <Environment preset="city" />

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
                    <Bounds fit clip observe margin={1.5}>
                        <InsoleModel
                            key={currentModelUrl}
                            url={currentModelUrl}
                            baseThickness={baseThickness}
                            onDimensionsCalculated={setDimensions}
                        />
                    </Bounds>
                </Suspense>

                <OrbitControls
                    makeDefault
                    enableDamping
                    dampingFactor={0.1}
                    rotateSpeed={0.5}
                    panSpeed={0.5}
                    zoomSpeed={0.8}
                    minDistance={10}
                    maxDistance={500}
                />
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