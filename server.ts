import express from "express";
import http from "http";
import path from "path";

import dotenv from "dotenv";
import { GoogleGenAI, LiveServerMessage, Modality, Type } from "@google/genai";
import { createAdapter } from "@socket.io/redis-adapter";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";

import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from "./src/server/roomCode.ts";
import { createRedisClientFromConfig, getDeploymentConfig, type AppRedisClient } from "./src/server/runtimeConfig.ts";
import { SessionStore } from "./src/server/sessionStore.ts";
import type {
  IdeaRecord,
  SessionParticipant,
  SessionSnapshot,
  SessionState,
} from "./src/server/sessionTypes.ts";
import { buildFallbackArtifact, getDiagramLabel, inferDiagramType } from "./src/utils/artifactPolicy.ts";
import type { ArtifactDiagramType, ArtifactIdea } from "./src/utils/artifactPolicy.ts";
import {
  buildAudienceNudge,
  buildDevSpaHtml,
  getQuietParticipantNames,
  shouldAutoBroadcastSuggestion,
  shouldSkipRepeatedSuggestion,
} from "./src/utils/swarmPolicy.ts";
import { INITIAL_CREDITS, isAdmin, isValidPhase, sanitizeIdeaInput, validateVote } from "./src/utils/serverGuards.ts";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

function logToFile(_msg: string) {}

type UserRole = "admin" | "participant";
type SuggestionReason = "auto" | "manual";

interface RoomContext {
  roomCode: string;
  store: SessionStore;
  directionSuggestionInFlight: boolean;
  anchorLiveSessionPromise: Promise<any> | null;
  currentAnchorAnnouncementId: number;
  anchorResponseAnnouncementId: number;
  synthesizerInterval: NodeJS.Timeout | null;
  criticInterval: NodeJS.Timeout | null;
  suggestionInterval: NodeJS.Timeout | null;
  runtimeEnabled: boolean;
}

function emitInlineAudio(
  target: { emit: (eventName: string, payload: any) => boolean },
  eventName: string,
  inlineData?: { data?: string; mimeType?: string | null },
) {
  if (!inlineData?.data) return;
  target.emit(eventName, {
    data: inlineData.data,
    mimeType: inlineData.mimeType,
  });
}

let aiClient: InstanceType<typeof GoogleGenAI> | null = null;

function getAI() {
  if (aiClient) return aiClient;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("No API key found in environment variables. Initializing without explicit key.");
    aiClient = new GoogleGenAI({});
  } else {
    console.log("Initializing GoogleGenAI with API key of length:", apiKey.length);
    logToFile(`Initializing GoogleGenAI with API key of length: ${apiKey.length}`);
    aiClient = new GoogleGenAI({ apiKey });
  }

  return aiClient;
}

const MAX_IDEAS = 200;
const projectionMatrix = Array.from({ length: 3 }, () =>
  Array.from({ length: 3072 }, () => (Math.random() - 0.5) * 2),
);

function projectTo3D(embedding: number[]): [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;

  for (let index = 0; index < embedding.length; index += 1) {
    x += embedding[index] * projectionMatrix[0][index];
    y += embedding[index] * projectionMatrix[1][index];
    z += embedding[index] * projectionMatrix[2][index];
  }

  const magnitude = Math.sqrt(x * x + y * y + z * z);
  if (magnitude === 0) return [0, 0, 0];

  const scale = 12;
  return [(x / magnitude) * scale, (y / magnitude) * scale, (z / magnitude) * scale];
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

function randomIdeaPosition(): [number, number, number] {
  return [(Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20];
}

function enforceIdeaLimit(ideas: IdeaRecord[]) {
  if (ideas.length < MAX_IDEAS) {
    return;
  }

  const minIndex = ideas.reduce(
    (lowestIndex, idea, index, list) =>
      (idea.weight || 0) < (list[lowestIndex].weight || 0) ? index : lowestIndex,
    0,
  );
  ideas.splice(minIndex, 1);
}

function upsertParticipantRecord(
  snapshot: SessionSnapshot,
  socketId: string,
  userName: string,
  role: UserRole = "participant",
): SessionParticipant | null {
  const cleanedName = userName.trim();
  if (!cleanedName) {
    return snapshot.participants[socketId] || null;
  }

  const existing = snapshot.participants[socketId];
  const now = Date.now();
  const participant: SessionParticipant = {
    socketId,
    userName: cleanedName,
    role,
    joinedAt: existing?.joinedAt ?? now,
    contributionCount: existing?.contributionCount ?? 0,
    lastContributionAt: existing?.lastContributionAt ?? null,
    credits: existing?.credits ?? INITIAL_CREDITS,
    votes: existing?.votes ?? {},
  };

  snapshot.participants[socketId] = participant;
  return participant;
}

function markParticipantContribution(
  snapshot: SessionSnapshot,
  socketId: string,
  fallbackName?: string,
): SessionParticipant {
  const existing = snapshot.participants[socketId];
  const now = Date.now();
  const participant: SessionParticipant = {
    socketId,
    userName: existing?.userName || fallbackName?.trim() || "Anonymous Node",
    role: existing?.role || "participant",
    joinedAt: existing?.joinedAt ?? now,
    contributionCount: (existing?.contributionCount ?? 0) + 1,
    lastContributionAt: now,
    credits: existing?.credits ?? INITIAL_CREDITS,
    votes: existing?.votes ?? {},
  };

  snapshot.participants[socketId] = participant;
  return participant;
}

function getQuietParticipantNamesForAnchor(snapshot: SessionSnapshot, now: number) {
  return getQuietParticipantNames({
    participants: Object.values(snapshot.participants).map((participant) => ({
      name: participant.userName,
      joinedAt: participant.joinedAt,
      contributionCount: participant.contributionCount,
      role: participant.role,
    })),
    now,
    maxNames: 6,
  });
}

function getTopContributorNames(snapshot: SessionSnapshot, maxNames = 2) {
  const contributorScores = new Map<string, number>();

  for (const idea of snapshot.state.ideas) {
    if (!idea.authorName || idea.authorId.startsWith("agent-")) continue;
    contributorScores.set(
      idea.authorName,
      (contributorScores.get(idea.authorName) || 0) + (idea.weight || 1),
    );
  }

  return Array.from(contributorScores.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, maxNames)
    .map(([name]) => name);
}

function buildSessionSummary(snapshot: SessionSnapshot) {
  return {
    topic: snapshot.state.topic,
    phase: snapshot.state.phase,
    topContributors: getTopContributorNames(snapshot, 3),
    quietParticipants: getQuietParticipantNamesForAnchor(snapshot, Date.now()),
    ideas: snapshot.state.ideas.slice(-12).map((idea) => ({
      text: idea.text,
      cluster: idea.cluster,
      weight: idea.weight,
      authorName: idea.authorName,
    })),
  };
}

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT || 3001);
  const host = process.env.HOST?.trim() || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
  const deploymentConfig = getDeploymentConfig();

  console.log("Server starting. GEMINI_API_KEY is", process.env.GEMINI_API_KEY ? "SET" : "NOT SET");
  logToFile(`Server starting. GEMINI_API_KEY is ${process.env.GEMINI_API_KEY ? "SET" : "NOT SET"}`);

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  const shutdownClients: AppRedisClient[] = [];
  if (deploymentConfig.redis) {
    const pubClient = await createRedisClientFromConfig(deploymentConfig.redis);
    const subClient = pubClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    shutdownClients.push(pubClient, subClient);
  }

  const roomContexts = new Map<string, RoomContext>();

  function getLocalSocketsForRoom(roomCode: string) {
    return Array.from(io.of("/").sockets.values()).filter((socket) => socket.data.roomCode === roomCode);
  }

  function clearSocketRoom(socket: any) {
    socket.data.roomCode = undefined;
    socket.data.role = undefined;
    socket.data.userName = undefined;
  }

  async function cleanupRoomContextIfUnused(roomCode: string) {
    const roomContext = roomContexts.get(roomCode);
    if (!roomContext) return;
    if (getLocalSocketsForRoom(roomCode).length > 0) return;

    if (roomContext.synthesizerInterval) clearInterval(roomContext.synthesizerInterval);
    if (roomContext.criticInterval) clearInterval(roomContext.criticInterval);
    if (roomContext.suggestionInterval) clearInterval(roomContext.suggestionInterval);
    roomContext.synthesizerInterval = null;
    roomContext.criticInterval = null;
    roomContext.suggestionInterval = null;
    roomContext.runtimeEnabled = false;

    if (roomContext.anchorLiveSessionPromise) {
      await roomContext.anchorLiveSessionPromise.then((session) => session.close()).catch(() => undefined);
      roomContext.anchorLiveSessionPromise = null;
    }

    await roomContext.store.close();
    roomContexts.delete(roomCode);
  }

  async function getRoomContext(roomCode: string, createIfMissing = false) {
    const normalizedRoomCode = normalizeRoomCode(roomCode);
    const existing = roomContexts.get(normalizedRoomCode);
    if (existing) {
      return existing;
    }

    const store = new SessionStore(
      {
        ...deploymentConfig,
        roomId: normalizedRoomCode,
      },
      { createIfMissing },
    );
    await store.init();

    if (!store.existsInStore()) {
      await store.close();
      return null;
    }

    const roomContext: RoomContext = {
      roomCode: normalizedRoomCode,
      store,
      directionSuggestionInFlight: false,
      anchorLiveSessionPromise: null,
      currentAnchorAnnouncementId: 0,
      anchorResponseAnnouncementId: 0,
      synthesizerInterval: null,
      criticInterval: null,
      suggestionInterval: null,
      runtimeEnabled: false,
    };
    roomContexts.set(normalizedRoomCode, roomContext);
    return roomContext;
  }

  async function roomCodeExists(roomCode: string) {
    const probeStore = new SessionStore(
      {
        ...deploymentConfig,
        roomId: normalizeRoomCode(roomCode),
      },
      { createIfMissing: false },
    );
    await probeStore.init();
    const exists = probeStore.existsInStore();
    await probeStore.close();
    return exists;
  }

  async function allocateRoomCode() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const roomCode = generateRoomCode();
      if (roomContexts.has(roomCode)) {
        continue;
      }
      if (!(await roomCodeExists(roomCode))) {
        return roomCode;
      }
    }

    throw new Error("Unable to generate a unique room code.");
  }

  function buildStateSyncPayload(snapshot: SessionSnapshot, socket: any) {
    const participant = snapshot.participants[socket.id];
    const role = (socket.data.role || participant?.role || "participant") as UserRole;
    const userName = String(socket.data.userName || participant?.userName || "").trim();

    return {
      room: {
        code: snapshot.room.code,
        adminUserName: snapshot.room.adminUserName,
        status: snapshot.room.status,
        participantCount: Object.keys(snapshot.participants).length,
      },
      state: snapshot.state,
      currentUser: {
        userName,
        role,
        isAdmin: role === "admin",
      },
    };
  }

  async function emitStateSync(socket: any, roomContext: RoomContext) {
    const snapshot = await roomContext.store.getSnapshot();
    socket.emit("state_sync", buildStateSyncPayload(snapshot, socket));
    const participant = snapshot.participants[socket.id];
    if (participant) {
      socket.emit("credits_updated", { credits: participant.credits, votes: participant.votes });
    }
  }

  async function getActiveRoom(socket: any) {
    const roomCode = socket.data.roomCode as string | undefined;
    if (!roomCode) {
      socket.emit("room_error", { message: "Join a room first." });
      return null;
    }

    const roomContext = await getRoomContext(roomCode, false);
    if (!roomContext) {
      clearSocketRoom(socket);
      socket.emit("room_error", { message: "This room is no longer available." });
      return null;
    }

    const snapshot = await roomContext.store.getSnapshot();
    if (snapshot.room.status !== "active") {
      await socket.leave(roomCode);
      clearSocketRoom(socket);
      socket.emit("room_closed", {
        roomCode,
        adminUserName: snapshot.room.adminUserName,
        message: "This room is no longer active.",
      });
      await cleanupRoomContextIfUnused(roomCode);
      return null;
    }

    return { roomCode, roomContext, snapshot };
  }

  function interruptAnchorAudio(roomContext: RoomContext) {
    roomContext.currentAnchorAnnouncementId += 1;
    io.to(roomContext.roomCode).emit("anchor_audio_interrupted", {
      announcementId: roomContext.currentAnchorAnnouncementId,
      createdAt: Date.now(),
    });
    return roomContext.currentAnchorAnnouncementId;
  }

  function startAnchorSessionIfNeeded(roomContext: RoomContext) {
    if (roomContext.anchorLiveSessionPromise) return roomContext.anchorLiveSessionPromise;

    const newSessionPromise = getAI().live.connect({
      model: "gemini-2.5-flash-native-audio-preview-09-2025",
      callbacks: {
        onopen: () => {
          logToFile(`Anchor live session connected for ${roomContext.roomCode}`);
        },
        onmessage: (message: LiveServerMessage) => {
          if (message.serverContent?.modelTurn?.parts) {
            for (const part of message.serverContent.modelTurn.parts) {
              if (part.inlineData?.data) {
                io.to(roomContext.roomCode).emit("anchor_audio_response", {
                  announcementId: roomContext.anchorResponseAnnouncementId,
                  data: part.inlineData.data,
                  mimeType: part.inlineData.mimeType,
                });
              }
            }
          }
          if (message.serverContent?.interrupted) {
            io.to(roomContext.roomCode).emit("anchor_audio_interrupted", {
              announcementId: roomContext.anchorResponseAnnouncementId,
              createdAt: Date.now(),
            });
          }
        },
        onclose: () => {
          logToFile(`Anchor live session disconnected for ${roomContext.roomCode}`);
          if (roomContext.anchorLiveSessionPromise === newSessionPromise) {
            roomContext.anchorLiveSessionPromise = null;
          }
        },
        onerror: (error: any) => {
          console.error("Anchor live error:", error.message, error.error);
          io.to(roomContext.roomCode).emit("error", {
            message: `Anchor live error: ${error.message || error.error?.message || "Unknown error"}`,
          });
          if (roomContext.anchorLiveSessionPromise === newSessionPromise) {
            roomContext.anchorLiveSessionPromise = null;
          }
        },
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
        },
        systemInstruction: `You are the live anchor voice for "The Cognitive Swarm".
        Always respond in English only. Never switch to any other language.
        Speak exactly the requested host line with natural energy and clarity.
        Do not add greetings, explanations, or extra commentary.
        If interrupted, stop immediately.`,
      },
    });

    roomContext.anchorLiveSessionPromise = newSessionPromise;
    roomContext.anchorLiveSessionPromise.catch((error) => {
      console.error("Anchor live connect error:", error);
      if (roomContext.anchorLiveSessionPromise === newSessionPromise) {
        roomContext.anchorLiveSessionPromise = null;
      }
    });

    return roomContext.anchorLiveSessionPromise;
  }

  async function speakAnchorAnnouncement(roomContext: RoomContext, text: string) {
    const announcementId = interruptAnchorAudio(roomContext);
    roomContext.anchorResponseAnnouncementId = announcementId;
    const session = await startAnchorSessionIfNeeded(roomContext);
    await session.sendClientContent({
      turns: [
        {
          role: "user",
          parts: [{ text: `Say exactly this line, with playful host energy: ${text}` }],
        },
      ],
      turnComplete: true,
    });
    return announcementId;
  }

  async function findUntouchedDirection(snapshot: SessionSnapshot) {
    if (!snapshot.state.topic || snapshot.state.ideas.length === 0) {
      return null;
    }

    const response = await withTimeout(
      getAI().models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: `You are evaluating a live brainstorm.
      Topic: "${snapshot.state.topic}".
      Current phase: "${snapshot.state.phase}".
      Existing ideas with clusters: ${JSON.stringify(
        snapshot.state.ideas.map((idea) => ({
          text: idea.text,
          cluster: idea.cluster,
          weight: idea.weight,
        })),
      )}.

      Decide whether there is a meaningful direction, lens, or perspective that has not been touched yet.
      Return strict JSON with:
      - shouldSpeak: boolean
      - suggestion: string
      - rationale: string

      Rules:
      - shouldSpeak must be false if the current ideas already cover the main directions.
      - suggestion must be empty when shouldSpeak is false.
      - If shouldSpeak is true, suggestion must be a single direct spoken suggestion under 18 words.
      - Prefer materially different angles, not rephrasings of existing ideas.`,
        config: { responseMimeType: "application/json" },
      }),
      15000,
      "findUntouchedDirection",
    );

    const result = JSON.parse(response.text || "{}");
    if (!result.shouldSpeak || !result.suggestion) {
      return null;
    }

    return {
      suggestion: String(result.suggestion).trim(),
      rationale: String(result.rationale || "").trim(),
    };
  }

  async function forgeArtifactFromTopic(topic: string, ideas: ArtifactIdea[]) {
    const diagramType = inferDiagramType(topic, ideas);
    const diagramLabel = getDiagramLabel(diagramType);
    const summarizedIdeas = ideas
      .sort((left, right) => (right.weight || 0) - (left.weight || 0))
      .slice(0, 14)
      .map((idea) => ({
        cluster: idea.cluster || "General",
        text: idea.text,
        weight: idea.weight || 1,
      }));

    try {
      const response = await withTimeout(
        getAI().models.generateContent({
          model: "gemini-3.1-flash-lite-preview",
          contents: `You are a diagram synthesis agent.
        Topic: "${topic}".
        Chosen diagram type: "${diagramType}" (${diagramLabel}).
        Ideas: ${JSON.stringify(summarizedIdeas)}.

        Produce a Mermaid diagram that fits the topic, not a generic box-and-arrow tree.
        Return strict JSON with:
        - title: string
        - diagramType: string
        - mermaid: string

        Requirements:
        - diagramType must stay exactly "${diagramType}".
        - mermaid must start with the Mermaid syntax for ${diagramType}.
        - Use the topic semantics to choose the diagram structure.
        - Keep the diagram readable and under 18 meaningful nodes or entities.
        - Do not use markdown fences.
        - For erDiagram: create entities and relationships, not generic steps.
        - For flowchart: create steps, decisions, or transitions.
        - For classDiagram: create classes and relationships.
        - For mindmap: create a themed hierarchy.
        - For journey: create stages or moments of experience.`,
          config: { responseMimeType: "application/json" },
        }),
        20000,
        "forgeArtifactFromTopic",
      );

      const result = JSON.parse(response.text || "{}");
      const mermaid = String(result.mermaid || "").trim();
      const title = String(result.title || topic || diagramLabel).trim();
      const generatedType = String(result.diagramType || "").trim() as ArtifactDiagramType;

      if (generatedType !== diagramType || !mermaid || !mermaid.startsWith(diagramType)) {
        return buildFallbackArtifact(topic, ideas, diagramType);
      }

      return {
        diagramType,
        title,
        mermaid,
      };
    } catch (error) {
      console.error("Artifact generation failed, using fallback:", error);
      return buildFallbackArtifact(topic, ideas, diagramType);
    }
  }

  async function scheduleIdeaResearch(roomCode: string, ideaId: string, ideaText: string, authorId: string) {
    if (authorId.startsWith("agent-")) return;

    getAI()
      .models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Find a real-world article, data point, or example that validates or relates to this idea: "${ideaText}". Return a short 3-word summary of the finding.`,
        config: {
          tools: [{ googleSearch: {} }],
        },
      })
      .then(async (response) => {
        const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
        if (!chunks?.length) return;

        const firstChunk = chunks.find((chunk) => chunk.web?.uri);
        if (!firstChunk?.web?.uri) return;

        const roomContext = await getRoomContext(roomCode, false);
        if (!roomContext) return;
        const snapshot = await roomContext.store.getSnapshot();
        if (snapshot.room.status !== "active") return;

        const url = firstChunk.web.uri;
        const urlTitle = firstChunk.web.title || (response.text || "").substring(0, 30);
        const nextSnapshot = await roomContext.store.mutate((mutableSnapshot) => {
          const idea = mutableSnapshot.state.ideas.find((entry) => entry.id === ideaId);
          if (!idea) return;
          idea.url = url;
          idea.urlTitle = urlTitle;
        });

        if (nextSnapshot.state.ideas.some((idea) => idea.id === ideaId)) {
          io.to(roomCode).emit("idea_researched", { id: ideaId, url, urlTitle });
        }
      })
      .catch((error) => {
        console.error("Researcher error:", error);
        io.to(roomCode).emit("error", { message: `Researcher error: ${error.message}` });
      });
  }

  async function scheduleIdeaEmbedding(roomCode: string, ideaId: string, contents: string) {
    getAI()
      .models.embedContent({
        model: "gemini-embedding-001",
        contents,
      })
      .then(async (response) => {
        const embedding = response.embeddings?.[0]?.values;
        if (!embedding) return;

        const roomContext = await getRoomContext(roomCode, false);
        if (!roomContext) return;
        const snapshot = await roomContext.store.getSnapshot();
        if (snapshot.room.status !== "active") return;

        const targetPosition = projectTo3D(embedding);
        const nextSnapshot = await roomContext.store.mutate((mutableSnapshot) => {
          const idea = mutableSnapshot.state.ideas.find((entry) => entry.id === ideaId);
          if (!idea) return;
          idea.targetPosition = targetPosition;
        });

        if (nextSnapshot.state.ideas.some((idea) => idea.id === ideaId)) {
          io.to(roomCode).emit("idea_positioned", { id: ideaId, targetPosition });
        }
      })
      .catch((error) => {
        console.error("Embedding error:", error);
      });
  }

  async function addIdea(roomContext: RoomContext, params: {
    id?: string;
    text: string;
    cluster?: string;
    authorId: string;
    authorName: string;
    weight?: number;
    markContribution?: boolean;
  }) {
    const sanitizedText = sanitizeIdeaInput(params.text);
    if (!sanitizedText.valid) {
      return null;
    }

    const sanitizedCluster = sanitizeIdeaInput(params.cluster || "General", 100);
    const now = Date.now();
    const idea: IdeaRecord = {
      id: params.id || Math.random().toString(36).substring(2, 9),
      text: sanitizedText.text,
      weight: params.weight ?? 1,
      cluster: sanitizedCluster.text,
      authorId: params.authorId,
      authorName: params.authorName || "Anonymous Node",
      initialPosition: randomIdeaPosition(),
      targetPosition: null,
    };

    await roomContext.store.mutate((snapshot) => {
      enforceIdeaLimit(snapshot.state.ideas);
      snapshot.state.ideas.push(idea);
      snapshot.metadata.lastIdeaTime = now;
      if (params.markContribution !== false && !params.authorId.startsWith("agent-")) {
        markParticipantContribution(snapshot, params.authorId, params.authorName);
      }
    });

    io.to(roomContext.roomCode).emit("ideas_batch_added", [idea]);
    void scheduleIdeaResearch(roomContext.roomCode, idea.id, idea.text, idea.authorId);
    void scheduleIdeaEmbedding(roomContext.roomCode, idea.id, idea.text);
    return idea;
  }

  async function broadcastUntouchedDirection(roomCode: string, reason: SuggestionReason) {
    const roomContext = await getRoomContext(roomCode, false);
    if (!roomContext || roomContext.directionSuggestionInFlight) {
      return;
    }

    roomContext.directionSuggestionInFlight = true;
    try {
      const snapshot = await roomContext.store.getSnapshot();
      if (snapshot.room.status !== "active" || snapshot.state.phase !== "divergent") {
        return;
      }

      const now = Date.now();
      const quietNames = getQuietParticipantNamesForAnchor(snapshot, now);
      const audienceNudge = buildAudienceNudge({
        quietNames,
        praisedNames: getTopContributorNames(snapshot, 2),
      });

      let suggestion = "";
      let rationale = "";
      let kind: "direction" | "audience_nudge" = "direction";

      if (audienceNudge) {
        suggestion = audienceNudge.suggestion.trim();
        rationale = audienceNudge.rationale.trim();
        kind = "audience_nudge";
      } else {
        if (snapshot.state.ideas.length === 0) {
          return;
        }

        const untouchedDirection = await findUntouchedDirection(snapshot);
        if (!untouchedDirection) {
          return;
        }

        suggestion = untouchedDirection.suggestion.trim();
        rationale = untouchedDirection.rationale.trim();
      }

      let shouldBroadcast = true;
      await roomContext.store.mutate((nextSnapshot) => {
        if (
          shouldSkipRepeatedSuggestion({
            reason,
            suggestion,
            lastSuggestionKey: nextSnapshot.metadata.lastDirectionSuggestionKey,
            lastSuggestionTime: nextSnapshot.metadata.lastDirectionSuggestionTime,
            now,
          })
        ) {
          shouldBroadcast = false;
          return;
        }

        nextSnapshot.metadata.lastDirectionSuggestionTime = now;
        nextSnapshot.metadata.lastDirectionSuggestionKey = suggestion.toLowerCase();
      });

      if (!shouldBroadcast) {
        return;
      }

      io.to(roomCode).emit("direction_suggestion", {
        suggestion,
        rationale,
        reason,
        kind,
        createdAt: now,
      });
      await speakAnchorAnnouncement(roomContext, suggestion);
    } catch (error: any) {
      console.error("Error finding untouched direction:", error);
      logToFile(`Error finding untouched direction: ${error.message}`);
    } finally {
      roomContext.directionSuggestionInFlight = false;
    }
  }

  async function runSynthesizer(roomCode: string) {
    const roomContext = await getRoomContext(roomCode, false);
    if (!roomContext) return;

    const snapshot = await roomContext.store.getSnapshot();
    if (
      snapshot.room.status !== "active" ||
      !snapshot.state.topic ||
      Object.keys(snapshot.participants).length === 0 ||
      snapshot.state.ideas.length <= 3
    ) {
      return;
    }

    try {
      const response = await withTimeout(
        getAI().models.generateContent({
          model: "gemini-3.1-flash-lite-preview",
          contents: `Here are the current ideas: ${JSON.stringify(
            snapshot.state.ideas.map((idea) => ({ id: idea.id, text: idea.text })),
          )}.
          Find 1-2 strong connections between existing ideas that aren't obvious.
          Return a JSON array of objects with 'sourceId', 'targetId', and 'reason'.`,
          config: { responseMimeType: "application/json" },
        }),
        15000,
        "synthesizer",
      );

      const newEdges = JSON.parse(response.text || "[]");
      let changed = false;
      const nextSnapshot = await roomContext.store.mutate((mutableSnapshot) => {
        if (!Array.isArray(newEdges)) {
          return;
        }

        for (const edge of newEdges) {
          if (!edge?.sourceId || !edge?.targetId) continue;
          const exists = mutableSnapshot.state.edges.some(
            (existing) => existing.source === edge.sourceId && existing.target === edge.targetId,
          );
          if (exists) continue;

          mutableSnapshot.state.edges.push({
            source: edge.sourceId,
            target: edge.targetId,
            reason: edge.reason,
          });
          changed = true;
        }

        if (mutableSnapshot.state.edges.length > 100) {
          mutableSnapshot.state.edges = mutableSnapshot.state.edges.slice(-100);
          changed = true;
        }
      });

      if (changed) {
        io.to(roomCode).emit("edges_updated", nextSnapshot.state.edges);
      }
    } catch (error: any) {
      console.error("Synthesizer error:", error);
      io.to(roomCode).emit("error", { message: `Synthesizer error: ${error.message}` });
    }
  }

  async function runDevilsAdvocate(roomCode: string) {
    const roomContext = await getRoomContext(roomCode, false);
    if (!roomContext) return;

    const snapshot = await roomContext.store.getSnapshot();
    if (
      snapshot.room.status !== "active" ||
      !snapshot.state.topic ||
      Object.keys(snapshot.participants).length === 0 ||
      snapshot.state.ideas.length <= 5
    ) {
      return;
    }

    try {
      const response = await withTimeout(
        getAI().models.generateContent({
          model: "gemini-3.1-flash-lite-preview",
          contents: `The current brainstorming topic is: "${snapshot.state.topic}".
          Here are the current ideas: ${JSON.stringify(snapshot.state.ideas.map((idea) => idea.text))}.
          Act as a Devil's Advocate. Find a blind spot, contradiction, or critical flaw in the current ideas.
          Generate ONE challenging question or counter-argument. Keep it to 5-10 words.
          Return JSON with 'idea' and 'category' (use "Critique" as category).`,
          config: { responseMimeType: "application/json" },
        }),
        15000,
        "devilsAdvocate",
      );

      const result = JSON.parse(response.text || "{}");
      if (!result.idea) return;

      await addIdea(roomContext, {
        text: result.idea,
        cluster: result.category || "Critique",
        authorId: "agent-critic",
        authorName: "Devil's Advocate",
        weight: 1.5,
        markContribution: false,
      });
    } catch (error: any) {
      console.error("Devil's Advocate error:", error);
      io.to(roomCode).emit("error", { message: `Devil's Advocate error: ${error.message}` });
    }
  }

  function enableRoomRuntime(roomContext: RoomContext) {
    if (roomContext.runtimeEnabled) {
      return;
    }

    roomContext.runtimeEnabled = true;
    roomContext.synthesizerInterval = setInterval(() => {
      void runSynthesizer(roomContext.roomCode);
    }, 45000);

    roomContext.criticInterval = setInterval(() => {
      void runDevilsAdvocate(roomContext.roomCode);
    }, 90000);

    roomContext.suggestionInterval = setInterval(async () => {
      const snapshot = await roomContext.store.getSnapshot();
      if (
        shouldAutoBroadcastSuggestion({
          phase: snapshot.state.phase,
          ideaCount: snapshot.state.ideas.length,
          quietParticipantCount: getQuietParticipantNamesForAnchor(snapshot, Date.now()).length,
          lastIdeaTime: snapshot.metadata.lastIdeaTime,
          lastDirectionSuggestionTime: snapshot.metadata.lastDirectionSuggestionTime,
          now: Date.now(),
        })
      ) {
        void broadcastUntouchedDirection(roomContext.roomCode, "auto");
      }
    }, 5000);
  }

  async function closeRoom(roomCode: string, message = "The admin closed this room.") {
    const roomContext = await getRoomContext(roomCode, false);
    if (!roomContext) {
      return;
    }

    const snapshot = await roomContext.store.getSnapshot();
    if (snapshot.room.status === "closed") {
      await cleanupRoomContextIfUnused(roomCode);
      return;
    }

    await roomContext.store.mutate((mutableSnapshot) => {
      mutableSnapshot.room.status = "closed";
      mutableSnapshot.participants = {};
    });

    io.to(roomCode).emit("room_closed", {
      roomCode,
      adminUserName: snapshot.room.adminUserName,
      message,
    });

    for (const localSocket of getLocalSocketsForRoom(roomCode)) {
      await localSocket.leave(roomCode);
      clearSocketRoom(localSocket);
    }

    await cleanupRoomContextIfUnused(roomCode);
  }

  async function leaveRoom(socket: any, options: { silent?: boolean; reason?: string } = {}) {
    const roomCode = socket.data.roomCode as string | undefined;
    if (!roomCode) {
      return;
    }

    const role = socket.data.role as UserRole | undefined;
    await socket.leave(roomCode);

    const roomContext = await getRoomContext(roomCode, false);
    if (roomContext) {
      const snapshot = await roomContext.store.getSnapshot();
      if (snapshot.room.status === "active") {
        if (role === "admin" && snapshot.room.adminSocketId === socket.id) {
          await closeRoom(roomCode, options.reason || "The admin left the room.");
        } else {
          await roomContext.store.removeParticipant(socket.id);
        }
      }
    }

    clearSocketRoom(socket);
    if (!options.silent) {
      socket.emit("room_left", { roomCode });
    }
    await cleanupRoomContextIfUnused(roomCode);
  }

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    let liveSessionPromise: Promise<any> | null = null;
    let audioActive = false;
    let videoActive = false;
    let audioStreamStarted = false;
    let pendingSessionClose: NodeJS.Timeout | null = null;
    let pendingAudioChunks: string[] = [];
    let audioChunkCount = 0;

    const clearPendingSessionClose = () => {
      if (pendingSessionClose) {
        clearTimeout(pendingSessionClose);
        pendingSessionClose = null;
      }
    };

    const scheduleSessionClose = (delayMs = 5000) => {
      clearPendingSessionClose();
      pendingSessionClose = setTimeout(() => {
        pendingSessionClose = null;
        if (!audioActive && !videoActive && liveSessionPromise) {
          liveSessionPromise.then((session) => session.close()).catch((error) => console.error(error));
          liveSessionPromise = null;
        }
      }, delayMs);
    };

    const stopSessionIfNeeded = () => {
      clearPendingSessionClose();
      if (!audioActive && !videoActive && liveSessionPromise) {
        liveSessionPromise.then((session) => session.close()).catch((error) => console.error(error));
        liveSessionPromise = null;
      }
    };

    const startSessionIfNeeded = async () => {
      if (liveSessionPromise) return;

      const activeRoom = await getActiveRoom(socket);
      if (!activeRoom) return;

      const currentTopic = activeRoom.snapshot.state.topic || "Brainstorming Session";
      const currentUserName = String(socket.data.userName || "").trim() || "Anonymous Node";
      const roomCode = activeRoom.roomCode;

      const newSessionPromise = getAI().live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        callbacks: {
          onopen: () => {
            console.log("Gemini Live Connected for", socket.id);
            logToFile(`Gemini Live Connected for ${socket.id}`);
            socket.emit("audio_session_started");
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.modelTurn?.parts) {
              logToFile(`Received modelTurn: ${JSON.stringify(message.serverContent.modelTurn).substring(0, 200)}`);
              for (const part of message.serverContent.modelTurn.parts) {
                emitInlineAudio(socket, "audio_response", part.inlineData);
              }
            }

            if (message.serverContent?.interrupted) {
              logToFile("Received interrupted from Gemini");
              socket.emit("audio_interrupted");
            }

            if (!message.toolCall?.functionCalls) {
              return;
            }

            logToFile(`Received toolCall: ${JSON.stringify(message.toolCall)}`);
            const functionResponses: any[] = [];

            for (const call of message.toolCall.functionCalls) {
              logToFile(`Processing function call: ${call.name} ${JSON.stringify(call.args)}`);

              if (call.name === "extractIdea") {
                const args = call.args as { idea?: string; category?: string };
                const roomContext = await getRoomContext(roomCode, false);
                const addedIdea = roomContext
                  ? await addIdea(roomContext, {
                      text: args.idea || "",
                      cluster: args.category || "General",
                      authorId: socket.id,
                      authorName: currentUserName,
                    })
                  : null;

                functionResponses.push({
                  id: call.id,
                  name: call.name,
                  response: {
                    result: addedIdea ? "Idea extracted successfully" : "Idea extraction skipped",
                  },
                });
              } else if (call.name === "generateMermaid") {
                const args = call.args as { code?: string };
                io.to(roomCode).emit("update_mermaid", args.code);
                functionResponses.push({
                  id: call.id,
                  name: call.name,
                  response: { result: "Mermaid diagram generated successfully" },
                });
              } else if (call.name === "getIdeas") {
                const roomContext = await getRoomContext(roomCode, false);
                const snapshot = roomContext ? await roomContext.store.getSnapshot() : null;
                functionResponses.push({
                  id: call.id,
                  name: call.name,
                  response: {
                    ideas: snapshot?.state.ideas.map((idea) => ({
                      text: idea.text,
                      cluster: idea.cluster,
                      weight: idea.weight,
                    })) || [],
                  },
                });
              } else if (call.name === "getSessionSnapshot") {
                const roomContext = await getRoomContext(roomCode, false);
                const snapshot = roomContext ? await roomContext.store.getSnapshot() : null;
                functionResponses.push({
                  id: call.id,
                  name: call.name,
                  response: snapshot ? buildSessionSummary(snapshot) : {},
                });
              }
            }

            if (liveSessionPromise) {
              liveSessionPromise
                .then((session) => session.sendToolResponse({ functionResponses }))
                .catch((error) => console.error("Error sending tool response:", error));
            }
          },
          onclose: (event) => {
            console.log("Gemini Live Disconnected for", socket.id, "Code:", event?.code, "Reason:", event?.reason);
            logToFile(`Gemini Live Disconnected for ${socket.id} Code: ${event?.code} Reason: ${event?.reason}`);
            socket.emit("audio_session_closed");
            if (liveSessionPromise === newSessionPromise) {
              liveSessionPromise = null;
            }
          },
          onerror: (error: any) => {
            console.error("Gemini Live Error for", socket.id, error.message, error.error);
            logToFile(
              `Gemini Live Error for ${socket.id}: ${error.message} - ${error.error ? error.error.message : ""}`,
            );
            socket.emit("error", {
              message: `Gemini Live Error: ${error.message || error.error?.message || "Unknown error"}`,
            });
            if (liveSessionPromise === newSessionPromise) {
              liveSessionPromise = null;
            }
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: `You are the playful live anchor of "The Cognitive Swarm".
          Topic: "${currentTopic}". Current speaker: ${currentUserName}.

          LANGUAGE RULE: Always respond in English only, regardless of the language or accent of the speaker. Never switch to any other language.

          Your job:
          - Keep the room energized like a smart emcee.
          - Answer topic-related questions clearly and conversationally.
          - Appreciate strong contributors by name when useful.
          - Invite quieter participants in warmly, never harshly.
          - Use light, clean jokes or witty one-liners occasionally when it fits.
          - Keep answers short by default: usually 1-3 sentences.

          Behavioral rules:
          - If the user shares a new idea, you MUST use the 'extractIdea' tool.
          - If the user asks about the session, contributors, current thinking, or asks for a topical answer grounded in the brainstorm, call 'getSessionSnapshot' first.
          - If asked to summarize or diagram, use 'getIdeas' and then 'generateMermaid' when needed.
          - If praising contributors or inviting quiet participants, use names from the session tools rather than inventing them.
          - Be playful, but do not roast or embarrass people.
          - If interrupted, stop immediately and let the speaker take the floor.`,
          tools: [
            {
              functionDeclarations: [
                {
                  name: "extractIdea",
                  description: "Extracts a brainstorming idea from the user audio.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      idea: { type: Type.STRING, description: "A concise, 3-7 word summary of the idea." },
                      category: { type: Type.STRING, description: "A 1-2 word category or cluster name." },
                    },
                    required: ["idea", "category"],
                  },
                },
                {
                  name: "generateMermaid",
                  description: "Generates a Mermaid.js diagram based on the current ideas.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      code: { type: Type.STRING, description: "The raw Mermaid.js code (e.g., graph TD; A-->B;)." },
                    },
                    required: ["code"],
                  },
                },
                {
                  name: "getIdeas",
                  description: "Gets the current list of brainstormed ideas and their weights.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      format: { type: Type.STRING, description: 'The format to return (e.g., "json").' },
                    },
                  },
                },
                {
                  name: "getSessionSnapshot",
                  description: "Gets the current topic, phase, recent ideas, top contributors, and quieter participants.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      detailLevel: {
                        type: Type.STRING,
                        description: 'Optional level of detail, such as "brief" or "full".',
                      },
                    },
                  },
                },
              ],
            },
          ],
        },
      });

      liveSessionPromise = newSessionPromise;
      liveSessionPromise.catch((error) => {
        console.error("Live session connect error:", error);
        logToFile(`Live session connect error: ${error.message}`);
        socket.emit("error", { message: `Live session connect error: ${error.message}` });
        if (liveSessionPromise === newSessionPromise) {
          liveSessionPromise = null;
        }
      });
    };

    socket.on("create_room", async (data: { userName: string; topic: string }) => {
      const userName = data.userName?.trim();
      const topic = data.topic?.trim();
      if (!userName || !topic) {
        socket.emit("room_error", { message: "Display name and topic are required to create a room." });
        return;
      }

      if (socket.data.roomCode) {
        await leaveRoom(socket, { silent: true, reason: "The admin left the room." });
      }

      try {
        const roomCode = await allocateRoomCode();
        const roomContext = await getRoomContext(roomCode, true);
        if (!roomContext) {
          socket.emit("room_error", { message: "Failed to create the room." });
          return;
        }

        const snapshot = await roomContext.store.mutate((mutableSnapshot) => {
          mutableSnapshot.room.code = roomCode;
          mutableSnapshot.room.adminSocketId = socket.id;
          mutableSnapshot.room.adminUserName = userName;
          mutableSnapshot.room.status = "active";
          mutableSnapshot.state.topic = topic;
          mutableSnapshot.state.phase = "divergent";
          upsertParticipantRecord(mutableSnapshot, socket.id, userName, "admin");
        });

        socket.data.roomCode = roomCode;
        socket.data.role = "admin";
        socket.data.userName = userName;
        await socket.join(roomCode);
        enableRoomRuntime(roomContext);

        socket.emit("room_created", {
          roomCode,
          adminUserName: snapshot.room.adminUserName,
        });
        await emitStateSync(socket, roomContext);
      } catch (error: any) {
        socket.emit("room_error", { message: error.message || "Unable to create room." });
      }
    });

    socket.on("join_room", async (data: { roomCode: string; userName: string }) => {
      const userName = data.userName?.trim();
      const roomCode = normalizeRoomCode(data.roomCode || "");
      if (!userName || !roomCode) {
        socket.emit("room_error", { message: "Display name and room code are required." });
        return;
      }
      if (!isValidRoomCode(roomCode)) {
        socket.emit("room_error", { message: "Enter a valid 6-character room code." });
        return;
      }

      if (socket.data.roomCode) {
        await leaveRoom(socket, { silent: true });
      }

      const roomContext = await getRoomContext(roomCode, false);
      if (!roomContext) {
        socket.emit("room_error", { message: "Room not found." });
        return;
      }

      const currentSnapshot = await roomContext.store.getSnapshot();
      if (currentSnapshot.room.status !== "active") {
        socket.emit("room_error", { message: "That room is closed." });
        await cleanupRoomContextIfUnused(roomCode);
        return;
      }

      await roomContext.store.mutate((mutableSnapshot) => {
        upsertParticipantRecord(mutableSnapshot, socket.id, userName, "participant");
      });

      socket.data.roomCode = roomCode;
      socket.data.role = "participant";
      socket.data.userName = userName;
      await socket.join(roomCode);

      socket.emit("room_joined", {
        roomCode,
        adminUserName: currentSnapshot.room.adminUserName,
      });
      await emitStateSync(socket, roomContext);
    });

    socket.on("leave_room", async () => {
      await leaveRoom(socket);
    });

    socket.on("close_room", async () => {
      const activeRoom = await getActiveRoom(socket);
      if (!activeRoom) return;
      if (!isAdmin(activeRoom.snapshot.participants[socket.id])) {
        socket.emit("room_error", { message: "Only the admin can close the room." });
        return;
      }
      await closeRoom(activeRoom.roomCode, "The admin closed this room.");
    });

    socket.on("register_participant", async (data: { userName: string; role: UserRole }) => {
      const activeRoom = await getActiveRoom(socket);
      if (!activeRoom) return;
      const participant = await activeRoom.roomContext.store.mutate((mutableSnapshot) => {
        upsertParticipantRecord(
          mutableSnapshot,
          socket.id,
          data.userName || String(socket.data.userName || ""),
          socket.data.role || data.role,
        );
      });

      const currentParticipant = participant.participants[socket.id];
      if (currentParticipant) {
        socket.emit("credits_updated", { credits: currentParticipant.credits, votes: currentParticipant.votes });
      }
    });

    socket.on("interrupt_anchor", async () => {
      const activeRoom = await getActiveRoom(socket);
      if (!activeRoom) return;
      interruptAnchorAudio(activeRoom.roomContext);
    });

    socket.on("start_audio_session", async () => {
      const activeRoom = await getActiveRoom(socket);
      if (!activeRoom) return;
      logToFile(`start_audio_session received for ${socket.id}`);
      audioActive = true;
      audioStreamStarted = false;
      clearPendingSessionClose();
      interruptAnchorAudio(activeRoom.roomContext);
      await activeRoom.roomContext.store.mutate((mutableSnapshot) => {
        upsertParticipantRecord(
          mutableSnapshot,
          socket.id,
          String(socket.data.userName || "Anonymous Node"),
          (socket.data.role || "participant") as UserRole,
        );
      });
      await startSessionIfNeeded();
    });

    socket.on("stop_audio_session", () => {
      logToFile(`stop_audio_session received for ${socket.id}`);
      audioActive = false;
      if (liveSessionPromise && audioStreamStarted) {
        liveSessionPromise
          .then((session) => {
            logToFile(`Sending audioStreamEnd for ${socket.id}`);
            session.sendRealtimeInput({ audioStreamEnd: true });
          })
          .catch((error) => {
            console.error("Error sending audio stream end:", error);
            logToFile(`Error sending audio stream end: ${error.message}`);
          });
        scheduleSessionClose();
      } else {
        stopSessionIfNeeded();
      }
    });

    socket.on("suggest_direction", async () => {
      const activeRoom = await getActiveRoom(socket);
      if (!activeRoom) return;
      if (!isAdmin(activeRoom.snapshot.participants[socket.id])) {
        socket.emit("room_error", { message: "Only the admin can cue the anchor." });
        return;
      }
      logToFile(`suggest_direction received for ${socket.id}`);
      void broadcastUntouchedDirection(activeRoom.roomCode, "manual");
    });

    socket.on("start_video_session", async () => {
      const activeRoom = await getActiveRoom(socket);
      if (!activeRoom) return;
      videoActive = true;
      clearPendingSessionClose();
      await activeRoom.roomContext.store.mutate((mutableSnapshot) => {
        upsertParticipantRecord(
          mutableSnapshot,
          socket.id,
          String(socket.data.userName || "Anonymous Node"),
          (socket.data.role || "participant") as UserRole,
        );
      });
      await startSessionIfNeeded();
    });

    socket.on("stop_video_session", () => {
      videoActive = false;
      stopSessionIfNeeded();
    });

    socket.on("text_chunk", async (text: string) => {
      const activeRoom = await getActiveRoom(socket);
      if (!activeRoom) return;
      logToFile(`Received text chunk: ${text}`);
      interruptAnchorAudio(activeRoom.roomContext);
      if (liveSessionPromise) {
        liveSessionPromise
          .then((session) => {
            session.sendClientContent({
              turns: [{ role: "user", parts: [{ text }] }],
              turnComplete: true,
            });
          })
          .catch((error) => {
            console.error("Error sending text chunk:", error);
            logToFile(`Error sending text chunk: ${error.message}`);
          });
      }
    });

    socket.on("audio_chunk", async (base64Data: string) => {
      const activeRoom = await getActiveRoom(socket);
      if (!activeRoom) return;
      audioChunkCount += 1;
      audioStreamStarted = true;
      clearPendingSessionClose();

      if (audioChunkCount % 10 === 0) {
        logToFile(`Received 10 audio chunks from ${socket.id}`);
      }

      if (liveSessionPromise) {
        const buffered = pendingAudioChunks;
        pendingAudioChunks = [];
        liveSessionPromise
          .then((session) => {
            for (const chunk of buffered) {
              session.sendRealtimeInput({ audio: { data: chunk, mimeType: "audio/pcm;rate=16000" } });
            }
            session.sendRealtimeInput({
              audio: { data: base64Data, mimeType: "audio/pcm;rate=16000" },
            });
          })
          .catch((error) => {
            pendingAudioChunks = [...buffered, base64Data, ...pendingAudioChunks].slice(0, 50);
            console.error("Error sending audio chunk:", error);
            logToFile(`Error sending audio chunk, re-queued: ${error.message}`);
          });
      } else if (pendingAudioChunks.length < 50) {
        pendingAudioChunks.push(base64Data);
      }
    });

    socket.on("video_chunk", async (base64Data: string) => {
      const activeRoom = await getActiveRoom(socket);
      if (!activeRoom) return;
      clearPendingSessionClose();
      if (liveSessionPromise) {
        liveSessionPromise
          .then((session) => {
            session.sendRealtimeInput({
              video: { data: base64Data, mimeType: "image/jpeg" },
            });
          })
          .catch((error) => {
            console.error("Error sending video chunk:", error);
            logToFile(`Error sending video chunk: ${error.message}`);
          });
      }
    });

    socket.on("set_topic", async (topic: string) => {
      const activeRoom = await getActiveRoom(socket);
      if (!activeRoom) return;
      if (!isAdmin(activeRoom.snapshot.participants[socket.id])) return;
      if (typeof topic !== "string" || !topic.trim()) return;

      const nextSnapshot = await activeRoom.roomContext.store.mutate((mutableSnapshot) => {
        mutableSnapshot.state.topic = topic.trim();
      });
      io.to(activeRoom.roomCode).emit("topic_updated", nextSnapshot.state.topic);
    });

    socket.on("add_idea", async (idea: { id?: string; text: string; cluster: string; authorName?: string }) => {
      const activeRoom = await getActiveRoom(socket);
      if (!activeRoom) return;
      await addIdea(activeRoom.roomContext, {
        id: idea.id,
        text: idea.text,
        cluster: idea.cluster,
        authorId: socket.id,
        authorName: idea.authorName || String(socket.data.userName || "Anonymous Node"),
      });
    });

    socket.on("update_idea_embedding", async (data: { id: string; embedding: number[] }) => {
      const activeRoom = await getActiveRoom(socket);
      if (!activeRoom) return;
      const targetPosition = projectTo3D(data.embedding);
      const snapshot = await activeRoom.roomContext.store.mutate((mutableSnapshot) => {
        const idea = mutableSnapshot.state.ideas.find((entry) => entry.id === data.id);
        if (!idea) return;
        idea.targetPosition = targetPosition;
      });

      if (snapshot.state.ideas.some((idea) => idea.id === data.id)) {
        io.to(activeRoom.roomCode).emit("idea_positioned", { id: data.id, targetPosition });
      }
    });

    socket.on("update_idea_weight", async (data: { ideaId: string; weightChange: number }) => {
      const activeRoom = await getActiveRoom(socket);
      if (!activeRoom) return;
      let updatedWeight: number | null = null;
      let creditsPayload: { credits: number; votes: Record<string, number> } | null = null;

      await activeRoom.roomContext.store.mutate((snapshot) => {
        const participant = snapshot.participants[socket.id];
        if (!participant) return;

        const idea = snapshot.state.ideas.find((entry) => entry.id === data.ideaId);
        if (!idea) return;

        const currentVotes = participant.votes[data.ideaId] || 0;
        const result = validateVote({
          currentVotes,
          credits: participant.credits,
          delta: data.weightChange,
        });
        if (!result.allowed) return;

        participant.credits -= result.cost;
        participant.votes[data.ideaId] = result.newVotes;
        idea.weight = Math.max(0, (idea.weight || 0) + data.weightChange);

        creditsPayload = { credits: participant.credits, votes: participant.votes };
        updatedWeight = idea.weight;
      });

      if (!creditsPayload || updatedWeight === null) return;
      socket.emit("credits_updated", creditsPayload);
      io.to(activeRoom.roomCode).emit("idea_weight_updated", { ideaId: data.ideaId, weight: updatedWeight });
      io.to(activeRoom.roomCode).emit("ideas_batch_updated", [{ id: data.ideaId, weight: updatedWeight }]);
    });

    socket.on("edit_idea", async (data: { id: string; text: string; cluster: string; textChanged?: boolean }) => {
      const activeRoom = await getActiveRoom(socket);
      if (!activeRoom) return;
      const sanitizedText = sanitizeIdeaInput(data.text);
      if (!sanitizedText.valid) return;
      const sanitizedCluster = sanitizeIdeaInput(data.cluster || "General", 100);

      let updatedIdea: IdeaRecord | null = null;
      const snapshot = await activeRoom.roomContext.store.mutate((mutableSnapshot) => {
        const idea = mutableSnapshot.state.ideas.find((entry) => entry.id === data.id);
        if (!idea) return;

        idea.text = sanitizedText.text;
        idea.cluster = sanitizedCluster.text;
        updatedIdea = { ...idea };
      });

      if (!snapshot.state.ideas.some((idea) => idea.id === data.id) || !updatedIdea) return;
      io.to(activeRoom.roomCode).emit("ideas_batch_updated", [updatedIdea]);

      if (data.textChanged) {
        void scheduleIdeaEmbedding(activeRoom.roomCode, data.id, sanitizedText.text);
      }
    });

    socket.on("update_flow", async (data: { nodes: any[]; edges: any[] }) => {
      const activeRoom = await getActiveRoom(socket);
      if (!activeRoom) return;
      const snapshot = await activeRoom.roomContext.store.mutate((mutableSnapshot) => {
        mutableSnapshot.state.flowData = data;
      });
      io.to(activeRoom.roomCode).emit("flow_updated", snapshot.state.flowData);
    });

    socket.on("forge_artifact", async () => {
      const activeRoom = await getActiveRoom(socket);
      if (!activeRoom) return;
      try {
        const artifact = await forgeArtifactFromTopic(
          activeRoom.snapshot.state.topic || "Brainstorming Session",
          activeRoom.snapshot.state.ideas.map((idea) => ({
            text: idea.text,
            cluster: idea.cluster,
            weight: idea.weight,
          })),
        );
        await activeRoom.roomContext.store.mutate((mutableSnapshot) => {
          mutableSnapshot.state.artifactData = artifact;
        });
        io.to(activeRoom.roomCode).emit("artifact_updated", artifact);
      } catch (error: any) {
        console.error("Artifact forge failed:", error);
        socket.emit("error", { message: error.message || "Failed to forge topic-aware artifact." });
      }
    });

    socket.on("set_phase", async (phase: string) => {
      const activeRoom = await getActiveRoom(socket);
      if (!activeRoom) return;
      if (!isAdmin(activeRoom.snapshot.participants[socket.id])) return;
      if (!isValidPhase(phase)) return;

      const nextSnapshot = await activeRoom.roomContext.store.mutate((mutableSnapshot) => {
        mutableSnapshot.state.phase = phase;
      });
      io.to(activeRoom.roomCode).emit("phase_changed", nextSnapshot.state.phase);
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
      clearPendingSessionClose();
      stopSessionIfNeeded();
      void leaveRoom(socket, { silent: true, reason: "The admin left the room." });
    });
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/ready", async (_req, res) => {
    const defaultStore = new SessionStore(deploymentConfig, { createIfMissing: false });
    await defaultStore.init();
    const status = defaultStore.getStatus();
    await defaultStore.close();
    res.status(status.ready ? 200 : 503).json({
      status: status.ready ? "ok" : "degraded",
      storage: status.storage,
      durablePersistence: status.durablePersistence,
      details: status.details,
    });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host,
        hmr: {
          host,
        },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
    app.use((req, res, next) => {
      if (req.method !== "GET") return next();
      if (req.path.startsWith("/api") || req.path.startsWith("/socket.io") || req.path.startsWith("/@vite")) {
        return next();
      }
      if (req.path.includes(".") && !req.path.endsWith(".html")) {
        return next();
      }

      res.type("html").send(buildDevSpaHtml());
    });
  } else {
    app.use(express.static("dist"));
    app.get("*", (_req, res) => {
      res.sendFile(path.resolve(process.cwd(), "dist", "index.html"));
    });
  }

  const shutdown = async () => {
    await Promise.allSettled(
      Array.from(roomContexts.values()).map(async (roomContext) => {
        if (roomContext.anchorLiveSessionPromise) {
          await roomContext.anchorLiveSessionPromise.then((session) => session.close()).catch(() => undefined);
        }
        await roomContext.store.close();
      }),
    );
    await Promise.allSettled(shutdownClients.map((client) => client.quit()));
    server.close();
  };

  process.on("SIGTERM", () => {
    void shutdown();
  });
  process.on("SIGINT", () => {
    void shutdown();
  });

  server.listen(port, host, () => {
    console.log(`Server running on http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
  });
}

await startServer();
