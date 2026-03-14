import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls, PerspectiveCamera, Stars } from '@react-three/drei';
import * as THREE from 'three';

const CLUSTER_COLORS = [
  '#22c55e',
  '#38bdf8',
  '#f59e0b',
  '#f472b6',
  '#a78bfa',
  '#fb7185',
  '#2dd4bf',
  '#fde047',
  '#60a5fa',
  '#f97316',
];

function getClusterColor(cluster: string) {
  let hash = 0;
  for (let i = 0; i < cluster.length; i++) {
    hash = (hash * 31 + cluster.charCodeAt(i)) >>> 0;
  }
  return CLUSTER_COLORS[hash % CLUSTER_COLORS.length];
}

function fallbackPosition(index: number) {
  const angle = index * 0.82;
  const radius = 6 + (index % 7) * 0.9;
  const layer = ((index % 5) - 2) * 2.4;
  return [
    Math.cos(angle) * radius,
    Math.sin(angle * 1.2) * (radius * 0.55),
    layer,
  ] as [number, number, number];
}

function buildGraph(ideas: any[], edges: any[]) {
  const nodes = ideas.map((idea, index) => {
    const rawPosition = idea.targetPosition || idea.initialPosition || fallbackPosition(index);
    const position: [number, number, number] = [
      rawPosition[0] * 1.35,
      rawPosition[1] * 1.35,
      rawPosition[2] * 1.35,
    ];

    return {
      ...idea,
      position,
      color: getClusterColor(idea.cluster || 'General'),
      radius: 0.45 + Math.min(idea.weight || 1, 8) * 0.08,
    };
  });

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const links: Array<{
    key: string;
    source: string;
    target: string;
    isCluster: boolean;
    reason?: string;
  }> = [];

  const clusterGroups = new Map<string, any[]>();
  for (const node of nodes) {
    const cluster = node.cluster || 'General';
    const current = clusterGroups.get(cluster) || [];
    current.push(node);
    clusterGroups.set(cluster, current);
  }

  for (const clusterNodes of clusterGroups.values()) {
    for (let i = 1; i < clusterNodes.length; i++) {
      links.push({
        key: `cluster-${clusterNodes[i - 1].id}-${clusterNodes[i].id}`,
        source: clusterNodes[i - 1].id,
        target: clusterNodes[i].id,
        isCluster: true,
      });
    }
  }

  for (const edge of edges) {
    if (nodeMap.has(edge.source) && nodeMap.has(edge.target)) {
      links.push({
        key: `edge-${edge.source}-${edge.target}-${edge.reason || ''}`,
        source: edge.source,
        target: edge.target,
        isCluster: false,
        reason: edge.reason,
      });
    }
  }

  return { nodes, links, nodeMap };
}

function SwarmNode({
  node,
  isSelected,
  onSelect,
}: {
  node: any;
  isSelected: boolean;
  onSelect?: (idea: any) => void;
}) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <group
      position={node.position}
      onClick={(event) => {
        event.stopPropagation();
        onSelect?.(node);
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        setIsHovered(true);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setIsHovered(false);
        document.body.style.cursor = 'default';
      }}
    >
      <mesh>
        <sphereGeometry args={[node.radius * (isHovered ? 1.12 : 1), 28, 28]} />
        <meshStandardMaterial
          color={node.color}
          emissive={node.color}
          emissiveIntensity={isSelected ? 0.85 : 0.42}
          metalness={0.2}
          roughness={0.3}
        />
      </mesh>

      <mesh>
        <sphereGeometry args={[node.radius * 1.7, 18, 18]} />
        <meshBasicMaterial color={node.color} transparent opacity={isSelected ? 0.12 : 0.05} />
      </mesh>

      <Html position={[0, node.radius + 0.9, 0]} center distanceFactor={10} sprite>
        <div
          className={`pointer-events-none max-w-[220px] rounded-2xl border px-3 py-2 text-center shadow-2xl backdrop-blur-md transition-all ${
            isSelected || isHovered
              ? 'border-white/30 bg-black/85 text-white'
              : 'border-white/10 bg-black/60 text-white/85'
          }`}
        >
          <div className="text-sm leading-tight">{node.text}</div>
          <div className="mt-2 inline-flex rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.2em] text-white/55">
            {node.cluster}
          </div>
          <div className="mt-1 text-[10px] font-mono text-white/40">
            z: {node.position[2].toFixed(1)}
          </div>
        </div>
      </Html>
    </group>
  );
}

function SwarmScene({
  ideas,
  edges,
  selectedIdeaId,
  onIdeaClick,
}: {
  ideas: any[];
  edges: any[];
  selectedIdeaId?: string | null;
  onIdeaClick?: (idea: any) => void;
}) {
  const controlsRef = useRef<any>(null);
  const graph = useMemo(() => buildGraph(ideas, edges), [ideas, edges]);
  const selectedNode = graph.nodes.find((node) => node.id === selectedIdeaId) || null;

  function CameraFocusAnimation({ focusNode }: { focusNode: any | null }) {
    const { camera } = useThree();
    const animationRef = useRef<{
      start: number;
      duration: number;
      fromPosition: THREE.Vector3;
      toPosition: THREE.Vector3;
      fromTarget: THREE.Vector3;
      toTarget: THREE.Vector3;
    } | null>(null);
    const lastFocusKeyRef = useRef('');

    useEffect(() => {
      const controls = controlsRef.current;
      if (!focusNode || !controls) return;

      const focusTarget = new THREE.Vector3(...focusNode.position);
      const focusKey = `${focusNode.id}:${focusNode.position.map((value: number) => value.toFixed(2)).join(':')}`;
      if (focusKey === lastFocusKeyRef.current) {
        return;
      }
      lastFocusKeyRef.current = focusKey;

      const currentTarget = controls.target.clone();
      const currentPosition = camera.position.clone();
      const offset = currentPosition.clone().sub(currentTarget);
      if (offset.lengthSq() === 0) {
        offset.set(0, 0, 24);
      }

      const desiredDistance = THREE.MathUtils.clamp(offset.length(), 10, 24);
      const nextPosition = focusTarget.clone().add(offset.normalize().multiplyScalar(desiredDistance));

      animationRef.current = {
        start: performance.now(),
        duration: 950,
        fromPosition: currentPosition,
        toPosition: nextPosition,
        fromTarget: currentTarget,
        toTarget: focusTarget,
      };
    }, [camera, focusNode]);

    useFrame(() => {
      const controls = controlsRef.current;
      const animation = animationRef.current;
      if (!controls || !animation) return;

      const elapsed = performance.now() - animation.start;
      const progress = Math.min(elapsed / animation.duration, 1);
      const eased =
        progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      camera.position.lerpVectors(animation.fromPosition, animation.toPosition, eased);
      controls.target.lerpVectors(animation.fromTarget, animation.toTarget, eased);
      controls.update();

      if (progress >= 1) {
        animationRef.current = null;
      }
    });

    return null;
  }

  return (
    <>
      <color attach="background" args={['#050505']} />
      <fog attach="fog" args={['#050505', 20, 48]} />

      <PerspectiveCamera makeDefault position={[0, 0, 24]} fov={52} />
      <CameraFocusAnimation focusNode={selectedNode} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[10, 12, 8]} intensity={1.25} color="#e2ffe8" />
      <pointLight position={[-10, -6, -10]} intensity={1.1} color="#2dd4bf" />
      <Stars radius={55} depth={20} count={1200} factor={2.2} saturation={0} fade speed={0.35} />

      <gridHelper args={[34, 17, '#11331f', '#0b1b14']} />
      {graph.links.map((link) => {
        const source = graph.nodeMap.get(link.source);
        const target = graph.nodeMap.get(link.target);
        if (!source || !target) return null;

        return (
          <Line
            key={link.key}
            points={[source.position, target.position]}
            color={link.isCluster ? '#9ca3af' : '#34d399'}
            lineWidth={link.isCluster ? 1.1 : 2.1}
            transparent
            opacity={link.isCluster ? 0.24 : 0.65}
            dashed={!link.isCluster}
            dashSize={link.isCluster ? 0 : 0.4}
            gapSize={link.isCluster ? 0 : 0.22}
          />
        );
      })}

      {graph.nodes.map((node) => (
        <SwarmNode
          key={node.id}
          node={node}
          isSelected={selectedIdeaId === node.id}
          onSelect={onIdeaClick}
        />
      ))}

      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.75}
        zoomSpeed={0.9}
        panSpeed={0.85}
        minDistance={8}
        maxDistance={52}
      />

      <Html position={[-14.5, 11.5, 0]} transform={false}>
        <div className="pointer-events-auto flex gap-2">
          <button
            onClick={() => controlsRef.current?.reset?.()}
            className="rounded-full border border-white/10 bg-black/60 px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.18em] text-white/80 transition-colors hover:border-[#00FF00]/40 hover:text-white"
          >
            Reset View
          </button>
        </div>
      </Html>
    </>
  );
}

export default function IdeaSwarm({
  ideas,
  edges = [],
  selectedIdeaId = null,
  onIdeaClick,
}: {
  ideas: any[];
  edges?: any[];
  selectedIdeaId?: string | null;
  onIdeaClick?: (idea: any) => void;
}) {
  return (
    <div className="w-full h-full bg-[#050505] relative overflow-hidden">
      <Canvas gl={{ antialias: true }} dpr={[1, 2]}>
        <SwarmScene
          ideas={ideas}
          edges={edges}
          selectedIdeaId={selectedIdeaId}
          onIdeaClick={onIdeaClick}
        />
      </Canvas>

      <div className="pointer-events-none absolute left-6 top-6 flex flex-col gap-2">
        <div className="rounded-full border border-white/10 bg-black/55 px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.18em] text-white/65">
          3D Swarm Graph
        </div>
        <div className="max-w-sm rounded-2xl border border-white/10 bg-black/55 px-4 py-3 text-xs text-white/65 backdrop-blur-md">
          Drag to orbit. Scroll to zoom. Right-drag or two-finger drag to pan.
        </div>
      </div>
    </div>
  );
}
