import type { ArtifactDiagramType } from "../utils/artifactPolicy.ts";

export type SessionPhase = "divergent" | "convergent" | "forging";

export interface FlowDataShape {
  nodes: any[];
  edges: any[];
}

export interface ArtifactDataShape {
  diagramType: ArtifactDiagramType;
  title: string;
  mermaid: string;
}

export interface IdeaRecord {
  id: string;
  text: string;
  weight: number;
  cluster: string;
  authorId: string;
  authorName: string;
  initialPosition: [number, number, number];
  targetPosition: [number, number, number] | null;
  url?: string;
  urlTitle?: string;
}

export interface EdgeRecord {
  source: string;
  target: string;
  reason?: string;
}

export interface SessionState {
  topic: string;
  phase: SessionPhase;
  ideas: IdeaRecord[];
  edges: EdgeRecord[];
  flowData: FlowDataShape;
  artifactData: ArtifactDataShape | null;
}

export interface SessionParticipant {
  socketId: string;
  userName: string;
  role: "admin" | "participant";
  joinedAt: number;
  contributionCount: number;
  lastContributionAt: number | null;
  credits: number;
  votes: Record<string, number>;
}

export interface RoomMetadata {
  code: string;
  adminSocketId: string;
  adminUserName: string;
  status: "active" | "closed";
  createdAt: number;
  updatedAt: number;
}

export interface SessionMetadata {
  lastIdeaTime: number;
  lastDirectionSuggestionTime: number;
  lastDirectionSuggestionKey: string;
  updatedAt: number;
}

export interface SessionSnapshot {
  room: RoomMetadata;
  state: SessionState;
  participants: Record<string, SessionParticipant>;
  metadata: SessionMetadata;
}

export function createDefaultSessionState(): SessionState {
  return {
    topic: "",
    phase: "divergent",
    ideas: [],
    edges: [],
    flowData: { nodes: [], edges: [] },
    artifactData: null,
  };
}

export function createDefaultRoomMetadata(roomCode: string, now = Date.now()): RoomMetadata {
  return {
    code: roomCode,
    adminSocketId: "",
    adminUserName: "",
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

export function createDefaultSessionSnapshot(roomCode: string, now = Date.now()): SessionSnapshot {
  return {
    room: createDefaultRoomMetadata(roomCode, now),
    state: createDefaultSessionState(),
    participants: {},
    metadata: {
      lastIdeaTime: now,
      lastDirectionSuggestionTime: 0,
      lastDirectionSuggestionKey: "",
      updatedAt: now,
    },
  };
}

export function cloneSessionSnapshot(snapshot: SessionSnapshot): SessionSnapshot {
  return structuredClone(snapshot);
}
