import { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Mic, MicOff, Camera, CameraOff, BrainCircuit, Activity, Users, Zap, Bot, AlertTriangle } from 'lucide-react';
import { motion } from 'motion/react';
import IdeaSwarm from './components/IdeaSwarm';
import IdeaVoting from './components/IdeaVoting';
import ArtifactCanvas, { ArtifactData } from './components/ArtifactCanvas';
import { startSimulation } from './utils/simulator';
import '@xyflow/react/dist/style.css';

const INPUT_SAMPLE_RATE = 16000;
const DEFAULT_OUTPUT_SAMPLE_RATE = 24000;

type AudioChunkPayload =
  | string
  | {
      data: string;
      mimeType?: string | null;
    };

type UserRole = 'admin' | 'participant';
type EntryMode = 'admin' | 'participant';

interface ActiveRoomState {
  code: string;
  adminUserName: string;
  status: 'active' | 'closed';
  participantCount: number;
}

interface StateSyncPayload {
  room: ActiveRoomState;
  state: {
    topic: string;
    phase: 'divergent' | 'convergent' | 'forging';
    ideas: any[];
    edges: any[];
    artifactData: ArtifactData | null;
  };
  currentUser: {
    userName: string;
    role: UserRole;
    isAdmin: boolean;
  };
}

const focusRingClass =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#34D399] focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505]';

const phaseLabels: Record<'divergent' | 'convergent' | 'forging', string> = {
  divergent: 'Explore',
  convergent: 'Vote',
  forging: 'Forge',
};

const phaseColors: Record<'divergent' | 'convergent' | 'forging', { text: string; bg: string; border: string; glow: string }> = {
  divergent: { text: 'text-[#34D399]', bg: 'bg-[#34D399]/10', border: 'border-[#34D399]/30', glow: 'shadow-[0_0_12px_rgba(52,211,153,0.25)]' },
  convergent: { text: 'text-[#22D3EE]', bg: 'bg-[#22D3EE]/10', border: 'border-[#22D3EE]/30', glow: 'shadow-[0_0_12px_rgba(34,211,238,0.25)]' },
  forging: { text: 'text-[#A78BFA]', bg: 'bg-[#A78BFA]/10', border: 'border-[#A78BFA]/30', glow: 'shadow-[0_0_12px_rgba(167,139,250,0.25)]' },
};

function decodeBase64ToBytes(base64Audio: string) {
  const binaryString = window.atob(base64Audio);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function parseSampleRateFromMimeType(mimeType?: string | null, fallback = DEFAULT_OUTPUT_SAMPLE_RATE) {
  const match = mimeType?.match(/rate\s*=\s*(\d+)/i);
  const parsed = match ? Number(match[1]) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function encodePcmBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function createScriptProcessorCapture(
  audioContext: AudioContext,
  source: MediaStreamAudioSourceNode,
  targetSampleRate: number,
  onChunk: (buffer: ArrayBuffer) => void,
) {
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const silentGain = audioContext.createGain();
  silentGain.gain.value = 0;

  const inputSampleRate = audioContext.sampleRate;
  let sourceSamples: number[] = [];
  let readIndex = 0;
  let outputBuffer = new Int16Array(4096);
  let outputIndex = 0;

  const flushOutputBuffer = (force = false) => {
    if (outputIndex === 0) return;
    if (!force && outputIndex < outputBuffer.length) return;

    const chunk = outputBuffer.slice(0, outputIndex);
    onChunk(chunk.buffer);
    outputIndex = 0;
  };

  const pushOutputSample = (sample: number) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    outputBuffer[outputIndex++] =
      clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
    if (outputIndex >= outputBuffer.length) {
      flushOutputBuffer(true);
    }
  };

  const drainSourceSamples = (force = false) => {
    if (inputSampleRate === targetSampleRate) {
      for (let i = 0; i < sourceSamples.length; i++) {
        pushOutputSample(sourceSamples[i]);
      }
      sourceSamples = [];
      readIndex = 0;
      if (force) {
        flushOutputBuffer(true);
      }
      return;
    }

    const step = inputSampleRate / targetSampleRate;
    while (readIndex + 1 < sourceSamples.length) {
      const leftIndex = Math.floor(readIndex);
      const rightIndex = leftIndex + 1;
      const fraction = readIndex - leftIndex;
      const interpolatedSample =
        sourceSamples[leftIndex] +
        (sourceSamples[rightIndex] - sourceSamples[leftIndex]) * fraction;

      pushOutputSample(interpolatedSample);
      readIndex += step;
    }

    if (force && sourceSamples.length > 0) {
      const lastSample = sourceSamples[sourceSamples.length - 1];
      while (readIndex < sourceSamples.length) {
        pushOutputSample(lastSample);
        readIndex += step;
      }
    }

    const consumedSamples = Math.floor(readIndex);
    if (consumedSamples > 0) {
      sourceSamples = sourceSamples.slice(consumedSamples);
      readIndex -= consumedSamples;
    }

    if (force) {
      sourceSamples = [];
      readIndex = 0;
      flushOutputBuffer(true);
    }
  };

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    for (let i = 0; i < input.length; i++) {
      sourceSamples.push(input[i]);
    }
    drainSourceSamples(false);
  };

  source.connect(processor);
  processor.connect(silentGain);
  silentGain.connect(audioContext.destination);

  return {
    node: processor as AudioNode,
    flush: () => {
      drainSourceSamples(true);
    },
    disconnect: () => {
      processor.onaudioprocess = null;
      try {
        source.disconnect(processor);
      } catch (_error) {}
      try {
        processor.disconnect();
      } catch (_error) {}
      try {
        silentGain.disconnect();
      } catch (_error) {}
    },
  };
}

async function waitForSocketConnection(activeSocket: Socket, timeoutMs = 4000) {
  if (activeSocket.connected) return;

  await new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('Unable to reach the server. Please try again.'));
    }, timeoutMs);

    const handleConnect = () => {
      cleanup();
      resolve();
    };

    const handleConnectError = () => {
      cleanup();
      reject(new Error('Unable to reach the server. Please try again.'));
    };

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      activeSocket.off('connect', handleConnect);
      activeSocket.off('connect_error', handleConnectError);
    };

    activeSocket.on('connect', handleConnect);
    activeSocket.on('connect_error', handleConnectError);
    activeSocket.connect();
  });
}

export default function App() {
  const [entryMode, setEntryMode] = useState<EntryMode>('admin');
  const [userName, setUserName] = useState('');
  const userNameRef = useRef('');
  useEffect(() => { userNameRef.current = userName; }, [userName]);
  const [role, setRole] = useState<UserRole | null>(null);
  const roleRef = useRef<UserRole | null>(null);
  useEffect(() => { roleRef.current = role; }, [role]);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [activeRoom, setActiveRoom] = useState<ActiveRoomState | null>(null);
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [roomError, setRoomError] = useState<string | null>(null);
  const [roomNotice, setRoomNotice] = useState<string | null>(null);
  const [isJoiningRoom, setIsJoiningRoom] = useState(false);
  const [phase, setPhase] = useState<'divergent' | 'convergent' | 'forging'>('divergent');
  const [topic, setTopic] = useState<string>('');
  const [isEditingTopic, setIsEditingTopic] = useState(false);
  const [ideas, setIdeas] = useState<any[]>([]);
  const [swarmEdges, setSwarmEdges] = useState<any[]>([]);
  const [credits, setCredits] = useState<number>(100);
  const [userVotes, setUserVotes] = useState<Record<string, number>>({});
  const ideasRef = useRef<any[]>([]);
  useEffect(() => { ideasRef.current = ideas; }, [ideas]);
  const [artifact, setArtifact] = useState<ArtifactData | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isStartingAudio, setIsStartingAudio] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [directionSuggestion, setDirectionSuggestion] = useState<{
    suggestion: string;
    rationale?: string;
    createdAt: number;
    kind?: 'direction' | 'audience_nudge';
  } | null>(null);
  const [manualIdea, setManualIdea] = useState("");
  const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackAudioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const captureNodeRef = useRef<AudioNode | null>(null);
  const captureCleanupRef = useRef<(() => void) | null>(null);
  const captureFlushRef = useRef<(() => void) | null>(null);
  const recordingSetupIdRef = useRef(0);
  const stopSimulationRef = useRef<(() => void) | null>(null);
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const anchorSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextPlayTimeRef = useRef<number>(0);
  const anchorNextPlayTimeRef = useRef<number>(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoIntervalRef = useRef<number | null>(null);
  const suggestionTimeoutRef = useRef<number | null>(null);
  const anchorAnnouncementIdRef = useRef(0);
  const editDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncedTextRef = useRef<Record<string, string>>({});
  const audioStartTimeoutRef = useRef<number | null>(null);
  const isStartingAudioRef = useRef(false);

  useEffect(() => {
    isStartingAudioRef.current = isStartingAudio;
  }, [isStartingAudio]);

  const ensurePlaybackAudioContext = async () => {
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) return null;

    if (!playbackAudioContextRef.current) {
      playbackAudioContextRef.current = new AudioContextCtor();
    }

    if (playbackAudioContextRef.current.state === 'suspended') {
      await playbackAudioContextRef.current.resume();
    }

    return playbackAudioContextRef.current;
  };

  const playGeminiAudioChunk = async (chunk: AudioChunkPayload, target: 'personal' | 'anchor' = 'personal') => {
    const ctx = await ensurePlaybackAudioContext();
    if (!ctx) return;

    const payload = typeof chunk === 'string' ? { data: chunk, mimeType: undefined } : chunk;
    const bytes = decodeBase64ToBytes(payload.data);
    const evenByteLength = bytes.byteLength - (bytes.byteLength % 2);
    if (evenByteLength === 0) return;

    const pcmBytes = evenByteLength === bytes.byteLength ? bytes : bytes.slice(0, evenByteLength);
    const alignedBuffer = new ArrayBuffer(pcmBytes.byteLength);
    new Uint8Array(alignedBuffer).set(pcmBytes);
    const int16Array = new Int16Array(alignedBuffer);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }

    if (float32Array.length === 0) return;

    const sampleRate = parseSampleRateFromMimeType(payload.mimeType);
    const audioBuffer = ctx.createBuffer(1, float32Array.length, sampleRate);
    audioBuffer.getChannelData(0).set(float32Array);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const sourcesRef = target === 'anchor' ? anchorSourcesRef : activeSourcesRef;
    const playTimeRef = target === 'anchor' ? anchorNextPlayTimeRef : nextPlayTimeRef;

    const currentTime = ctx.currentTime;
    if (playTimeRef.current < currentTime) {
      playTimeRef.current = currentTime;
    }

    source.start(playTimeRef.current);
    playTimeRef.current += audioBuffer.duration;

    sourcesRef.current.push(source);
    source.onended = () => {
      sourcesRef.current = sourcesRef.current.filter((activeSource) => activeSource !== source);
    };
  };

  const interruptAnchorPlayback = (clearSuggestion = false) => {
    audioQueueRef.current = [];
    // Only stop anchor sources — leave personal Gemini response sources playing
    anchorSourcesRef.current.forEach(source => {
      try {
        source.stop();
      } catch (e) {}
    });
    anchorSourcesRef.current = [];
    const playbackContext = playbackAudioContextRef.current || audioContextRef.current;
    if (playbackContext) {
      anchorNextPlayTimeRef.current = playbackContext.currentTime;
    }
    if (clearSuggestion) {
      setDirectionSuggestion(null);
      if (suggestionTimeoutRef.current) {
        window.clearTimeout(suggestionTimeoutRef.current);
        suggestionTimeoutRef.current = null;
      }
    }
  };

  const stopAudioCapture = () => {
    recordingSetupIdRef.current += 1;
    setIsRecording(false);
    setIsStartingAudio(false);
    if (audioStartTimeoutRef.current) {
      window.clearTimeout(audioStartTimeoutRef.current);
      audioStartTimeoutRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    if (captureFlushRef.current) {
      captureFlushRef.current = null;
    }
    if (captureCleanupRef.current) {
      captureCleanupRef.current();
      captureCleanupRef.current = null;
    }
    if (captureNodeRef.current) {
      try {
        captureNodeRef.current.disconnect();
      } catch (_error) {}
      captureNodeRef.current = null;
    }
    if (workletNodeRef.current) {
      try {
        workletNodeRef.current.disconnect();
      } catch (_error) {}
      workletNodeRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      void audioContextRef.current.close();
    }
    audioContextRef.current = null;
  };

  const stopVideoCapture = () => {
    setIsCameraActive(false);
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach(t => t.stop());
      videoStreamRef.current = null;
    }
    if (videoIntervalRef.current) {
      window.clearInterval(videoIntervalRef.current);
      videoIntervalRef.current = null;
    }
  };

  const resetRoomState = (message?: string) => {
    stopAudioCapture();
    stopVideoCapture();
    interruptAnchorPlayback(true);
    if (stopSimulationRef.current) {
      stopSimulationRef.current();
      stopSimulationRef.current = null;
    }
    setIsSimulating(false);
    setActiveRoom(null);
    setRole(null);
    setPhase('divergent');
    setTopic('');
    setIdeas([]);
    setSwarmEdges([]);
    setCredits(100);
    setUserVotes({});
    setArtifact(null);
    setAudioError(null);
    setDirectionSuggestion(null);
    setManualIdea('');
    setSelectedIdeaId(null);
    setForgeError(null);
    setIsForging(false);
    setIsEditingTopic(false);
    if (message) {
      setRoomNotice(message);
    }
  };

  const handleVote = (ideaId: string, change: number) => {
    socket?.emit('update_idea_weight', { ideaId, weightChange: change });
  };

  const handleEditIdea = (id: string, text: string, cluster: string) => {
    // Update local state immediately for responsive UI
    setIdeas(prev => prev.map(i => i.id === id ? { ...i, text, cluster } : i));

    if (editDebounceRef.current) clearTimeout(editDebounceRef.current);
    editDebounceRef.current = setTimeout(() => {
      if (socket) {
        const textChanged = lastSyncedTextRef.current[id] !== text;
        socket.emit('edit_idea', { id, text, cluster, textChanged });
        lastSyncedTextRef.current[id] = text;
      }
    }, 400);
  };

  // Connect to Socket.IO
  useEffect(() => {
    const newSocket = io({
      transports: ['websocket'],
    });
    setSocket(newSocket);

    newSocket.on('connect', () => {
      setIsJoiningRoom(false);
    });

    newSocket.on('connect_error', (error) => {
      console.error('Socket connection failed:', error);
      setIsJoiningRoom(false);
      if (!roleRef.current) {
        setRoomError('Unable to reach the server. Please retry.');
      }
    });

    newSocket.on('disconnect', (reason) => {
      console.warn('Socket disconnected:', reason);
      setIsJoiningRoom(false);
      if (!roleRef.current) {
        setRoomError('Connection to the server was lost. Try again.');
      }
    });

    newSocket.on('state_sync', (payload: StateSyncPayload) => {
      setActiveRoom(payload.room);
      setUserName(payload.currentUser.userName || userNameRef.current);
      setRole(payload.currentUser.role);
      setTopic(payload.state.topic || '');
      setPhase(payload.state.phase);
      setIdeas(payload.state.ideas);
      setSwarmEdges(payload.state.edges || []);
      setArtifact(payload.state.artifactData || null);
      setRoomCodeInput(payload.room.code);
      setRoomError(null);
      setIsJoiningRoom(false);
    });

    newSocket.on('room_created', ({ roomCode, adminUserName }: { roomCode: string; adminUserName: string }) => {
      setEntryMode('admin');
      setRoomCodeInput(roomCode);
      setRoomNotice(`Room ${roomCode} created. Share this code with participants.`);
      setRoomError(null);
      setRole('admin');
      setActiveRoom((previous) => previous || {
        code: roomCode,
        adminUserName,
        status: 'active',
        participantCount: 1,
      });
    });

    newSocket.on('room_joined', ({ roomCode, adminUserName }: { roomCode: string; adminUserName: string }) => {
      setEntryMode('participant');
      setRoomCodeInput(roomCode);
      setRoomNotice(`Joined room ${roomCode}.`);
      setRoomError(null);
      setRole('participant');
      setActiveRoom((previous) => previous || {
        code: roomCode,
        adminUserName,
        status: 'active',
        participantCount: 0,
      });
    });

    newSocket.on('room_error', ({ message }: { message: string }) => {
      setRoomError(message || 'Unable to join room.');
      setRoomNotice(null);
      setIsJoiningRoom(false);
    });

    newSocket.on('room_left', ({ roomCode }: { roomCode: string }) => {
      setRoomCodeInput(roomCode || '');
      setRoomError(null);
      setIsJoiningRoom(false);
      resetRoomState('You left the room.');
    });

    newSocket.on('room_closed', ({ roomCode, message }: { roomCode: string; message?: string }) => {
      setRoomCodeInput(roomCode || '');
      setRoomError(null);
      setIsJoiningRoom(false);
      resetRoomState(message || 'This room is closed.');
    });

    newSocket.on('topic_updated', (newTopic) => {
      setTopic(newTopic);
    });

    newSocket.on('error', (err: any) => {
      console.error("Server error:", err);
      if (isStartingAudioRef.current) {
        stopAudioCapture();
      }
      setAudioError(err.message || "Unknown server error");
      setIsForging(false);
    });

    newSocket.on('audio_session_started', () => {
      if (audioStartTimeoutRef.current) {
        window.clearTimeout(audioStartTimeoutRef.current);
        audioStartTimeoutRef.current = null;
      }
      setIsStartingAudio(false);
      setIsRecording(true);
      setAudioError(null);
    });

    newSocket.on('ideas_batch_added', (newIdeas: any[]) => {
      setIdeas((prev) => [...prev, ...newIdeas]);
      const newestIdea = newIdeas[newIdeas.length - 1];
      if (newestIdea?.id) {
        setSelectedIdeaId(newestIdea.id);
      }
    });

    newSocket.on('ideas_batch_updated', (updatedIdeas: any[]) => {
      setIdeas((prev) => prev.map(i => {
        const updated = updatedIdeas.find(u => u.id === i.id);
        return updated ? { ...i, ...updated } : i;
      }));
    });

    newSocket.on('idea_positioned', ({ id, targetPosition }: { id: string, targetPosition: [number, number, number] }) => {
      setIdeas((prev) => prev.map(i => 
        i.id === id ? { ...i, targetPosition } : i
      ));
    });

    newSocket.on('idea_researched', ({ id, url, urlTitle }: { id: string, url: string, urlTitle: string }) => {
      setIdeas((prev) => prev.map(i => 
        i.id === id ? { ...i, url, urlTitle } : i
      ));
    });

    newSocket.on('edges_updated', (newEdges: any[]) => {
      setSwarmEdges(newEdges);
    });

    newSocket.on('idea_weight_updated', ({ ideaId, weight }: { ideaId: string, weight: number }) => {
      setIdeas((prev) => prev.map(i => 
        i.id === ideaId ? { ...i, weight } : i
      ));
    });

    newSocket.on('artifact_updated', (data: ArtifactData) => {
      setArtifact(data);
      setForgeError(null);
      setIsForging(false);
    });

    newSocket.on('credits_updated', ({ credits, votes }: { credits: number, votes: Record<string, number> }) => {
      setCredits(credits);
      setUserVotes(votes);
    });

    newSocket.on('phase_changed', (newPhase) => {
      setPhase(newPhase);
    });

    newSocket.on('direction_suggestion', (payload: { suggestion: string; rationale?: string; createdAt: number; kind?: 'direction' | 'audience_nudge' }) => {
      if (!roleRef.current) return;
      setDirectionSuggestion(payload);
      if (suggestionTimeoutRef.current) {
        window.clearTimeout(suggestionTimeoutRef.current);
      }
      suggestionTimeoutRef.current = window.setTimeout(() => {
        setDirectionSuggestion(null);
      }, 12000);
    });

    newSocket.on('anchor_audio_interrupted', ({ announcementId }: { announcementId: number }) => {
      if (announcementId >= anchorAnnouncementIdRef.current) {
        anchorAnnouncementIdRef.current = announcementId;
        interruptAnchorPlayback();
      }
    });

    newSocket.on('anchor_audio_response', async ({ announcementId, data, mimeType }: { announcementId: number; data: string; mimeType?: string }) => {
      if (announcementId < anchorAnnouncementIdRef.current) return;
      if (announcementId > anchorAnnouncementIdRef.current) {
        anchorAnnouncementIdRef.current = announcementId;
        interruptAnchorPlayback();
      }
      await playGeminiAudioChunk({ data, mimeType }, 'anchor');
    });

    newSocket.on('audio_interrupted', () => {
      // Interrupt personal Gemini response audio (e.g. when server says model was interrupted)
      activeSourcesRef.current.forEach(source => {
        try { source.stop(); } catch (e) {}
      });
      activeSourcesRef.current = [];
      const ctx = playbackAudioContextRef.current;
      if (ctx) nextPlayTimeRef.current = ctx.currentTime;
    });

    newSocket.on('audio_response', async (audioChunk: AudioChunkPayload) => {
      const payload = typeof audioChunk === 'string' ? { data: audioChunk, mimeType: undefined } : audioChunk;
      console.log("Received audio response of length:", payload.data.length, "mimeType:", payload.mimeType || 'audio/pcm;rate=24000');
      await playGeminiAudioChunk(payload);
    });

    newSocket.on('audio_session_closed', () => {
      const closedDuringStartup = isStartingAudioRef.current;
      stopAudioCapture();
      if (closedDuringStartup) {
        setAudioError('Audio session closed before the server confirmed startup.');
      }
      // Do NOT close playbackAudioContextRef here — Gemini may still be
      // streaming audio responses that need to finish playing back.
      // Playback context is only cleaned up on component unmount.
    });

    return () => {
      if (suggestionTimeoutRef.current) {
        window.clearTimeout(suggestionTimeoutRef.current);
      }
      stopAudioCapture();
      stopVideoCapture();
      if (playbackAudioContextRef.current && playbackAudioContextRef.current.state !== 'closed') {
        playbackAudioContextRef.current.close();
        playbackAudioContextRef.current = null;
      }
      newSocket.disconnect();
    };
  }, []);

  // Gemini Live API Connection
  const toggleRecording = async () => {
    if (isRecording || isStartingAudio) {
      // Stop recording
      if (captureFlushRef.current) {
        captureFlushRef.current();
        await new Promise((resolve) => window.setTimeout(resolve, 30));
      }
      socket?.emit('stop_audio_session');
      stopAudioCapture();
      return;
    }

    try {
      interruptAnchorPlayback(true);
      socket?.emit('interrupt_anchor');
      await ensurePlaybackAudioContext();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Browser does not support audio recording or permissions are missing.");
      }
      const recordingSetupId = recordingSetupIdRef.current + 1;
      recordingSetupIdRef.current = recordingSetupId;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (recordingSetupIdRef.current !== recordingSetupId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      mediaStreamRef.current = stream;

      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextCtor) {
        throw new Error("Browser does not support AudioContext.");
      }

      const audioContext = new AudioContextCtor();
      audioContextRef.current = audioContext;
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      if (recordingSetupIdRef.current !== recordingSetupId || audioContext.state === 'closed') {
        throw new Error('Microphone setup was interrupted. Please try again.');
      }

      const source = audioContext.createMediaStreamSource(stream);

      if (audioContext.sampleRate !== INPUT_SAMPLE_RATE) {
        console.warn(`Microphone context is running at ${audioContext.sampleRate} Hz and will be resampled to ${INPUT_SAMPLE_RATE} Hz before upload.`);
      }

      const emitAudioChunk = (buffer: ArrayBuffer) => {
        const base64Data = encodePcmBufferToBase64(buffer);
        socket?.emit('audio_chunk', base64Data);
      };

      try {
        if (!audioContext.audioWorklet) {
          throw new Error('AudioWorklet is not available in this browser context.');
        }

        await audioContext.audioWorklet.addModule('/pcm-processor.js');
        if (recordingSetupIdRef.current !== recordingSetupId || audioContext.state === 'closed') {
          throw new Error('Microphone setup was interrupted. Please try again.');
        }

        const workletNode = new AudioWorkletNode(audioContext, 'pcm-processor', {
          processorOptions: {
            targetSampleRate: INPUT_SAMPLE_RATE,
          },
        });
        workletNodeRef.current = workletNode;
        captureNodeRef.current = workletNode;
        captureFlushRef.current = () => {
          workletNode.port.postMessage({ type: 'flush' });
        };
        captureCleanupRef.current = () => {
          try {
            source.disconnect(workletNode);
          } catch (_error) {}
        };

        workletNode.port.onmessage = (event) => {
          emitAudioChunk(event.data);
        };

        const silentGain = audioContext.createGain();
        silentGain.gain.value = 0;
        captureCleanupRef.current = () => {
          try {
            source.disconnect(workletNode);
          } catch (_error) {}
          try {
            workletNode.disconnect();
          } catch (_error) {}
          try {
            silentGain.disconnect();
          } catch (_error) {}
        };

        source.connect(workletNode);
        workletNode.connect(silentGain);
        silentGain.connect(audioContext.destination);
      } catch (workletError) {
        console.warn('AudioWorklet capture failed. Falling back to ScriptProcessorNode.', workletError);
        workletNodeRef.current = null;
        const fallbackCapture = createScriptProcessorCapture(
          audioContext,
          source,
          INPUT_SAMPLE_RATE,
          emitAudioChunk,
        );
        captureNodeRef.current = fallbackCapture.node;
        captureFlushRef.current = fallbackCapture.flush;
        captureCleanupRef.current = fallbackCapture.disconnect;
      }

      console.log("Emitting start_audio_session");
      socket?.emit('start_audio_session');
      setIsStartingAudio(true);
      if (audioStartTimeoutRef.current) {
        window.clearTimeout(audioStartTimeoutRef.current);
      }
      audioStartTimeoutRef.current = window.setTimeout(() => {
        audioStartTimeoutRef.current = null;
        stopAudioCapture();
        setAudioError('Audio session startup timed out waiting for the server.');
      }, 10000);
      setAudioError(null);
    } catch (err: any) {
      console.error("Failed to start recording:", err);
      setAudioError(err.message || "Could not start audio source");
    }
  };

  const toggleCamera = async () => {
    if (isCameraActive) {
      socket?.emit('stop_video_session');
      stopVideoCapture();
      return;
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Browser does not support video recording or permissions are missing.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      videoStreamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      socket?.emit('start_video_session');

      videoIntervalRef.current = window.setInterval(() => {
        if (videoRef.current && canvasRef.current) {
          const ctx = canvasRef.current.getContext('2d');
          if (ctx) {
            ctx.drawImage(videoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);
            const base64Image = canvasRef.current.toDataURL('image/jpeg', 0.5).split(',')[1];
            socket?.emit('video_chunk', base64Image);
          }
        }
      }, 1000); // 1 frame per second

      setIsCameraActive(true);
    } catch (err: any) {
      console.error("Failed to start camera:", err);
      alert("Could not access camera: " + err.message);
    }
  };

  const toggleSimulation = () => {
    if (!activeRoom?.code) {
      setRoomError('Create a room before starting the simulation.');
      return;
    }

    if (isSimulating) {
      if (stopSimulationRef.current) {
        stopSimulationRef.current();
        stopSimulationRef.current = null;
      }
      setIsSimulating(false);
    } else {
      stopSimulationRef.current = startSimulation(5, activeRoom.code);
      setIsSimulating(true);
    }
  };

  const [forgeError, setForgeError] = useState<string | null>(null);
  const [isForging, setIsForging] = useState(false);
  const activeUserName = userName.trim() || 'Anonymous Node';
  const activeRoleLabel = role === 'admin' ? 'Administrator' : 'Participant';
  const activeRoomCode = activeRoom?.code || '';
  const activeAdminName = activeRoom?.adminUserName || '';
  const participantCount = activeRoom?.participantCount || 0;
  const isEntryActionDisabled =
    isJoiningRoom || !userName.trim() || (entryMode === 'admin' ? !topic.trim() : !roomCodeInput.trim());

  const handleCreateRoom = async () => {
    if (!socket || !userName.trim() || !topic.trim()) {
      setRoomError('Display name and topic are required.');
      return;
    }

    try {
      setRoomError(null);
      setRoomNotice(null);
      setIsJoiningRoom(true);
      await waitForSocketConnection(socket);
      socket.emit('create_room', { userName: userName.trim(), topic: topic.trim() });
    } catch (error: any) {
      setRoomError(error.message || 'Unable to reach the server. Please try again.');
      setIsJoiningRoom(false);
    }
  };

  const handleJoinRoom = async () => {
    if (!socket || !userName.trim() || !roomCodeInput.trim()) {
      setRoomError('Display name and room code are required.');
      return;
    }

    try {
      setRoomError(null);
      setRoomNotice(null);
      setIsJoiningRoom(true);
      await waitForSocketConnection(socket);
      socket.emit('join_room', { userName: userName.trim(), roomCode: roomCodeInput.trim() });
    } catch (error: any) {
      setRoomError(error.message || 'Unable to reach the server. Please try again.');
      setIsJoiningRoom(false);
    }
  };

  const handleExitRoom = () => {
    if (!socket || !role) return;
    setRoomError(null);
    setRoomNotice(null);
    if (role === 'admin') {
      socket.emit('close_room');
    } else {
      socket.emit('leave_room');
    }
  };

  const copyRoomCode = async () => {
    if (!activeRoomCode || !navigator.clipboard) return;
    await navigator.clipboard.writeText(activeRoomCode);
    setRoomNotice(`Copied room code ${activeRoomCode}.`);
  };

  const requestSuggestion = () => {
    void ensurePlaybackAudioContext();
    socket?.emit('suggest_direction');
  };

  const handleManualForge = async () => {
    try {
      setForgeError(null);
      setIsForging(true);
      socket?.emit('forge_artifact');
    } catch (error: any) {
      console.error("Manual forge failed:", error);
      setForgeError(error.message || "Failed to generate diagram. Please try again.");
      setIsForging(false);
    }
  };

  if (!role) {
    return (
      <div className="min-h-screen overflow-hidden bg-[#050505] text-white font-sans flex items-center justify-center">
        {/* Subtle radial glows */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(52,211,153,0.12),_transparent_50%),radial-gradient(ellipse_at_bottom_right,_rgba(167,139,250,0.10),_transparent_45%)]" />

        <div className="relative z-10 flex flex-col items-center w-full max-w-lg px-6 py-12">
          {/* Title and tagline */}
          <div className="mb-2 inline-flex items-center gap-2.5 rounded-full border border-[#34D399]/20 bg-[#34D399]/10 px-4 py-2">
            <BrainCircuit className="h-4 w-4 text-[#34D399]" />
            <span className="text-[10px] font-mono uppercase tracking-[0.24em] text-[#34D399]">
              Live Collaborative Brainstorming
            </span>
          </div>

          <h1
            className="mt-5 text-center text-5xl font-bold uppercase tracking-tight sm:text-6xl"
            style={{
              fontFamily: "'Anton', sans-serif",
              background: 'linear-gradient(135deg, #34D399 0%, #22D3EE 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            The Cognitive Swarm
          </h1>
          <p className="mt-4 max-w-md text-center text-sm leading-7 text-white/55 sm:text-base">
            Create a room to guide the swarm or join an active session with a code.
          </p>

          {/* Form card */}
          <div className="mt-8 w-full rounded-2xl border border-white/8 bg-[#0F0F11] p-6 shadow-2xl transition-shadow hover:shadow-[0_0_40px_rgba(167,139,250,0.06)] sm:p-8">
            <div className="mb-5">
              <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-white/40">Enter Session</div>
              <div className="mt-1.5 text-xl font-semibold text-white">
                {entryMode === 'admin' ? 'Start a new room' : 'Join an existing room'}
              </div>
            </div>

            {/* Pill tabs */}
            <div className="mb-6 flex rounded-full border border-white/10 bg-white/5 p-1">
              {(['admin', 'participant'] as EntryMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => {
                    setEntryMode(mode);
                    setRoomError(null);
                    setRoomNotice(null);
                  }}
                  className={`flex-1 rounded-full px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.18em] transition-all ${focusRingClass} ${
                    entryMode === mode
                      ? 'bg-[#34D399] text-black shadow-[0_0_12px_rgba(52,211,153,0.3)]'
                      : 'text-white/55 hover:text-white'
                  }`}
                >
                  {mode === 'admin' ? 'Create Room' : 'Join Room'}
                </button>
              ))}
            </div>

            {/* Form fields */}
            <div className="mb-6 space-y-4 text-left">
              <div>
                <label className="mb-2 block text-xs font-mono uppercase tracking-[0.22em] text-white/45">Display Name</label>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="Enter your name..."
                  className={`w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white transition-colors placeholder:text-white/25 ${focusRingClass} focus:border-[#34D399]/50`}
                />
                <div className="mt-2 text-xs font-mono text-white/35">
                  Joining as <span className="text-[#34D399]">{activeUserName}</span>
                </div>
              </div>

              {entryMode === 'admin' ? (
                <div>
                  <label className="mb-2 block text-xs font-mono uppercase tracking-[0.22em] text-white/45">Brainstorming Topic</label>
                  <input
                    type="text"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="What is the room solving?"
                    className={`w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white transition-colors placeholder:text-white/25 ${focusRingClass} focus:border-[#34D399]/50`}
                  />
                </div>
              ) : (
                <div>
                  <label className="mb-2 block text-xs font-mono uppercase tracking-[0.22em] text-white/45">Room Code</label>
                  <input
                    type="text"
                    value={roomCodeInput}
                    onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                    placeholder="ABC123"
                    maxLength={6}
                    className={`w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 font-mono text-[#22D3EE] uppercase tracking-[0.3em] transition-colors placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-white/25 ${focusRingClass} focus:border-[#22D3EE]/50`}
                  />
                </div>
              )}
            </div>

            {/* Error / notice */}
            {(roomError || roomNotice) && (
              <div className={`mb-6 rounded-xl border px-4 py-3 text-left text-sm font-mono ${
                roomError ? 'border-[#FBBF24]/40 bg-[#FBBF24]/10 text-[#FBBF24]' : 'border-[#34D399]/30 bg-[#34D399]/10 text-[#34D399]'
              }`}>
                {roomError || roomNotice}
              </div>
            )}

            {/* CTA button */}
            <button
              onClick={() => {
                void ensurePlaybackAudioContext();
                if (entryMode === 'admin') {
                  void handleCreateRoom();
                } else {
                  void handleJoinRoom();
                }
              }}
              disabled={isEntryActionDisabled}
              className={`w-full rounded-xl px-5 py-4 text-sm font-semibold uppercase tracking-[0.12em] transition-all ${focusRingClass} ${
                isEntryActionDisabled
                  ? 'cursor-not-allowed bg-white/5 text-white/30 opacity-50'
                  : 'text-black shadow-[0_0_20px_rgba(52,211,153,0.25)]'
              }`}
              style={
                isEntryActionDisabled
                  ? undefined
                  : { background: 'linear-gradient(135deg, #34D399 0%, #22D3EE 100%)' }
              }
            >
              {isJoiningRoom ? 'Connecting...' : entryMode === 'admin' ? 'Create and Open Room' : 'Join Live Room'}
            </button>
          </div>

          {/* Minimal feature row */}
          <div className="mt-8 flex items-center justify-center gap-8 text-center">
            <div className="flex flex-col items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#34D399]/10 text-[#34D399]">
                <Zap className="h-4 w-4" />
              </div>
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/40">Host</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#22D3EE]/10 text-[#22D3EE]">
                <Users className="h-4 w-4" />
              </div>
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/40">Collaborate</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#A78BFA]/10 text-[#A78BFA]">
                <Activity className="h-4 w-4" />
              </div>
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/40">Forge</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans overflow-hidden flex flex-col">
      <header className="z-10 border-b border-white/8 bg-[#0F0F11]/80 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-4 px-4 py-4 sm:px-6">
          {/* Left zone: Logo + Phase badge */}
          <div className="flex items-center gap-3 shrink-0">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl border ${phaseColors[phase].border} ${phaseColors[phase].bg} ${phaseColors[phase].glow}`}>
              <BrainCircuit className={`h-5 w-5 ${phaseColors[phase].text}`} />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-base font-bold tracking-tight uppercase leading-none" style={{ fontFamily: "'Anton', sans-serif" }}>
                Cognitive Swarm
              </h1>
              <span className={`mt-1 inline-flex rounded-full border ${phaseColors[phase].border} ${phaseColors[phase].bg} px-2.5 py-0.5 text-[9px] font-mono uppercase tracking-[0.22em] ${phaseColors[phase].text}`}>
                {phaseLabels[phase]}
              </span>
            </div>
          </div>

          {/* Center zone: Topic */}
          <div className="flex-1 min-w-0 text-center px-4">
            {role === 'admin' ? (
              isEditingTopic ? (
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  onBlur={() => {
                    if (topic.trim()) {
                      setIsEditingTopic(false);
                      socket?.emit('set_topic', topic);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && topic.trim()) {
                      setIsEditingTopic(false);
                      socket?.emit('set_topic', topic);
                    }
                  }}
                  autoFocus
                  className={`w-full max-w-xl rounded-lg border border-[#34D399]/40 bg-white/5 px-3 py-1.5 text-center text-sm text-white ${focusRingClass}`}
                />
              ) : (
                <button
                  onClick={() => setIsEditingTopic(true)}
                  className={`max-w-xl truncate text-sm font-medium text-white/90 transition-colors hover:text-white ${focusRingClass}`}
                  title="Click to edit topic"
                  style={{
                    background: 'linear-gradient(135deg, #34D399 0%, #22D3EE 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  {topic}
                </button>
              )
            ) : (
              <div className="truncate text-sm font-medium" style={{
                background: 'linear-gradient(135deg, #34D399 0%, #22D3EE 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}>
                {topic}
              </div>
            )}
          </div>

          {/* Right zone: Info chips + controls */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => void copyRoomCode()}
              className={`hidden sm:flex items-center gap-1.5 rounded-lg border border-[#22D3EE]/20 bg-[#22D3EE]/8 px-3 py-1.5 font-mono text-xs tracking-[0.2em] text-[#22D3EE] transition-colors hover:bg-[#22D3EE]/15 ${focusRingClass}`}
              title="Click to copy"
            >
              {activeRoomCode}
            </button>

            <div className="hidden md:flex items-center gap-1.5 rounded-lg border border-white/8 bg-white/5 px-3 py-1.5 text-[11px] font-mono text-white/50">
              <Users className="h-3 w-3" />
              {participantCount}
            </div>

            <div className="hidden md:block h-5 w-px bg-white/10" />

            <div className="hidden lg:block text-[11px] font-mono text-white/50 truncate max-w-[100px]">
              {activeUserName}
            </div>
          </div>
        </div>

        {/* Controls bar */}
        <div className="flex items-center justify-between gap-3 border-t border-white/5 px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-1 rounded-lg border border-white/8 bg-white/[0.03] p-1">
            {(['divergent', 'convergent', 'forging'] as const).map((p) => (
              <button
                key={p}
                onClick={() => role === 'admin' && socket?.emit('set_phase', p)}
                disabled={role !== 'admin'}
                className={`rounded-md px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] transition-all ${focusRingClass} ${
                  phase === p
                    ? `${phaseColors[p].bg} ${phaseColors[p].text} ${phaseColors[p].glow}`
                    : 'text-white/40 hover:text-white/70'
                } ${role !== 'admin' && phase !== p ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                {phaseLabels[p]}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`h-9 w-14 rounded-lg border border-white/10 object-cover ${isCameraActive ? 'block' : 'hidden'}`}
            />
            <canvas ref={canvasRef} className="hidden" width={320} height={240} />

            {role === 'admin' && (
              <button
                onClick={toggleSimulation}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[11px] transition-all ${focusRingClass} ${
                  isSimulating
                    ? 'border-[#A78BFA]/40 bg-[#A78BFA]/15 text-[#A78BFA] shadow-[0_0_12px_rgba(167,139,250,0.2)]'
                    : 'border-white/8 bg-white/5 text-white/55 hover:bg-white/8'
                }`}
              >
                <Bot className={`h-3.5 w-3.5 ${isSimulating ? 'animate-bounce' : ''}`} />
                {isSimulating ? 'Stop Sim' : 'Simulate'}
              </button>
            )}

            <button
              onClick={toggleCamera}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-[11px] transition-all ${focusRingClass} ${
                isCameraActive
                  ? 'border border-[#22D3EE]/40 bg-[#22D3EE]/15 text-[#22D3EE] shadow-[0_0_12px_rgba(34,211,238,0.2)]'
                  : 'border border-white/8 bg-white/5 text-white/55 hover:bg-white/8'
              }`}
            >
              {isCameraActive ? <Camera className="h-3.5 w-3.5" /> : <CameraOff className="h-3.5 w-3.5" />}
              {isCameraActive ? 'Cam On' : 'Cam Off'}
            </button>

            {role === 'admin' && phase === 'divergent' && (
              <button
                onClick={requestSuggestion}
                className={`flex items-center gap-1.5 rounded-lg border border-[#34D399]/30 bg-[#34D399]/10 px-3 py-1.5 font-mono text-[11px] text-[#34D399] transition-all hover:bg-[#34D399]/20 ${focusRingClass}`}
              >
                <BrainCircuit className="h-3.5 w-3.5" />
                Cue Anchor
              </button>
            )}

            <button
                onClick={toggleRecording}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-[11px] transition-all ${focusRingClass} ${
                  isRecording || isStartingAudio
                    ? 'border border-red-500/40 bg-red-500/15 text-red-300 shadow-[0_0_12px_rgba(239,68,68,0.2)]'
                    : 'border border-white/8 bg-white/5 text-white/55 hover:bg-white/8'
                }`}
              >
                {isRecording ? <Mic className="h-3.5 w-3.5 animate-pulse" /> : <MicOff className="h-3.5 w-3.5" />}
                {isRecording ? 'Live' : isStartingAudio ? 'Connecting...' : 'Join'}
              </button>

            <div className="h-4 w-px bg-white/8" />

            <button
              onClick={handleExitRoom}
              className={`flex items-center gap-1.5 rounded-lg border border-white/8 bg-white/5 px-3 py-1.5 font-mono text-[11px] text-white/45 transition-all hover:bg-white/8 hover:text-white/70 ${focusRingClass}`}
            >
              {role === 'admin' ? 'End' : 'Leave'}
            </button>
          </div>
        </div>
      </header>

      {(roomError || roomNotice) && (
        <div className="border-b border-white/5 px-4 py-2.5 sm:px-6">
          <div className={`rounded-xl border px-4 py-2.5 text-sm font-mono ${
            roomError ? 'border-[#FBBF24]/30 bg-[#FBBF24]/8 text-[#FBBF24]' : 'border-[#34D399]/20 bg-[#34D399]/8 text-[#34D399]'
          }`}>
            {roomError || roomNotice}
          </div>
        </div>
      )}

      <main className="flex-1 flex flex-col xl:flex-row">
        <div className="flex-1 relative min-h-[56vh] xl:min-h-0 border-b border-white/10 xl:border-b-0 xl:border-r overflow-hidden">
          {(phase === 'divergent' || phase === 'forging') && (
            <div className="absolute inset-0">
              <IdeaSwarm
                ideas={ideas}
                edges={swarmEdges}
                selectedIdeaId={selectedIdeaId}
                onIdeaClick={(idea) => setSelectedIdeaId(idea.id)}
              />
              <div className="absolute bottom-6 left-6 right-6 flex flex-col gap-3 pointer-events-none">
                <div className="flex w-fit items-center gap-2 rounded-lg border border-white/8 bg-black/60 px-4 py-2 text-white/50 backdrop-blur-xl">
                  <Activity className={`w-4 h-4 ${phaseColors[phase].text}`} />
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em]">
                    {phase === 'forging' ? 'Phase 3: Forging' : 'Phase 1: Idea Swarm'}
                  </span>
                </div>

                {directionSuggestion && (
                  <div className="flex max-w-2xl items-start gap-3 rounded-xl border border-[#34D399]/30 bg-[#0F0F11]/90 px-4 py-3 shadow-lg backdrop-blur-xl">
                    <BrainCircuit className="w-4 h-4 text-[#34D399] flex-shrink-0 mt-0.5" />
                    <div className="flex flex-col">
                      <span className="mb-1 text-[10px] font-mono uppercase tracking-[0.22em] text-[#34D399]">
                        {directionSuggestion.kind === 'audience_nudge' ? 'Anchor Cue' : 'Untouched Direction'}
                      </span>
                      <span className="text-white/90 text-sm">{directionSuggestion.suggestion}</span>
                      {directionSuggestion.rationale && (
                        <span className="text-white/45 text-xs font-mono mt-1">{directionSuggestion.rationale}</span>
                      )}
                    </div>
                  </div>
                )}
                
                {audioError && (
                  <div className="flex max-w-2xl items-start gap-3 rounded-xl border border-[#FBBF24]/30 bg-[#0F0F11]/90 px-4 py-3 pointer-events-auto shadow-lg backdrop-blur-xl">
                    <AlertTriangle className="mt-0.5 w-4 h-4 text-[#FBBF24] flex-shrink-0" />
                    <div className="flex flex-1 flex-col gap-3">
                      <span className="mb-1 text-xs font-mono text-[#FBBF24]/80">Microphone access failed: {audioError}</span>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <input
                          type="text"
                          value={manualIdea}
                          onChange={e => setManualIdea(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && manualIdea.trim()) {
                              socket?.emit('add_idea', { text: manualIdea, cluster: 'General', authorName: userNameRef.current });
                              setManualIdea('');
                            }
                          }}
                          placeholder="Type an idea and press Enter..."
                          className={`flex-1 rounded-lg border border-[#FBBF24]/20 bg-black/50 px-3 py-2 text-sm text-white font-mono placeholder:text-white/30 ${focusRingClass}`}
                        />
                        <button
                          onClick={() => {
                            if (manualIdea.trim()) {
                              socket?.emit('add_idea', { text: manualIdea, cluster: 'General', authorName: userNameRef.current });
                              setManualIdea('');
                            }
                          }}
                          className={`rounded-lg bg-[#FBBF24]/15 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#FBBF24] transition-colors hover:bg-[#FBBF24]/25 ${focusRingClass}`}
                        >
                          Send
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Edit Idea Panel */}
              {selectedIdeaId && (
                <motion.div 
                  initial={{ x: -300, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  className="absolute top-0 left-0 z-50 flex h-full w-full max-w-[22rem] flex-col border-r border-[#A78BFA]/15 bg-[#0F0F11]/90 p-6 shadow-2xl backdrop-blur-xl"
                >
                  <div className="flex justify-between items-center mb-6">
                    <h2 className="text-sm font-mono uppercase tracking-[0.22em] text-white/70">Edit Node</h2>
                    <button onClick={() => setSelectedIdeaId(null)} className={`text-white/40 text-sm hover:text-white transition-colors ${focusRingClass}`}>✕</button>
                  </div>

                  {(() => {
                    const idea = ideas.find(i => i.id === selectedIdeaId);
                    if (!idea) return null;
                    return (
                      <div className="flex flex-col gap-4">
                        <div>
                          <label className="block text-[10px] text-white/40 tracking-[0.2em] font-mono uppercase mb-1.5">Author</label>
                          <div className="text-sm text-white/90 bg-white/5 px-3 py-2 rounded-lg border border-white/8">{idea.authorName}</div>
                        </div>
                        <div>
                          <label className="block text-[10px] text-white/40 tracking-[0.2em] font-mono uppercase mb-1.5">Weight (Votes)</label>
                          <div className="flex items-center gap-3">
                            <div className="text-sm text-white/90 bg-white/5 px-3 py-2 rounded-lg border border-white/8">{idea.weight}</div>
                            <button
                              onClick={() => handleVote(idea.id, 1)}
                              className="bg-[#34D399]/10 hover:bg-[#34D399]/20 text-[#34D399] px-3 py-1.5 rounded-lg text-[10px] font-mono transition-colors"
                              title={`Cost: ${Math.pow((userVotes[idea.id] || 0) + 1, 2) - Math.pow(userVotes[idea.id] || 0, 2)} credits`}
                            >
                              +1 Upvote
                            </button>
                            <button
                              onClick={() => handleVote(idea.id, -1)}
                              className="bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg text-[10px] font-mono transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              disabled={(userVotes[idea.id] || 0) <= 0}
                            >
                              -1 Downvote
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] text-white/40 tracking-[0.2em] font-mono uppercase mb-1.5">Cluster</label>
                          <input
                            type="text"
                            value={idea.cluster}
                            onChange={(e) => handleEditIdea(idea.id, idea.text, e.target.value)}
                            className="w-full text-sm text-white bg-white/5 px-3 py-2 rounded-lg border border-white/10 focus:border-[#A78BFA]/50 focus:outline-none transition-colors"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="block text-[10px] text-white/40 tracking-[0.2em] font-mono uppercase mb-1.5">Idea Text</label>
                          <textarea
                            value={idea.text}
                            onChange={(e) => handleEditIdea(idea.id, e.target.value, idea.cluster)}
                            className="w-full h-32 text-sm text-white bg-white/5 px-3 py-2 rounded-lg border border-white/10 focus:border-[#A78BFA]/50 focus:outline-none transition-colors resize-none"
                          />
                        </div>
                      </div>
                    );
                  })()}
                </motion.div>
              )}
            </div>
          )}
          
          {phase === 'convergent' && (
            <div className="absolute inset-0 overflow-y-auto p-6 sm:p-8">
              <IdeaVoting
                ideas={ideas}
                socket={socket}
                credits={credits}
                userVotes={userVotes}
                onVote={handleVote}
              />
            </div>
          )}

          {phase === 'forging' && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 flex items-center justify-center p-8 overflow-hidden"
            >
              {/* Background animated rings */}
              <div className="absolute inset-0 flex items-center justify-center opacity-30 pointer-events-none">
                <motion.div 
                  animate={{ rotate: 360 }} 
                  transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                  className="w-[500px] h-[500px] border-2 border-[#A78BFA]/20 rounded-full border-dashed absolute"
                />
                <motion.div
                  animate={{ rotate: -360 }}
                  transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
                  className="w-[350px] h-[350px] border-2 border-[#22D3EE]/25 rounded-full border-dotted absolute"
                />
                <motion.div
                  animate={{ scale: [1, 1.5, 1], opacity: [0.1, 0.3, 0.1] }}
                  transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                  className="w-[200px] h-[200px] rounded-full blur-[100px] absolute"
                  style={{ background: 'linear-gradient(135deg, #A78BFA, #22D3EE)' }}
                />
              </div>

              <div className="text-center max-w-md relative z-10 rounded-2xl border border-white/8 bg-[#0F0F11]/80 p-8 backdrop-blur-xl">
                <motion.div
                  animate={{
                    scale: [1, 1.2, 1],
                    rotate: [0, 5, -5, 0],
                    filter: ['drop-shadow(0 0 10px rgba(167,139,250,0.3))', 'drop-shadow(0 0 30px rgba(167,139,250,0.8))', 'drop-shadow(0 0 10px rgba(167,139,250,0.3))']
                  }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  className="inline-block mb-8"
                >
                  <Zap className="w-16 h-16 text-[#A78BFA]" />
                </motion.div>
                
                <h2 className="text-4xl font-bold mb-4 tracking-wider uppercase" style={{ fontFamily: "'Anton', sans-serif" }}>
                  The Forging
                </h2>
                
                <p className="text-white/70 font-mono text-sm leading-relaxed mb-8">
                  The swarm is collapsing into a structured Entity-Relationship diagram. The Visual Scribe is processing the consensus.
                </p>

                <div className="flex justify-center items-center gap-3 mb-8">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      animate={{ 
                        scale: [1, 1.5, 1],
                        opacity: [0.3, 1, 0.3] 
                      }}
                      transition={{ 
                        duration: 1.5, 
                        repeat: Infinity, 
                        delay: i * 0.2,
                        ease: "easeInOut"
                      }}
                      className="w-1.5 h-1.5 bg-[#A78BFA] rounded-full"
                    />
                  ))}
                </div>

                {role === 'admin' ? (
                  <>
                    <button
                      onClick={handleManualForge}
                      disabled={isForging}
                      className={`px-6 py-3 font-bold rounded-xl transition-colors uppercase tracking-wider text-sm flex items-center gap-2 mx-auto shadow-[0_0_20px_rgba(167,139,250,0.3)] ${isForging ? 'opacity-50 cursor-not-allowed' : ''}`}
                      style={{ background: 'linear-gradient(135deg, #A78BFA, #22D3EE)', color: '#000' }}
                    >
                      <Zap className={`w-4 h-4 ${isForging ? 'animate-pulse' : ''}`} />
                      {isForging ? 'Forging...' : 'Forge Diagram Now'}
                    </button>

                    {forgeError && (
                      <div className="mt-4 p-3 bg-[#FBBF24]/10 border border-[#FBBF24]/30 rounded-xl text-[#FBBF24] text-xs font-mono">
                        {forgeError}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="px-6 py-3 bg-white/5 text-white/40 font-mono rounded-xl text-xs border border-white/10 inline-block">
                    Waiting for Administrator to forge...
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </div>

        <div className="w-full xl:w-[400px] min-h-[420px] xl:min-h-0 bg-[#0a0a0a] flex flex-col border-t xl:border-t-0 xl:border-l border-white/8">
          <div className="flex-1 flex flex-col min-h-0">
            <div className="p-4 border-b border-white/8 flex items-center gap-3">
              <BrainCircuit className="w-3.5 h-3.5 text-[#A78BFA]" />
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/50">Live Artifact</span>
              <div className="h-px flex-1 mx-2" style={{ background: 'linear-gradient(90deg, #34D399, #22D3EE, transparent)' }} />
            </div>
            <div className="flex-1 overflow-hidden relative">
              <ArtifactCanvas artifact={artifact} />
            </div>
          </div>
          
          <div className="h-[320px] xl:h-[35%] border-t border-white/8 flex flex-col bg-[#050505]">
            <div className="p-4 border-b border-white/8 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-[#22D3EE]" />
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/50">Top Contributors</span>
              </div>
              <div className="rounded-lg border border-white/8 bg-white/5 px-3 py-1 text-[10px] font-mono uppercase tracking-[0.18em] text-white/35">
                {ideas.length} ideas
              </div>
            </div>
            <div className="flex-1 overflow-auto p-3 space-y-2">
              {(() => {
                const authorScores: Record<string, number> = {};
                ideas.forEach(idea => {
                  if (idea.authorName) {
                    authorScores[idea.authorName] = (authorScores[idea.authorName] || 0) + idea.weight;
                  }
                });
                const sortedAuthors = Object.entries(authorScores)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5);

                if (sortedAuthors.length === 0) {
                  return (
                    <div className="mt-4 rounded-xl border border-dashed border-white/8 bg-white/[0.02] px-4 py-6 text-center">
                      <div className="text-[9px] font-mono uppercase tracking-[0.22em] text-white/30">Leaderboard idle</div>
                      <div className="mt-2 text-sm text-white/25">No contributions yet.</div>
                    </div>
                  );
                }

                return sortedAuthors.map(([name, score], idx) => (
                  <motion.div key={name} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.05 }}>
                    <div className="flex items-center justify-between rounded-xl border border-white/6 bg-white/[0.03] p-2.5 transition-colors hover:border-white/12">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className={`flex h-6 w-6 items-center justify-center rounded-lg text-xs font-bold ${idx === 0 ? 'bg-[#FBBF24]/15 text-[#FBBF24]' : idx === 1 ? 'bg-gray-300/15 text-gray-300' : idx === 2 ? 'bg-orange-400/15 text-orange-400' : 'bg-white/8 text-white/40'}`}>
                          {idx + 1}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium text-white/80">{name}</div>
                        </div>
                      </div>
                      <div className="rounded-lg border border-[#34D399]/15 bg-[#34D399]/8 px-3 py-1 text-xs font-bold font-mono text-[#34D399]">
                        {score}
                      </div>
                    </div>
                  </motion.div>
                ));
              })()}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
