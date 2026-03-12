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

export default function ArtifactCanvas({ artifact }: { artifact: ArtifactData | null }) {
  const [svgMarkup, setSvgMarkup] = useState('');
  const [renderError, setRenderError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragStateRef = useRef<{ x: number; y: number; active: boolean }>({ x: 0, y: 0, active: false });

  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      securityLevel: 'loose',
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
        const id = `artifact-${artifact.diagramType}-${artifact.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
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
      <div className="absolute inset-0 flex items-center justify-center text-white/30 font-mono text-sm p-8 text-center">
        Waiting for Administrator to forge a topic-aware diagram...
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex flex-col bg-[#050505]">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <BrainCircuit className="h-4 w-4 text-[#00FF00]" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white">{artifact.title}</div>
            <div className="text-[10px] font-mono uppercase tracking-[0.24em] text-white/45">{diagramLabel}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setScale((value) => Math.max(0.4, value - 0.1))}
            className="rounded-full border border-white/10 bg-white/5 p-2 text-white/70 transition-colors hover:border-white/30 hover:text-white"
            title="Zoom out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => {
              setScale(1);
              setOffset({ x: 0, y: 0 });
            }}
            className="rounded-full border border-white/10 bg-white/5 p-2 text-white/70 transition-colors hover:border-white/30 hover:text-white"
            title="Reset view"
          >
            <Search className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setScale((value) => Math.min(2.5, value + 0.1))}
            className="rounded-full border border-white/10 bg-white/5 p-2 text-white/70 transition-colors hover:border-white/30 hover:text-white"
            title="Zoom in"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-4 left-4 z-10 flex items-center gap-2 rounded-full border border-white/10 bg-black/55 px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.22em] text-white/55">
        <Move className="h-3.5 w-3.5" />
        Drag to pan, use controls to zoom
      </div>

      <div
        className="relative flex-1 overflow-hidden"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {renderError ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-300">
              Failed to render diagram: {renderError}
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
