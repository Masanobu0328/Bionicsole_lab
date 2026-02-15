import { Object3DNode } from '@react-three/fiber';

// Custom shader material type declaration
declare module '@react-three/fiber' {
    interface ThreeElements {
        heightHeatmapMaterial: Object3DNode<any, any>;
    }
}

declare global {
    namespace JSX {
        interface IntrinsicElements {
            heightHeatmapMaterial: any;
        }
    }
}

export { };
