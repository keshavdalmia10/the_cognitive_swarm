export type ArtifactDiagramType =
  | 'erDiagram'
  | 'flowchart'
  | 'classDiagram'
  | 'mindmap'
  | 'journey';

export interface ArtifactIdea {
  text: string;
  cluster?: string;
  weight?: number;
}

export interface ArtifactPayload {
  diagramType: ArtifactDiagramType;
  title: string;
  mermaid: string;
}

const diagramLabels: Record<ArtifactDiagramType, string> = {
  erDiagram: 'ER Diagram',
  flowchart: 'Flowchart',
  classDiagram: 'Class Diagram',
  mindmap: 'Mind Map',
  journey: 'Journey Map',
};

function sanitizeLabel(value: string, fallback: string) {
  const cleaned = value
    .replace(/["`]/g, '')
    .replace(/[{}[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

function toIdentifier(value: string, fallback: string) {
  const normalized = sanitizeLabel(value, fallback)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

export function prioritizeArtifactIdeas(ideas: ArtifactIdea[], limit = 12) {
  return ideas
    .filter((idea) => idea.text)
    .sort((a, b) => (b.weight || 0) - (a.weight || 0))
    .slice(0, limit);
}

function summarizeIdeas(ideas: ArtifactIdea[]) {
  return prioritizeArtifactIdeas(ideas, 12);
}

export function getDiagramLabel(type: ArtifactDiagramType) {
  return diagramLabels[type];
}

export function inferDiagramType(topic: string, ideas: ArtifactIdea[] = []): ArtifactDiagramType {
  const haystack = `${topic} ${ideas.map((idea) => `${idea.cluster || ''} ${idea.text}`).join(' ')}`.toLowerCase();

  if (/(database|schema|table|entity|entities|relationship|sql|postgres|mysql|erd|primary key|foreign key)/.test(haystack)) {
    return 'erDiagram';
  }
  if (/(class |oop|object model|domain model|inheritance|interface|service class|repository|controller|uml)/.test(haystack)) {
    return 'classDiagram';
  }
  if (/(journey|experience|touchpoint|persona|customer path|student path)/.test(haystack)) {
    return 'journey';
  }
  if (/(brainstorm|theme|concept|strategy|ecosystem|landscape|curriculum|research areas|knowledge map)/.test(haystack)) {
    return 'mindmap';
  }
  if (/(flow|workflow|process|pipeline|approval|funnel|onboarding|sequence|steps|roadmap)/.test(haystack)) {
    return 'flowchart';
  }

  return 'flowchart';
}

function buildFallbackErDiagram(topic: string, ideas: ArtifactIdea[]): ArtifactPayload {
  const importantIdeas = summarizeIdeas(ideas);
  const entityGroups = new Map<string, ArtifactIdea[]>();
  for (const idea of importantIdeas) {
    const cluster = sanitizeLabel(idea.cluster || 'General', 'General');
    const current = entityGroups.get(cluster) || [];
    current.push(idea);
    entityGroups.set(cluster, current);
  }

  const entities = Array.from(entityGroups.entries()).slice(0, 6);
  const mermaidLines = ['erDiagram'];

  for (const [cluster, groupedIdeas] of entities) {
    const entityName = toIdentifier(cluster, 'ENTITY');
    mermaidLines.push(`  ${entityName} {`);
    mermaidLines.push('    string id');
    groupedIdeas.slice(0, 3).forEach((idea, index) => {
      mermaidLines.push(`    string field_${index + 1} "${sanitizeLabel(idea.text, `field ${index + 1}`)}"`);
    });
    mermaidLines.push('  }');
  }

  for (let i = 1; i < entities.length; i++) {
    const prev = toIdentifier(entities[i - 1][0], 'ENTITY');
    const current = toIdentifier(entities[i][0], 'ENTITY');
    mermaidLines.push(`  ${prev} ||--o{ ${current} : informs`);
  }

  return {
    diagramType: 'erDiagram',
    title: sanitizeLabel(topic, 'Brainstorm Data Model'),
    mermaid: mermaidLines.join('\n'),
  };
}

function buildFallbackFlowchart(topic: string, ideas: ArtifactIdea[]): ArtifactPayload {
  const importantIdeas = summarizeIdeas(ideas);
  const mermaidLines = ['flowchart TD', `  TOPIC["${sanitizeLabel(topic, 'Brainstorm Topic')}"]`];

  importantIdeas.forEach((idea, index) => {
    const nodeId = `N${index + 1}`;
    const label = sanitizeLabel(idea.text, `Idea ${index + 1}`);
    mermaidLines.push(`  ${nodeId}["${label}"]`);
    mermaidLines.push(`  TOPIC --> ${nodeId}`);
  });

  return {
    diagramType: 'flowchart',
    title: sanitizeLabel(topic, 'Brainstorm Flow'),
    mermaid: mermaidLines.join('\n'),
  };
}

function buildFallbackMindmap(topic: string, ideas: ArtifactIdea[]): ArtifactPayload {
  const importantIdeas = summarizeIdeas(ideas);
  const mermaidLines = ['mindmap', `  root(("${sanitizeLabel(topic, 'Brainstorm Topic')}"))`];

  const clusterGroups = new Map<string, ArtifactIdea[]>();
  for (const idea of importantIdeas) {
    const cluster = sanitizeLabel(idea.cluster || 'General', 'General');
    const current = clusterGroups.get(cluster) || [];
    current.push(idea);
    clusterGroups.set(cluster, current);
  }

  for (const [cluster, groupedIdeas] of Array.from(clusterGroups.entries()).slice(0, 6)) {
    mermaidLines.push(`    ${cluster}`);
    groupedIdeas.slice(0, 3).forEach((idea) => {
      mermaidLines.push(`      ${sanitizeLabel(idea.text, 'Idea')}`);
    });
  }

  return {
    diagramType: 'mindmap',
    title: sanitizeLabel(topic, 'Idea Map'),
    mermaid: mermaidLines.join('\n'),
  };
}

function buildFallbackClassDiagram(topic: string, ideas: ArtifactIdea[]): ArtifactPayload {
  const importantIdeas = summarizeIdeas(ideas);
  const classNames = Array.from(
    new Set(
      importantIdeas
        .map((idea) => sanitizeLabel(idea.cluster || idea.text.split(' ')[0] || 'Module', 'Module'))
        .slice(0, 6),
    ),
  );
  const mermaidLines = ['classDiagram'];

  classNames.forEach((className, index) => {
    const classId = toIdentifier(className, `CLASS_${index + 1}`);
    mermaidLines.push(`  class ${classId} {`);
    mermaidLines.push(`    +name ${sanitizeLabel(className, 'Module')}`);
    mermaidLines.push('  }');
  });

  for (let i = 1; i < classNames.length; i++) {
    const left = toIdentifier(classNames[i - 1], `CLASS_${i}`);
    const right = toIdentifier(classNames[i], `CLASS_${i + 1}`);
    mermaidLines.push(`  ${left} --> ${right} : collaborates`);
  }

  return {
    diagramType: 'classDiagram',
    title: sanitizeLabel(topic, 'Class Structure'),
    mermaid: mermaidLines.join('\n'),
  };
}

function buildFallbackJourney(topic: string, ideas: ArtifactIdea[]): ArtifactPayload {
  const importantIdeas = summarizeIdeas(ideas);
  const mermaidLines = [
    'journey',
    `  title ${sanitizeLabel(topic, 'Journey Map')}`,
    '  section Experience',
  ];

  importantIdeas.slice(0, 8).forEach((idea) => {
    mermaidLines.push(`    ${sanitizeLabel(idea.text, 'Step')}: 3: Participants`);
  });

  return {
    diagramType: 'journey',
    title: sanitizeLabel(topic, 'Journey Map'),
    mermaid: mermaidLines.join('\n'),
  };
}

export function buildFallbackArtifact(topic: string, ideas: ArtifactIdea[] = [], explicitType?: ArtifactDiagramType): ArtifactPayload {
  const diagramType = explicitType || inferDiagramType(topic, ideas);

  switch (diagramType) {
    case 'erDiagram':
      return buildFallbackErDiagram(topic, ideas);
    case 'classDiagram':
      return buildFallbackClassDiagram(topic, ideas);
    case 'mindmap':
      return buildFallbackMindmap(topic, ideas);
    case 'journey':
      return buildFallbackJourney(topic, ideas);
    case 'flowchart':
    default:
      return buildFallbackFlowchart(topic, ideas);
  }
}
