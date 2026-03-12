import express from "express";
import { createServer as createViteServer } from "vite";
import { Server } from "socket.io";
import http from "http";
import { GoogleGenAI, Type, LiveServerMessage, Modality } from "@google/genai";
import path from "path";
import dotenv from "dotenv";
import {
  buildAudienceNudge,
  buildDevSpaHtml,
  dedupeById,
  getQuietParticipantNames,
  shouldAutoBroadcastSuggestion,
  shouldSkipRepeatedSuggestion,
} from "./src/utils/swarmPolicy.ts";
import { buildFallbackArtifact, getDiagramLabel, inferDiagramType } from "./src/utils/artifactPolicy.ts";
import type { ArtifactDiagramType, ArtifactIdea } from "./src/utils/artifactPolicy.ts";
import { isAdmin, isValidPhase, INITIAL_CREDITS, validateVote, sanitizeIdeaInput } from './src/utils/serverGuards.ts';

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

function logToFile(_msg: string) {}

function emitInlineAudio(
  target: { emit: (eventName: string, payload: any) => boolean },
  eventName: string,
  inlineData?: { data?: string; mimeType?: string | null }
) {
  if (!inlineData?.data) return;
  target.emit(eventName, {
    data: inlineData.data,
    mimeType: inlineData.mimeType,
  });
}

function getAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("No API key found in environment variables. Initializing without explicit key.");
    return new GoogleGenAI({});
  }
  console.log("Initializing GoogleGenAI with API key of length:", apiKey.length);
  logToFile("Initializing GoogleGenAI with API key of length: " + apiKey.length);
  return new GoogleGenAI({ apiKey });
}

// Generate a fixed random projection matrix (3 x 768) to map embeddings to 3D space
const projectionMatrix = Array.from({ length: 3 }, () =>
  Array.from({ length: 3072 }, () => (Math.random() - 0.5) * 2)
);

function projectTo3D(embedding: number[]): [number, number, number] {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < embedding.length; i++) {
    x += embedding[i] * projectionMatrix[0][i];
    y += embedding[i] * projectionMatrix[1][i];
    z += embedding[i] * projectionMatrix[2][i];
  }
  // Normalize and scale to fit visual space
  const mag = Math.sqrt(x * x + y * y + z * z);
  if (mag === 0) return [0, 0, 0];
  const scale = 12; // Spread radius
  return [(x / mag) * scale, (y / mag) * scale, (z / mag) * scale];
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3001);
  
  console.log("Server starting. GEMINI_API_KEY is", process.env.GEMINI_API_KEY ? "SET" : "NOT SET");
  logToFile("Server starting. GEMINI_API_KEY is " + (process.env.GEMINI_API_KEY ? "SET" : "NOT SET"));
  
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const MAX_IDEAS = 200;

  // Global State for the Swarm
  let state = {
    topic: '',
    phase: 'divergent', // 'divergent' | 'convergent' | 'forging'
    ideas: [] as any[],
    edges: [] as any[],
    flowData: { nodes: [], edges: [] } as { nodes: any[], edges: any[] },
    artifactData: null as null | { diagramType: ArtifactDiagramType; title: string; mermaid: string },
  };

  let pendingIdeas: any[] = [];
  let pendingUpdates: any[] = [];
  const participants = new Map<string, {
    socketId: string;
    userName: string;
    role: 'admin' | 'participant';
    joinedAt: number;
    contributionCount: number;
    lastContributionAt: number | null;
    credits: number;
    votes: Record<string, number>;
  }>();

  let lastIdeaTime = Date.now();
  let lastDirectionSuggestionTime = 0;
  let lastDirectionSuggestionKey = "";
  let directionSuggestionInFlight = false;
  let anchorLiveSessionPromise: Promise<any> | null = null;
  let currentAnchorAnnouncementId = 0;
  let anchorResponseAnnouncementId = 0;

  function upsertParticipant(socketId: string, userName: string, role: 'admin' | 'participant' = 'participant') {
    const cleanedName = userName.trim();
    if (!cleanedName) {
      return participants.get(socketId) || null;
    }

    const now = Date.now();
    const existing = participants.get(socketId);
    const participant = {
      socketId,
      userName: cleanedName,
      role,
      joinedAt: existing?.joinedAt ?? now,
      contributionCount: existing?.contributionCount ?? 0,
      lastContributionAt: existing?.lastContributionAt ?? null,
      credits: existing?.credits ?? INITIAL_CREDITS,
      votes: existing?.votes ?? {},
    };

    participants.set(socketId, participant);
    lastIdeaTime = now;
    return participant;
  }

  function markParticipantContribution(socketId: string, fallbackName?: string) {
    const now = Date.now();
    const existing = participants.get(socketId);
    const participant = {
      socketId,
      userName: existing?.userName || fallbackName?.trim() || 'Anonymous Node',
      role: existing?.role || 'participant',
      joinedAt: existing?.joinedAt ?? now,
      contributionCount: (existing?.contributionCount ?? 0) + 1,
      lastContributionAt: now,
      credits: existing?.credits ?? INITIAL_CREDITS,
      votes: existing?.votes ?? {},
    };

    participants.set(socketId, participant);
    lastIdeaTime = now;
    return participant;
  }

  function getQuietParticipantNamesForAnchor(now: number) {
    return getQuietParticipantNames({
      participants: Array.from(participants.values()).map((participant) => ({
        name: participant.userName,
        joinedAt: participant.joinedAt,
        contributionCount: participant.contributionCount,
        role: participant.role,
      })),
      now,
      maxNames: 6,
    });
  }

  function getTopContributorNames(maxNames = 2) {
    const contributorScores = new Map<string, number>();

    for (const idea of state.ideas) {
      if (!idea.authorName || idea.authorId?.startsWith('agent-')) continue;
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

  function getSessionSnapshot() {
    return {
      topic: state.topic,
      phase: state.phase,
      topContributors: getTopContributorNames(3),
      quietParticipants: getQuietParticipantNamesForAnchor(Date.now()),
      ideas: state.ideas
        .slice(-12)
        .map((idea) => ({
          text: idea.text,
          cluster: idea.cluster,
          weight: idea.weight,
          authorName: idea.authorName,
      })),
    };
  }

  function interruptAnchorAudio(io: Server) {
    currentAnchorAnnouncementId += 1;
    io.emit("anchor_audio_interrupted", {
      announcementId: currentAnchorAnnouncementId,
      createdAt: Date.now(),
    });
    return currentAnchorAnnouncementId;
  }

  function startAnchorSessionIfNeeded(io: Server) {
    if (anchorLiveSessionPromise) return anchorLiveSessionPromise;

    const newSessionPromise = getAI().live.connect({
      model: "gemini-2.5-flash-native-audio-preview-09-2025",
      callbacks: {
        onopen: () => {
          logToFile("Anchor live session connected");
        },
        onmessage: (message: LiveServerMessage) => {
          if (message.serverContent?.modelTurn?.parts) {
            for (const part of message.serverContent.modelTurn.parts) {
              if (part.inlineData?.data) {
                io.emit("anchor_audio_response", {
                  announcementId: anchorResponseAnnouncementId,
                  data: part.inlineData.data,
                  mimeType: part.inlineData.mimeType,
                });
              }
            }
          }
          if (message.serverContent?.interrupted) {
            io.emit("anchor_audio_interrupted", {
              announcementId: anchorResponseAnnouncementId,
              createdAt: Date.now(),
            });
          }
        },
        onclose: () => {
          logToFile("Anchor live session disconnected");
          if (anchorLiveSessionPromise === newSessionPromise) {
            anchorLiveSessionPromise = null;
          }
        },
        onerror: (err: any) => {
          console.error("Anchor live error:", err.message, err.error);
          io.emit('error', { message: `Anchor live error: ${err.message || (err.error ? err.error.message : 'Unknown error')}` });
          if (anchorLiveSessionPromise === newSessionPromise) {
            anchorLiveSessionPromise = null;
          }
        },
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } }
        },
        systemInstruction: `You are the live anchor voice for "The Cognitive Swarm".
        Speak exactly the requested host line with natural energy and clarity.
        Do not add greetings, explanations, or extra commentary.
        If interrupted, stop immediately.`,
      },
    });

    anchorLiveSessionPromise = newSessionPromise;
    anchorLiveSessionPromise.catch((err) => {
      console.error("Anchor live connect error:", err);
      if (anchorLiveSessionPromise === newSessionPromise) {
        anchorLiveSessionPromise = null;
      }
    });
    return anchorLiveSessionPromise;
  }

  async function speakAnchorAnnouncement(io: Server, text: string) {
    const announcementId = interruptAnchorAudio(io);
    anchorResponseAnnouncementId = announcementId;
    const session = await startAnchorSessionIfNeeded(io);
    await session.sendClientContent({
      turns: [{
        role: 'user',
        parts: [{ text: `Say exactly this line, with playful host energy: ${text}` }],
      }],
      turnComplete: true,
    });
    return announcementId;
  }

  async function findUntouchedDirection() {
    if (!state.topic || state.ideas.length === 0) {
      return null;
    }

    const response = await getAI().models.generateContent({
      model: 'gemini-3.1-flash-lite-preview',
      contents: `You are evaluating a live brainstorm.
      Topic: "${state.topic}".
      Current phase: "${state.phase}".
      Existing ideas with clusters: ${JSON.stringify(state.ideas.map(i => ({
        text: i.text,
        cluster: i.cluster,
        weight: i.weight,
      })))}.

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
      config: { responseMimeType: "application/json" }
    });

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
      .sort((a, b) => (b.weight || 0) - (a.weight || 0))
      .slice(0, 14)
      .map((idea) => ({
        cluster: idea.cluster || 'General',
        text: idea.text,
        weight: idea.weight || 1,
      }));

    try {
      const response = await getAI().models.generateContent({
        model: 'gemini-3.1-flash-lite-preview',
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
        config: { responseMimeType: "application/json" }
      });

      const result = JSON.parse(response.text || "{}");
      const mermaid = String(result.mermaid || "").trim();
      const title = String(result.title || topic || diagramLabel).trim();
      const generatedType = String(result.diagramType || "").trim() as ArtifactDiagramType;

      if (
        generatedType !== diagramType ||
        !mermaid ||
        !mermaid.startsWith(diagramType)
      ) {
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

  async function broadcastUntouchedDirection(io: Server, reason: "auto" | "manual") {
    if (directionSuggestionInFlight || state.phase !== 'divergent') {
      return;
    }

    directionSuggestionInFlight = true;
    try {
      const now = Date.now();
      const quietNames = getQuietParticipantNamesForAnchor(now);
      const audienceNudge = buildAudienceNudge({
        quietNames,
        praisedNames: getTopContributorNames(2),
      });

      let suggestion = "";
      let rationale = "";
      let kind: 'direction' | 'audience_nudge' = 'direction';

      if (audienceNudge) {
        suggestion = audienceNudge.suggestion.trim();
        rationale = audienceNudge.rationale.trim();
        kind = 'audience_nudge';
      } else {
        if (state.ideas.length === 0) {
          logToFile(`No audience nudge or untouched direction available (${reason})`);
          return;
        }

        const untouchedDirection = await findUntouchedDirection();
        if (!untouchedDirection) {
          logToFile(`No untouched direction found (${reason})`);
          return;
        }

        suggestion = untouchedDirection.suggestion.trim();
        rationale = untouchedDirection.rationale.trim();
      }

      const suggestionKey = suggestion.toLowerCase();
      if (shouldSkipRepeatedSuggestion({
        reason,
        suggestion,
        lastSuggestionKey: lastDirectionSuggestionKey,
        lastSuggestionTime: lastDirectionSuggestionTime,
        now,
      })) {
        logToFile(`Skipping repeated untouched direction (${reason}): ${suggestion}`);
        return;
      }

      lastDirectionSuggestionTime = now;
      lastDirectionSuggestionKey = suggestionKey;
      logToFile(`Broadcasting ${kind} (${reason}): ${suggestion}`);
      io.emit("direction_suggestion", {
        suggestion,
        rationale,
        reason,
        kind,
        createdAt: now,
      });
      await speakAnchorAnnouncement(io, suggestion);
    } catch (err: any) {
      console.error("Error finding untouched direction:", err);
      logToFile("Error finding untouched direction: " + err.message);
    } finally {
      directionSuggestionInFlight = false;
    }
  }

  function triggerResearcher(idea: any) {
    if (idea.authorId.startsWith('agent-')) return;
    
    getAI().models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Find a real-world article, data point, or example that validates or relates to this idea: "${idea.text}". Return a short 3-word summary of the finding.`,
      config: {
        tools: [{ googleSearch: {} }]
      }
    }).then(response => {
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (chunks && chunks.length > 0) {
        const firstChunk = chunks.find(c => c.web?.uri);
        if (firstChunk && firstChunk.web) {
          idea.url = firstChunk.web.uri;
          idea.urlTitle = firstChunk.web.title || response.text.substring(0, 30);
          io.emit('idea_researched', { id: idea.id, url: idea.url, urlTitle: idea.urlTitle });
        }
      }
    }).catch(err => {
      console.error("Researcher error:", err);
      io.emit('error', { message: `Researcher error: ${err.message}` });
    });
  }

  // Synthesizer Agent
  setInterval(async () => {
    if (state.ideas.length > 3) {
      console.log("Synthesizer Agent triggered");
      try {
        const response = await getAI().models.generateContent({
          model: 'gemini-3.1-flash-lite-preview',
          contents: `Here are the current ideas: ${JSON.stringify(state.ideas.map(i => ({id: i.id, text: i.text}))) }.
          Find 1-2 strong connections between existing ideas that aren't obvious.
          Return a JSON array of objects with 'sourceId', 'targetId', and 'reason'.`,
          config: { responseMimeType: "application/json" }
        });
        const edges = JSON.parse(response.text || "[]");
        if (Array.isArray(edges) && edges.length > 0) {
          edges.forEach(e => {
            if (e.sourceId && e.targetId) {
              state.edges.push({ source: e.sourceId, target: e.targetId, reason: e.reason });
            }
          });
          io.emit('edges_updated', state.edges);
        }
      } catch (e: any) {
        console.error("Synthesizer error:", e);
        io.emit('error', { message: `Synthesizer error: ${e.message}` });
      }
    }
  }, 45000);

  // Devil's Advocate Agent
  setInterval(async () => {
    if (state.ideas.length > 5) {
      console.log("Devil's Advocate Agent triggered");
      try {
        const response = await getAI().models.generateContent({
          model: 'gemini-3.1-flash-lite-preview',
          contents: `The current brainstorming topic is: "${state.topic}".
          Here are the current ideas: ${JSON.stringify(state.ideas.map(i => i.text))}.
          Act as a Devil's Advocate. Find a blind spot, contradiction, or critical flaw in the current ideas.
          Generate ONE challenging question or counter-argument. Keep it to 5-10 words.
          Return JSON with 'idea' and 'category' (use "Critique" as category).`,
          config: { responseMimeType: "application/json" }
        });
        const result = JSON.parse(response.text || "{}");
        if (result.idea) {
          const ideaId = Math.random().toString(36).substring(2, 9);
          const newIdea = {
            id: ideaId,
            text: result.idea,
            weight: 1.5,
            cluster: 'Critique',
            authorId: 'agent-critic',
            authorName: "Devil's Advocate",
            initialPosition: [(Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20],
            targetPosition: null as any
          };
          if (state.ideas.length >= MAX_IDEAS) {
            const minIndex = state.ideas.reduce((minIdx, idea, idx, arr) =>
              (idea.weight || 0) < (arr[minIdx].weight || 0) ? idx : minIdx, 0);
            state.ideas.splice(minIndex, 1);
          }
          state.ideas.push(newIdea);
          pendingIdeas.push(newIdea);
          lastIdeaTime = Date.now();

          getAI().models.embedContent({
            model: 'gemini-embedding-001',
            contents: result.idea,
          }).then(embRes => {
            const embedding = embRes.embeddings?.[0]?.values;
            if (embedding) {
              const targetPosition = projectTo3D(embedding);
              newIdea.targetPosition = targetPosition;
              io.emit('idea_positioned', { id: ideaId, targetPosition });
            }
          }).catch(err => console.error("Embedding error:", err));
        }
      } catch (e: any) {
        console.error("Devil's Advocate error:", e);
        io.emit('error', { message: `Devil's Advocate error: ${e.message}` });
      }
    }
  }, 90000);

  // Batch broadcast every 1.5 seconds
  setInterval(() => {
    if (pendingIdeas.length > 0) {
      io.emit("ideas_batch_added", pendingIdeas);
      pendingIdeas = [];
    }
    if (pendingUpdates.length > 0) {
      const uniqueUpdates = dedupeById(pendingUpdates);
      io.emit("ideas_batch_updated", uniqueUpdates);
      pendingUpdates = [];
    }
  }, 1500);

  setInterval(() => {
    if (shouldAutoBroadcastSuggestion({
      phase: state.phase,
      ideaCount: state.ideas.length,
      quietParticipantCount: getQuietParticipantNamesForAnchor(Date.now()).length,
      lastIdeaTime,
      lastDirectionSuggestionTime,
      now: Date.now(),
    })) {
      broadcastUntouchedDirection(io, "auto");
    }
  }, 5000);

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);
    
    // Send initial state
    socket.emit("state_sync", state);

    let liveSessionPromise: Promise<any> | null = null;
    let audioActive = false;
    let videoActive = false;
    let audioStreamStarted = false;
    let pendingSessionClose: NodeJS.Timeout | null = null;

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
          liveSessionPromise.then(s => s.close()).catch(err => console.error(err));
          liveSessionPromise = null;
        }
      }, delayMs);
    };

    const startSessionIfNeeded = (topic: string, userName: string) => {
      if (liveSessionPromise) return;
      
      const newSessionPromise = getAI().live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        callbacks: {
          onopen: () => {
            console.log("Gemini Live Connected for", socket.id);
            logToFile("Gemini Live Connected for " + socket.id);
            socket.emit("audio_session_started");
          },
          onmessage: async (message: LiveServerMessage) => {
            // console.log("Received message from Gemini:", Object.keys(message));
            if (message.serverContent?.modelTurn) {
              logToFile("Received modelTurn: " + JSON.stringify(message.serverContent.modelTurn).substring(0, 200));
              const parts = message.serverContent.modelTurn.parts;
              if (parts) {
                for (const part of parts) {
                  emitInlineAudio(socket, "audio_response", part.inlineData);
                }
              }
            }
            if (message.serverContent?.interrupted) {
              logToFile("Received interrupted from Gemini");
              socket.emit("audio_interrupted");
            }

            // Handle tool calls
            if (message.toolCall) {
              logToFile("Received toolCall: " + JSON.stringify(message.toolCall));
              const calls = message.toolCall.functionCalls;
              if (calls) {
                const functionResponses: any[] = [];
                for (const call of calls) {
                  logToFile("Processing function call: " + call.name + " " + JSON.stringify(call.args));
                  if (call.name === 'extractIdea') {
                    const args = call.args as any;
                    const ideaId = Math.random().toString(36).substring(2, 9);
                    const authorName = userName || participants.get(socket.id)?.userName || 'Anonymous Node';
                    const newIdea = {
                      id: ideaId,
                      text: args.idea,
                      weight: 1,
                      cluster: args.category || 'General',
                      authorId: socket.id,
                      authorName,
                      initialPosition: [(Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20],
                      targetPosition: null as any
                    };
                    if (state.ideas.length >= MAX_IDEAS) {
                      const minIndex = state.ideas.reduce((minIdx, idea, idx, arr) =>
                        (idea.weight || 0) < (arr[minIdx].weight || 0) ? idx : minIdx, 0);
                      state.ideas.splice(minIndex, 1);
                    }
                    state.ideas.push(newIdea);
                    pendingIdeas.push(newIdea);
                    markParticipantContribution(socket.id, authorName);
                    triggerResearcher(newIdea);

                    // Fetch embedding asynchronously
                    getAI().models.embedContent({
                      model: 'gemini-embedding-001',
                      contents: args.idea,
                    }).then(response => {
                      const embedding = response.embeddings?.[0]?.values;
                      if (embedding) {
                        const targetPosition = projectTo3D(embedding);
                        newIdea.targetPosition = targetPosition;
                        io.emit('idea_positioned', { id: ideaId, targetPosition });
                      }
                    }).catch(err => console.error("Embedding error:", err));

                    functionResponses.push({
                      id: call.id,
                      name: call.name,
                      response: { result: "Idea extracted successfully" }
                    });
                  } else if (call.name === 'generateMermaid') {
                    const args = call.args as any;
                    io.emit('update_mermaid', args.code);
                    functionResponses.push({
                      id: call.id,
                      name: call.name,
                      response: { result: "Mermaid diagram generated successfully" }
                    });
                  } else if (call.name === 'getIdeas') {
                    const ideasList = state.ideas.map(i => ({ text: i.text, cluster: i.cluster, weight: i.weight }));
                    functionResponses.push({
                      id: call.id,
                      name: call.name,
                      response: { ideas: ideasList }
                    });
                  } else if (call.name === 'getSessionSnapshot') {
                    functionResponses.push({
                      id: call.id,
                      name: call.name,
                      response: getSessionSnapshot(),
                    });
                  }
                }

                if (liveSessionPromise) {
                  liveSessionPromise.then(s => s.sendToolResponse({ functionResponses })).catch(err => console.error("Error sending tool response:", err));
                }
              }
            }
          },
          onclose: (event) => {
            console.log("Gemini Live Disconnected for", socket.id, "Code:", event?.code, "Reason:", event?.reason);
            logToFile("Gemini Live Disconnected for " + socket.id + " Code: " + event?.code + " Reason: " + event?.reason);
            socket.emit("audio_session_closed");
            if (liveSessionPromise === newSessionPromise) {
              liveSessionPromise = null;
            }
          },
          onerror: (err: any) => {
            console.error("Gemini Live Error for", socket.id, err.message, err.error);
            logToFile("Gemini Live Error for " + socket.id + ": " + err.message + " - " + (err.error ? err.error.message : ""));
            socket.emit('error', { message: `Gemini Live Error: ${err.message || (err.error ? err.error.message : 'Unknown error')}` });
            if (liveSessionPromise === newSessionPromise) {
              liveSessionPromise = null;
            }
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } }
          },
          systemInstruction: `You are the playful live anchor of "The Cognitive Swarm".
          Topic: "${topic}". Current speaker: ${userName}.

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
          tools: [{
            functionDeclarations: [
              {
                name: 'extractIdea',
                description: 'Extracts a brainstorming idea from the user audio.',
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    idea: { type: Type.STRING, description: 'A concise, 3-7 word summary of the idea.' },
                    category: { type: Type.STRING, description: 'A 1-2 word category or cluster name.' }
                  },
                  required: ['idea', 'category']
                }
              },
              {
                name: 'generateMermaid',
                description: 'Generates a Mermaid.js diagram based on the current ideas.',
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    code: { type: Type.STRING, description: 'The raw Mermaid.js code (e.g., graph TD; A-->B;)' }
                  },
                  required: ['code']
                }
              },
              {
                name: 'getIdeas',
                description: 'Gets the current list of brainstormed ideas and their weights.',
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    format: { type: Type.STRING, description: 'The format to return (e.g., "json")' }
                  }
                }
              },
              {
                name: 'getSessionSnapshot',
                description: 'Gets the current topic, phase, recent ideas, top contributors, and quieter participants.',
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    detailLevel: { type: Type.STRING, description: 'Optional level of detail, such as "brief" or "full".' }
                  }
                }
              }
            ]
          }]
        }
      });
      
      liveSessionPromise = newSessionPromise;
      
      liveSessionPromise.catch(err => {
        console.error("Live session connect error:", err);
        logToFile("Live session connect error: " + err.message);
        socket.emit('error', { message: `Live session connect error: ${err.message}` });
        if (liveSessionPromise === newSessionPromise) {
          liveSessionPromise = null;
        }
      });
    };

    const stopSessionIfNeeded = () => {
      clearPendingSessionClose();
      if (!audioActive && !videoActive && liveSessionPromise) {
        liveSessionPromise.then(s => s.close()).catch(err => console.error(err));
        liveSessionPromise = null;
      }
    };

    socket.on("register_participant", (data: { userName: string, role: 'admin' | 'participant' }) => {
      upsertParticipant(socket.id, data.userName, data.role);
    });

    socket.on("interrupt_anchor", () => {
      interruptAnchorAudio(io);
    });

    socket.on("start_audio_session", (data: { topic: string, userName: string }) => {
      logToFile("start_audio_session received for " + socket.id);
      audioActive = true;
      audioStreamStarted = false;
      clearPendingSessionClose();
      interruptAnchorAudio(io);
      upsertParticipant(socket.id, data.userName, participants.get(socket.id)?.role || 'participant');
      startSessionIfNeeded(data.topic, data.userName);
    });

    socket.on("stop_audio_session", () => {
      logToFile("stop_audio_session received for " + socket.id);
      audioActive = false;
      if (liveSessionPromise && audioStreamStarted) {
        liveSessionPromise.then(s => {
          logToFile("Sending audioStreamEnd for " + socket.id);
          s.sendRealtimeInput({ audioStreamEnd: true });
        }).catch(err => {
          console.error("Error sending audio stream end:", err);
          logToFile("Error sending audio stream end: " + err.message);
        });
        scheduleSessionClose();
      } else {
        stopSessionIfNeeded();
      }
    });

    socket.on("suggest_direction", () => {
      logToFile("suggest_direction received for " + socket.id);
      broadcastUntouchedDirection(io, "manual");
    });

    socket.on("start_video_session", (data: { topic: string, userName: string }) => {
      videoActive = true;
      clearPendingSessionClose();
      upsertParticipant(socket.id, data.userName, participants.get(socket.id)?.role || 'participant');
      startSessionIfNeeded(data.topic, data.userName);
    });

    socket.on("stop_video_session", () => {
      videoActive = false;
      stopSessionIfNeeded();
    });

    let audioChunkCount = 0;
    socket.on("text_chunk", (text: string) => {
      logToFile(`Received text chunk: ${text}`);
      interruptAnchorAudio(io);
      if (liveSessionPromise) {
        liveSessionPromise.then(s => {
          s.sendClientContent({
            turns: [{ role: 'user', parts: [{ text }] }],
            turnComplete: true
          });
        }).catch(err => {
          console.error("Error sending text chunk:", err);
          logToFile("Error sending text chunk: " + err.message);
        });
      }
    });

    socket.on("audio_chunk", (base64Data: string) => {
      audioChunkCount++;
      audioStreamStarted = true;
      clearPendingSessionClose();
      interruptAnchorAudio(io);
      if (audioChunkCount % 10 === 0) {
        logToFile(`Received 10 audio chunks from ${socket.id}`);
      }
      if (liveSessionPromise) {
        liveSessionPromise.then(s => {
          s.sendRealtimeInput({
            audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
          });
        }).catch(err => {
          console.error("Error sending audio chunk:", err);
          logToFile("Error sending audio chunk: " + err.message);
        });
      }
    });

    socket.on("video_chunk", (base64Data: string) => {
      clearPendingSessionClose();
      if (liveSessionPromise) {
        liveSessionPromise.then(s => {
          s.sendRealtimeInput({
            video: { data: base64Data, mimeType: 'image/jpeg' }
          });
        }).catch(err => {
          console.error("Error sending video chunk:", err);
          logToFile("Error sending video chunk: " + err.message);
        });
      }
    });

    // Update topic
    socket.on("set_topic", (topic: string) => {
      if (!isAdmin(participants.get(socket.id))) return;
      if (typeof topic !== 'string' || !topic.trim()) return;
      state.topic = topic.trim();
      io.emit("topic_updated", state.topic);
    });

    // Ingestion Task: Receive new ideas from clients (extracted via Gemini)
    socket.on("add_idea", (idea: { id?: string, text: string, cluster: string, authorName?: string }) => {
      const sanitized = sanitizeIdeaInput(idea.text);
      if (!sanitized.valid) return;
      const clusterSanitized = sanitizeIdeaInput(idea.cluster || 'General', 100);

      const initialPosition = [
        (Math.random() - 0.5) * 20,
        (Math.random() - 0.5) * 20,
        (Math.random() - 0.5) * 20
      ];

      const newIdea = {
        id: idea.id || Math.random().toString(36).substring(2, 9),
        text: sanitized.text,
        weight: 1, // Initial weight
        cluster: clusterSanitized.text,
        authorId: socket.id,
        authorName: idea.authorName || 'Anonymous Node',
        initialPosition,
        targetPosition: null // Will be updated after embedding
      };
      
      if (state.ideas.length >= MAX_IDEAS) {
        const minIndex = state.ideas.reduce((minIdx, idea, idx, arr) =>
          (idea.weight || 0) < (arr[minIdx].weight || 0) ? idx : minIdx, 0);
        state.ideas.splice(minIndex, 1);
      }
      state.ideas.push(newIdea);
      pendingIdeas.push(newIdea);
      markParticipantContribution(socket.id, newIdea.authorName);
      triggerResearcher(newIdea);
    });

    // Update idea embedding
    socket.on("update_idea_embedding", (data: { id: string, embedding: number[] }) => {
      const existingIdea = state.ideas.find(i => i.id === data.id);
      if (existingIdea) {
        const targetPosition = projectTo3D(data.embedding);
        existingIdea.targetPosition = targetPosition;
        io.emit('idea_positioned', { id: existingIdea.id, targetPosition });
      }
    });

    // Consensus Mediator Task: Idea Voting (server-validated quadratic cost)
    socket.on("update_idea_weight", (data: { ideaId: string, weightChange: number }) => {
      const participant = participants.get(socket.id);
      if (!participant) return;
      const idea = state.ideas.find(i => i.id === data.ideaId);
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
      idea.weight = (idea.weight || 0) + data.weightChange;
      if (idea.weight < 0) idea.weight = 0;

      const existingUpdateIndex = pendingUpdates.findIndex(u => u.id === data.ideaId);
      if (existingUpdateIndex >= 0) {
        pendingUpdates[existingUpdateIndex] = idea;
      } else {
        pendingUpdates.push(idea);
      }

      socket.emit('credits_updated', { credits: participant.credits, votes: participant.votes });
      io.emit('idea_weight_updated', { ideaId: data.ideaId, weight: idea.weight });
    });

    // Edit Idea Task
    socket.on("edit_idea", (data: { id: string, text: string, cluster: string, textChanged?: boolean }) => {
      const sanitizedText = sanitizeIdeaInput(data.text);
      if (!sanitizedText.valid) return;
      const sanitizedCluster = sanitizeIdeaInput(data.cluster || 'General', 100);

      const idea = state.ideas.find(i => i.id === data.id);
      if (idea) {
        idea.text = sanitizedText.text;
        idea.cluster = sanitizedCluster.text;
        
        if (data.textChanged) {
          getAI().models.embedContent({
            model: 'gemini-embedding-001',
            contents: data.text,
          }).then(response => {
            const embedding = response.embeddings?.[0]?.values;
            if (embedding) {
              const targetPosition = projectTo3D(embedding);
              idea.targetPosition = targetPosition;
              io.emit('idea_positioned', { id: idea.id, targetPosition });
            }
          }).catch(err => console.error("Embedding error:", err));
        }
        
        const existingUpdateIndex = pendingUpdates.findIndex(u => u.id === data.id);
        if (existingUpdateIndex >= 0) {
          pendingUpdates[existingUpdateIndex] = idea;
        } else {
          pendingUpdates.push(idea);
        }
      }
    });

    // Visual Scribe Task: Update React Flow Diagram
    socket.on("update_flow", (data: { nodes: any[], edges: any[] }) => {
      state.flowData = data;
      io.emit("flow_updated", state.flowData);
    });

    socket.on("forge_artifact", async () => {
      try {
        const artifact = await forgeArtifactFromTopic(
          state.topic || 'Brainstorming Session',
          state.ideas.map((idea) => ({
            text: idea.text,
            cluster: idea.cluster,
            weight: idea.weight,
          })),
        );
        state.artifactData = artifact;
        io.emit("artifact_updated", artifact);
      } catch (error: any) {
        console.error("Artifact forge failed:", error);
        socket.emit('error', { message: error.message || 'Failed to forge topic-aware artifact.' });
      }
    });

    // Phase transition
    socket.on("set_phase", (phase: string) => {
      if (!isAdmin(participants.get(socket.id))) return;
      if (!isValidPhase(phase)) return;
      state.phase = phase;
      io.emit("phase_changed", state.phase);
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
      clearPendingSessionClose();
      stopSessionIfNeeded();
      participants.delete(socket.id);
    });
  });

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
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
    app.use(express.static('dist'));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve(process.cwd(), "dist", "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

await startServer();
