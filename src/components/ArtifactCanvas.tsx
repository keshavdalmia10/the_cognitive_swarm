import { useEffect, useMemo, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { BrainCircuit, Move, Search, ZoomIn, ZoomOut } from 'lucide-react';

export type ArtifactDiagramType = 'erDiagram' | 'flowchart' | 'classDiagram' | 'mindmap' | 'journey';

export interface ArtifactData {
  diagramType: ArtifactDiagramType;
  title: string;
  mermaid: string;
}

const LABELS: Record<ArtifactDiagramType, string> = {
  erDiagram: 'ER Diagram',
  flowchart: 'Flowchart',
  classDiagram: 'Class Diagram',
  mindmap: 'Mind Map',
  journey: 'Journey Map',
};

const focusRingClass =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#34D399]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505]';

export default function ArtifactCanvas({ artifact }: { artifact: ArtifactData | null }) {
  const [svgMarkup, setSvgMarkup] = useState('');
  const [renderError, setRenderError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragStateRef = useRef<{ x: number; y: number; active: boolean }>({ x: 0, y: 0, active: false });
  const renderCountRef = useRef(0);

  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      securityLevel: 'strict',
      darkMode: true,
      flowchart: {
        curve: 'basis',
        useMaxWidth: true,
      },
      er: {
        useMaxWidth: true,
      },
    });
  }, []);

  useEffect(() => {
    if (!artifact) {
      setSvgMarkup('');
      setRenderError(null);
      return;
    }

    let cancelled = false;
    const render = async () => {
      try {
        renderCountRef.current += 1;
        const id = `artifact-${renderCountRef.current}-${artifact.diagramType}`;
        const { svg } = await mermaid.render(id, artifact.mermaid);
        if (!cancelled) {
          setSvgMarkup(svg);
          setRenderError(null);
          setScale(1);
          setOffset({ x: 0, y: 0 });
        }
      } catch (error: any) {
        if (!cancelled) {
          setRenderError(error?.message || 'Failed to render artifact');
          setSvgMarkup('');
        }
      }
    };

    render();
    return () => {
      cancelled = true;
    };
  }, [artifact]);

  const diagramLabel = useMemo(() => {
    if (!artifact) return 'Diagram';
    return LABELS[artifact.diagramType] || 'Diagram';
  }, [artifact]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    dragStateRef.current = {
      x: event.clientX - offset.x,
      y: event.clientY - offset.y,
      active: true,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStateRef.current.active) return;
    setOffset({
      x: event.clientX - dragStateRef.current.x,
      y: event.clientY - dragStateRef.current.y,
    });
  };

  const onPointerUp = () => {
    dragStateRef.current.active = false;
  };

  if (!artifact) {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-8 text-center">
        <div className="max-w-md rounded-2xl border border-white/8 bg-[#0F0F11] px-8 py-10">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-[#A78BFA]/20 bg-[#A78BFA]/10 text-[#A78BFA]">
            <BrainCircuit className="h-6 w-6" />
          </div>
          <p className="mt-5 text-[10px] font-mono uppercase tracking-[0.28em] text-white/35">Artifact Workspace</p>
          <h3 className="mt-2 text-lg font-semibold text-white/90">Waiting for the next forged diagram</h3>
          <p className="mt-3 text-sm leading-relaxed text-white/35">
            When the administrator forges an artifact, it will appear here with pan and zoom controls.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex flex-col bg-[#050505]">
      <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#A78BFA]/20 bg-[#A78BFA]/10">
            <BrainCircuit className="h-3.5 w-3.5 text-[#A78BFA]" />
          </div>
          <span className="truncate text-sm font-medium text-white/85">{artifact.title}</span>
          <span className="rounded-md border border-[#A78BFA]/20 bg-[#A78BFA]/10 px-2 py-0.5 text-[9px] font-mono uppercase tracking-[0.2em] text-[#A78BFA]">
            {diagramLabel}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setScale((value) => Math.max(0.4, value - 0.1))}
            className={`${focusRingClass} rounded-lg border border-white/8 bg-white/5 p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white/80`}
            title="Zoom out"
          >
            <ZoomOut className="h-3 w-3" />
          </button>
          <button
            onClick={() => {
              setScale(1);
              setOffset({ x: 0, y: 0 });
            }}
            className={`${focusRingClass} rounded-lg border border-white/8 bg-white/5 p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white/80`}
            title="Reset view"
          >
            <Search className="h-3 w-3" />
          </button>
          <button
            onClick={() => setScale((value) => Math.min(2.5, value + 0.1))}
            className={`${focusRingClass} rounded-lg border border-white/8 bg-white/5 p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white/80`}
            title="Zoom in"
          >
            <ZoomIn className="h-3 w-3" />
          </button>
          <span className="ml-1 text-[9px] font-mono text-white/30">{(scale * 100).toFixed(0)}%</span>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex items-center gap-1.5 rounded-lg border border-white/8 bg-black/60 px-2.5 py-1 text-[9px] font-mono uppercase tracking-[0.2em] text-white/40 backdrop-blur-xl">
        <Move className="h-3 w-3" />
        Drag to pan
      </div>

      <div
        className="relative flex-1 overflow-hidden"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {renderError ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
            <div className="max-w-lg rounded-xl border border-[#FBBF24]/20 bg-[#FBBF24]/8 px-6 py-4 text-sm">
              <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-[#FBBF24]/70">Render Error</p>
              <p className="mt-2 leading-relaxed text-[#FBBF24]/80">Failed to render diagram: {renderError}</p>
            </div>
          </div>
        ) : (
          <div
            className="absolute inset-0 cursor-grab active:cursor-grabbing"
            onPointerDown={onPointerDown}
          >
            <div
              className="origin-center p-8"
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                transition: dragStateRef.current.active ? 'none' : 'transform 120ms ease-out',
              }}
              dangerouslySetInnerHTML={{ __html: svgMarkup }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
