import { Canvas, useFrame } from '@react-three/fiber';
import { Text, OrbitControls, Float } from '@react-three/drei';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

function IdeaNode({ idea, position }: { idea: any, position: [number, number, number] }) {
  const ref = useRef<THREE.Group>(null);
  const color = useMemo(() => {
    // Simple hash to color based on cluster
    let hash = 0;
    for (let i = 0; i < idea.cluster.length; i++) {
      hash = idea.cluster.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    return '#' + '00000'.substring(0, 6 - c.length) + c;
  }, [idea.cluster]);

  const scale = 1 + (idea.weight * 0.1);

  return (
    <Float speed={1.5} rotationIntensity={0.5} floatIntensity={2}>
      <group ref={ref} position={position} scale={scale}>
        <mesh>
          <sphereGeometry args={[0.5, 32, 32]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} wireframe />
        </mesh>
        <Text
          position={[0, 0.8, 0]}
          fontSize={0.3}
          color="white"
          anchorX="center"
          anchorY="middle"
          maxWidth={3}
          textAlign="center"
        >
          {idea.text}
        </Text>
        <Text
          position={[0, -0.8, 0]}
          fontSize={0.15}
          color={color}
          anchorX="center"
          anchorY="middle"
        >
          [{idea.cluster}]
        </Text>
      </group>
    </Float>
  );
}

export default function IdeaSwarm({ ideas }: { ideas: any[] }) {
  // Generate positions for ideas grouped by cluster
  const positions = useMemo(() => {
    // Group ideas by cluster
    const clusters: Record<string, any[]> = {};
    ideas.forEach(idea => {
      if (!clusters[idea.cluster]) clusters[idea.cluster] = [];
      clusters[idea.cluster].push(idea);
    });

    const clusterNames = Object.keys(clusters);
    const numClusters = clusterNames.length;
    
    // Assign a base position for each cluster on a large sphere
    const clusterCenters: Record<string, [number, number, number]> = {};
    clusterNames.forEach((name, i) => {
      // Distribute cluster centers evenly using spherical Fibonacci or simple ring
      const phi = Math.acos(1 - 2 * (i + 0.5) / Math.max(1, numClusters));
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      const radius = 12; // Distance of cluster centers from origin
      
      clusterCenters[name] = [
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi)
      ];
    });

    // Assign individual idea positions around their cluster center
    return ideas.map((idea) => {
      const center = clusterCenters[idea.cluster] || [0, 0, 0];
      
      // Small random offset around the cluster center
      const offsetRadius = 2 + Math.random() * 3;
      const offsetTheta = Math.random() * Math.PI * 2;
      const offsetPhi = Math.acos(Math.random() * 2 - 1);
      
      return [
        center[0] + offsetRadius * Math.sin(offsetPhi) * Math.cos(offsetTheta),
        center[1] + offsetRadius * Math.sin(offsetPhi) * Math.sin(offsetTheta),
        center[2] + offsetRadius * Math.cos(offsetPhi)
      ] as [number, number, number];
    });
  }, [ideas]);

  return (
    <div className="w-full h-full bg-[#050505]">
      <Canvas camera={{ position: [0, 0, 15], fov: 60 }}>
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} intensity={1} />
        <OrbitControls enablePan={true} enableZoom={true} enableRotate={true} autoRotate autoRotateSpeed={0.5} />
        
        {ideas.map((idea, i) => (
          <IdeaNode key={idea.id} idea={idea} position={positions[i] || [0,0,0]} />
        ))}
        
        {/* Background particles */}
        <points>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              count={1000}
              array={new Float32Array(3000).map(() => (Math.random() - 0.5) * 50)}
              itemSize={3}
            />
          </bufferGeometry>
          <pointsMaterial size={0.05} color="#ffffff" transparent opacity={0.2} />
        </points>
      </Canvas>
    </div>
  );
}
