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

export default function App() {
  const [userName, setUserName] = useState('');
  const userNameRef = useRef('');
  useEffect(() => { userNameRef.current = userName; }, [userName]);
  const [role, setRole] = useState<'admin' | 'participant' | null>(null);
  const roleRef = useRef<'admin' | 'participant' | null>(null);
  useEffect(() => { roleRef.current = role; }, [role]);
  const [socket, setSocket] = useState<Socket | null>(null);
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
  const stopSimulationRef = useRef<(() => void) | null>(null);
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextPlayTimeRef = useRef<number>(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoIntervalRef = useRef<number | null>(null);
  const suggestionTimeoutRef = useRef<number | null>(null);
  const anchorAnnouncementIdRef = useRef(0);
  const editDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncedTextRef = useRef<Record<string, string>>({});

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

  const playGeminiAudioChunk = async (chunk: AudioChunkPayload) => {
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

    const currentTime = ctx.currentTime;
    if (nextPlayTimeRef.current < currentTime) {
      nextPlayTimeRef.current = currentTime;
    }

    source.start(nextPlayTimeRef.current);
    nextPlayTimeRef.current += audioBuffer.duration;

    activeSourcesRef.current.push(source);
    source.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter((activeSource) => activeSource !== source);
    };
  };

  const interruptAnchorPlayback = (clearSuggestion = false) => {
    audioQueueRef.current = [];
    activeSourcesRef.current.forEach(source => {
      try {
        source.stop();
      } catch (e) {}
    });
    activeSourcesRef.current = [];
    const playbackContext = playbackAudioContextRef.current || audioContextRef.current;
    if (playbackContext) {
      nextPlayTimeRef.current = playbackContext.currentTime;
    }
    if (clearSuggestion) {
      setDirectionSuggestion(null);
      if (suggestionTimeoutRef.current) {
        window.clearTimeout(suggestionTimeoutRef.current);
        suggestionTimeoutRef.current = null;
      }
    }
  };

  useEffect(() => {
    if (!socket || !role || !userName.trim()) return;
    socket.emit('register_participant', {
      userName: userName.trim(),
      role,
    });
  }, [socket, role, userName]);

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
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('state_sync', (state) => {
      setTopic(state.topic || '');
      setPhase(state.phase);
      setIdeas(state.ideas);
      setSwarmEdges(state.edges || []);
      setArtifact(state.artifactData || null);
    });

    newSocket.on('topic_updated', (newTopic) => {
      setTopic(newTopic);
    });

    newSocket.on('error', (err: any) => {
      console.error("Server error:", err);
      setAudioError(err.message || "Unknown server error");
      setIsForging(false);
    });

    newSocket.on('ideas_batch_added', (newIdeas: any[]) => {
      setIdeas((prev) => [...prev, ...newIdeas]);
    });

    newSocket.on('ideas_batch_updated', (updatedIdeas: any[]) => {
      setIdeas((prev) => prev.map(i => {
        const updated = updatedIdeas.find(u => u.id === i.id);
        return updated ? updated : i;
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
      await playGeminiAudioChunk({ data, mimeType });
    });

    newSocket.on('audio_interrupted', () => {
      interruptAnchorPlayback();
    });

    newSocket.on('audio_response', async (audioChunk: AudioChunkPayload) => {
      const payload = typeof audioChunk === 'string' ? { data: audioChunk, mimeType: undefined } : audioChunk;
      console.log("Received audio response of length:", payload.data.length, "mimeType:", payload.mimeType || 'audio/pcm;rate=24000');
      await playGeminiAudioChunk(payload);
    });

    newSocket.on('audio_session_closed', () => {
      setIsRecording(false);
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
      }
      if (workletNodeRef.current) {
        workletNodeRef.current.disconnect();
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
    });

    return () => {
      if (suggestionTimeoutRef.current) {
        window.clearTimeout(suggestionTimeoutRef.current);
      }
      newSocket.disconnect();
    };
  }, []);

  // Gemini Live API Connection
  const toggleRecording = async () => {
    if (isRecording) {
      // Stop recording
      if (workletNodeRef.current) {
        workletNodeRef.current.port.postMessage({ type: 'flush' });
        await new Promise((resolve) => window.setTimeout(resolve, 30));
      }
      socket?.emit('stop_audio_session');
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
      }
      if (workletNodeRef.current) {
        workletNodeRef.current.disconnect();
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
      setIsRecording(false);
      return;
    }

    try {
      interruptAnchorPlayback(true);
      socket?.emit('interrupt_anchor');
      await ensurePlaybackAudioContext();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Browser does not support audio recording or permissions are missing.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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

      const source = audioContext.createMediaStreamSource(stream);
      
      await audioContext.audioWorklet.addModule('/pcm-processor.js');
      
      const workletNode = new AudioWorkletNode(audioContext, 'pcm-processor', {
        processorOptions: {
          targetSampleRate: INPUT_SAMPLE_RATE,
        },
      });
      workletNodeRef.current = workletNode;

      if (audioContext.sampleRate !== INPUT_SAMPLE_RATE) {
        console.warn(`Microphone context is running at ${audioContext.sampleRate} Hz and will be resampled to ${INPUT_SAMPLE_RATE} Hz before upload.`);
      }

      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      
      source.connect(workletNode);
      workletNode.connect(silentGain);
      silentGain.connect(audioContext.destination);

      console.log("Emitting start_audio_session");
      socket?.emit('start_audio_session', { topic, userName: userNameRef.current });

      let chunkCount = 0;
      workletNode.port.onmessage = (e) => {
        const buffer = e.data;
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64Data = window.btoa(binary);
        chunkCount++;
        if (chunkCount % 10 === 0) {
          console.log("Sent 10 audio chunks");
        }
        socket?.emit('audio_chunk', base64Data);
      };

      setIsRecording(true);
      setAudioError(null);
    } catch (err: any) {
      console.error("Failed to start recording:", err);
      setAudioError(err.message || "Could not start audio source");
    }
  };

  const toggleCamera = async () => {
    if (isCameraActive) {
      socket?.emit('stop_video_session');
      if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach(t => t.stop());
      }
      if (videoIntervalRef.current) {
        window.clearInterval(videoIntervalRef.current);
        videoIntervalRef.current = null;
      }
      setIsCameraActive(false);
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

      socket?.emit('start_video_session', { topic, userName: userNameRef.current });

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
    if (isSimulating) {
      if (stopSimulationRef.current) {
        stopSimulationRef.current();
        stopSimulationRef.current = null;
      }
      setIsSimulating(false);
    } else {
      stopSimulationRef.current = startSimulation(5); // Spawn 5 virtual clients
      setIsSimulating(true);
    }
  };

  const [forgeError, setForgeError] = useState<string | null>(null);
  const [isForging, setIsForging] = useState(false);

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
      <div className="min-h-screen bg-[#050505] text-white font-sans flex items-center justify-center overflow-hidden">
        <div className="max-w-md w-full p-8 bg-[#0a0a0a] border border-white/10 rounded-2xl shadow-2xl text-center">
          <BrainCircuit className="w-16 h-16 text-[#00FF00] mx-auto mb-6" />
          <h1 className="text-3xl font-bold mb-2 uppercase tracking-tight" style={{ fontFamily: "'Anton', sans-serif" }}>
            The Cognitive Swarm
          </h1>
          <p className="text-white/60 font-mono text-sm mb-8">
            Select your role to join the session.
          </p>
          
          <div className="mb-6 text-left space-y-4">
            <div>
              <label className="block text-xs font-mono text-white/50 mb-2 uppercase tracking-wider">Brainstorming Topic</label>
              <input 
                type="text" 
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Enter topic..."
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-[#00FF00]/50 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-white/50 mb-2 uppercase tracking-wider">Display Name</label>
              <input 
                type="text" 
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Enter your name..."
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-[#00FF00]/50 transition-colors"
              />
            </div>
          </div>

          <div className="space-y-4">
            <button
              onClick={() => {
                void ensurePlaybackAudioContext();
                setRole('admin');
                socket?.emit('set_topic', topic);
              }}
              disabled={!userName.trim() || !topic.trim()}
              className={`w-full py-4 px-6 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all flex items-center justify-between group ${(!userName.trim() || !topic.trim()) ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#00FF00]/20 flex items-center justify-center group-hover:bg-[#00FF00]/30 transition-colors">
                  <Zap className="w-5 h-5 text-[#00FF00]" />
                </div>
                <div className="text-left">
                  <div className="font-bold text-lg">Administrator</div>
                  <div className="text-xs text-white/50 font-mono">Manage phases & simulate</div>
                </div>
              </div>
            </button>

            <button
              onClick={() => {
                void ensurePlaybackAudioContext();
                setRole('participant');
              }}
              disabled={!userName.trim() || !topic.trim()}
              className={`w-full py-4 px-6 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all flex items-center justify-between group ${(!userName.trim() || !topic.trim()) ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center group-hover:bg-blue-500/30 transition-colors">
                  <Users className="w-5 h-5 text-blue-400" />
                </div>
                <div className="text-left">
                  <div className="font-bold text-lg">Participant</div>
                  <div className="text-xs text-white/50 font-mono">Brainstorm & vote</div>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans overflow-hidden flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between p-6 border-b border-white/10 bg-black/50 backdrop-blur-md z-10">
        <div className="flex items-center gap-3">
          <BrainCircuit className="w-8 h-8 text-[#00FF00]" />
          <div className="flex flex-col">
            <h1 className="text-2xl font-bold tracking-tight uppercase leading-none" style={{ fontFamily: "'Anton', sans-serif" }}>
              The Cognitive Swarm
            </h1>
            {role === 'admin' ? (
              <div className="flex items-center mt-1">
                {isEditingTopic ? (
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
                    className="bg-white/10 border border-[#00FF00]/50 rounded px-2 py-0.5 text-sm text-[#00FF00] font-mono focus:outline-none w-64"
                  />
                ) : (
                  <div 
                    onClick={() => setIsEditingTopic(true)}
                    className="text-sm text-[#00FF00] font-mono cursor-pointer hover:underline"
                    title="Click to edit topic"
                  >
                    Topic: {topic}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-[#00FF00] font-mono mt-1">
                Topic: {topic}
              </div>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex bg-white/5 rounded-full p-1">
            {['divergent', 'convergent', 'forging'].map((p) => (
              <button
                key={p}
                onClick={() => role === 'admin' && socket?.emit('set_phase', p)}
                disabled={role !== 'admin'}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider transition-colors ${
                  phase === p ? 'bg-[#00FF00] text-black' : 'text-white/50 hover:text-white'
                } ${role !== 'admin' && phase !== p ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {p}
              </button>
            ))}
          </div>
          
          {role === 'admin' && (
            <button
              onClick={toggleSimulation}
              className={`flex items-center gap-2 px-4 py-2 rounded-full font-mono text-sm transition-all ${
                isSimulating 
                  ? 'bg-purple-500/20 text-purple-400 border border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.5)]' 
                  : 'bg-white/5 text-white/70 hover:bg-white/10 border border-white/10'
              }`}
            >
              <Bot className={`w-4 h-4 ${isSimulating ? 'animate-bounce' : ''}`} />
              {isSimulating ? 'Stop Swarm Sim' : 'Simulate Swarm'}
            </button>
          )}

          <div className="flex items-center gap-2">
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              muted 
              className={`w-16 h-12 object-cover rounded-md border border-white/10 ${isCameraActive ? 'block' : 'hidden'}`} 
            />
            <canvas ref={canvasRef} className="hidden" width={320} height={240} />
            <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-2">
              <span className="text-xs font-mono text-white/50 uppercase">Credits</span>
              <span className="text-sm font-bold text-[#00FF00]">{credits}</span>
            </div>
            
            <button
              onClick={toggleCamera}
              className={`flex items-center gap-2 px-4 py-2 rounded-full font-mono text-sm transition-all ${
                isCameraActive 
                  ? 'bg-blue-500/20 text-blue-400 border border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.5)]' 
                  : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              {isCameraActive ? <Camera className="w-4 h-4" /> : <CameraOff className="w-4 h-4" />}
              {isCameraActive ? 'Camera On' : 'Camera Off'}
            </button>
            {role === 'admin' && phase === 'divergent' && (
              <button
                onClick={requestSuggestion}
                className="flex items-center gap-2 px-4 py-2 rounded-full font-mono text-sm transition-all bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 hover:bg-emerald-500/30"
              >
                <BrainCircuit className="w-4 h-4" />
                Cue Anchor
              </button>
            )}
            <button
              onClick={toggleRecording}
              className={`flex items-center gap-2 px-4 py-2 rounded-full font-mono text-sm transition-all ${
                isRecording 
                  ? 'bg-red-500/20 text-red-500 border border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.5)]' 
                  : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              {isRecording ? <Mic className="w-4 h-4 animate-pulse" /> : <MicOff className="w-4 h-4" />}
              {isRecording ? 'Listening...' : 'Join Swarm'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 relative flex">
        {/* Left Panel: 3D Swarm or Voting */}
        <div className="flex-1 relative border-r border-white/10 overflow-hidden">
          {(phase === 'divergent' || phase === 'forging') && (
            <div className="absolute inset-0">
              <IdeaSwarm
                ideas={ideas}
                edges={swarmEdges}
                selectedIdeaId={selectedIdeaId}
                onIdeaClick={(idea) => setSelectedIdeaId(idea.id)}
              />
              <div className="absolute bottom-6 left-6 right-6 flex flex-col gap-2 pointer-events-none">
                <div className="flex items-center gap-2 text-white/50 font-mono text-xs uppercase tracking-wider">
                  <Activity className="w-4 h-4" />
                  <span>Phase 1: Idea Swarm (Divergent)</span>
                </div>

                {directionSuggestion && (
                  <div className="flex items-start gap-3 bg-emerald-950/85 backdrop-blur-md border border-emerald-400/40 rounded-lg px-4 py-3 pointer-events-none shadow-lg max-w-2xl">
                    <BrainCircuit className="w-5 h-5 text-emerald-300 flex-shrink-0 mt-0.5" />
                    <div className="flex flex-col">
                      <span className="text-emerald-300 text-xs font-mono uppercase tracking-wider mb-1">
                        {directionSuggestion.kind === 'audience_nudge' ? 'Anchor Cue' : 'Untouched Direction'}
                      </span>
                      <span className="text-white text-sm">{directionSuggestion.suggestion}</span>
                      {directionSuggestion.rationale && (
                        <span className="text-white/60 text-xs font-mono mt-1">{directionSuggestion.rationale}</span>
                      )}
                    </div>
                  </div>
                )}
                
                {audioError && (
                  <div className="flex items-center gap-3 bg-red-950/80 backdrop-blur-md border border-red-500/50 rounded-lg px-4 py-3 pointer-events-auto shadow-lg max-w-2xl">
                    <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
                    <div className="flex flex-col flex-1">
                      <span className="text-red-400 text-xs font-mono mb-1">Microphone access failed: {audioError}</span>
                      <div className="flex items-center gap-2">
                        <input 
                          type="text" 
                          value={manualIdea}
                          onChange={e => setManualIdea(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && manualIdea.trim()) {
                              socket?.emit('add_idea', { text: manualIdea, authorName: userNameRef.current });
                              setManualIdea('');
                            }
                          }}
                          placeholder="Type your idea here and press Enter..."
                          className="flex-1 bg-black/50 border border-red-500/30 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-red-400 font-mono"
                        />
                        <button 
                          onClick={() => {
                            if (manualIdea.trim()) {
                              socket?.emit('add_idea', { text: manualIdea, authorName: userNameRef.current });
                              setManualIdea('');
                            }
                          }}
                          className="bg-red-500/20 hover:bg-red-500/40 text-red-300 px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-colors"
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
                  className="absolute top-0 left-0 w-80 h-full bg-black/80 backdrop-blur-xl border-r border-white/10 p-6 flex flex-col z-50 shadow-2xl"
                >
                  <div className="flex justify-between items-center mb-6">
                    <h2 className="text-lg font-semibold text-white font-mono uppercase tracking-wider">Edit Node</h2>
                    <button onClick={() => setSelectedIdeaId(null)} className="text-white/50 hover:text-white transition-colors">✕</button>
                  </div>
                  
                  {(() => {
                    const idea = ideas.find(i => i.id === selectedIdeaId);
                    if (!idea) return null;
                    return (
                      <div className="flex flex-col gap-4">
                        <div>
                          <label className="block text-xs text-white/50 font-mono uppercase mb-1">Author</label>
                          <div className="text-sm text-white/90 bg-white/5 px-3 py-2 rounded border border-white/10">{idea.authorName}</div>
                        </div>
                        <div>
                          <label className="block text-xs text-white/50 font-mono uppercase mb-1">Weight (Votes)</label>
                          <div className="flex items-center gap-3">
                            <div className="text-sm text-white/90 bg-white/5 px-3 py-2 rounded border border-white/10">{idea.weight}</div>
                            <button 
                              onClick={() => handleVote(idea.id, 1)}
                              className="bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded text-xs font-mono transition-colors"
                              title={`Cost: ${Math.pow((userVotes[idea.id] || 0) + 1, 2) - Math.pow(userVotes[idea.id] || 0, 2)} credits`}
                            >
                              +1 Upvote
                            </button>
                            <button 
                              onClick={() => handleVote(idea.id, -1)}
                              className="bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded text-xs font-mono transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              disabled={(userVotes[idea.id] || 0) <= 0}
                            >
                              -1 Downvote
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs text-white/50 font-mono uppercase mb-1">Cluster</label>
                          <input 
                            type="text" 
                            value={idea.cluster}
                            onChange={(e) => handleEditIdea(idea.id, idea.text, e.target.value)}
                            className="w-full text-sm text-white bg-black/50 px-3 py-2 rounded border border-white/20 focus:border-[#00FF00] focus:outline-none transition-colors"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="block text-xs text-white/50 font-mono uppercase mb-1">Idea Text</label>
                          <textarea 
                            value={idea.text}
                            onChange={(e) => handleEditIdea(idea.id, e.target.value, idea.cluster)}
                            className="w-full h-32 text-sm text-white bg-black/50 px-3 py-2 rounded border border-white/20 focus:border-[#00FF00] focus:outline-none transition-colors resize-none"
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
            <div className="absolute inset-0 p-8 overflow-y-auto">
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
                  className="w-[500px] h-[500px] border-2 border-[#00FF00]/20 rounded-full border-dashed absolute"
                />
                <motion.div 
                  animate={{ rotate: -360 }} 
                  transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
                  className="w-[350px] h-[350px] border-2 border-[#00FF00]/30 rounded-full border-dotted absolute"
                />
                <motion.div 
                  animate={{ scale: [1, 1.5, 1], opacity: [0.1, 0.3, 0.1] }} 
                  transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                  className="w-[200px] h-[200px] bg-[#00FF00] rounded-full blur-[100px] absolute"
                />
              </div>

              <div className="text-center max-w-md relative z-10">
                <motion.div
                  animate={{ 
                    scale: [1, 1.2, 1],
                    rotate: [0, 5, -5, 0],
                    filter: ['drop-shadow(0 0 10px rgba(0,255,0,0.3))', 'drop-shadow(0 0 30px rgba(0,255,0,0.8))', 'drop-shadow(0 0 10px rgba(0,255,0,0.3))']
                  }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  className="inline-block mb-8"
                >
                  <Zap className="w-20 h-20 text-[#00FF00]" />
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
                      className="w-2 h-2 bg-[#00FF00] rounded-full"
                    />
                  ))}
                </div>

                {role === 'admin' ? (
                  <>
                    <button
                      onClick={handleManualForge}
                      disabled={isForging}
                      className={`px-6 py-3 bg-[#00FF00] text-black font-bold rounded-full hover:bg-[#00cc00] transition-colors uppercase tracking-wider text-sm flex items-center gap-2 mx-auto shadow-[0_0_15px_rgba(0,255,0,0.5)] ${isForging ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <Zap className={`w-4 h-4 ${isForging ? 'animate-pulse' : ''}`} />
                      {isForging ? 'Forging...' : 'Forge Diagram Now'}
                    </button>

                    {forgeError && (
                      <div className="mt-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-xs font-mono">
                        {forgeError}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="px-6 py-3 bg-white/5 text-white/50 font-mono rounded-full text-sm border border-white/10 inline-block">
                    Waiting for Administrator to forge...
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </div>

        {/* Right Panel: Artifacts (React Flow) & Leaderboard */}
        <div className="w-[400px] bg-[#0a0a0a] flex flex-col border-l border-white/10">
          <div className="flex-1 flex flex-col min-h-0">
            <div className="p-4 border-b border-white/10 flex items-center gap-2">
              <Users className="w-4 h-4 text-[#00FF00]" />
              <span className="font-mono text-xs uppercase tracking-wider text-white/70">Live Artifact</span>
            </div>
            <div className="flex-1 overflow-hidden relative">
              <ArtifactCanvas artifact={artifact} />
            </div>
          </div>
          
          {/* Leaderboard Panel */}
          <div className="h-[35%] border-t border-white/10 flex flex-col bg-[#050505]">
            <div className="p-4 border-b border-white/10 flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-400" />
              <span className="font-mono text-xs uppercase tracking-wider text-white/70">Top Contributors</span>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-3">
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
                  return <div className="text-white/30 text-xs font-mono text-center mt-4">No contributions yet</div>;
                }

                return sortedAuthors.map(([name, score], idx) => (
                  <div key={name} className="flex items-center justify-between bg-white/5 p-3 rounded-lg border border-white/5">
                    <div className="flex items-center gap-3">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${idx === 0 ? 'bg-yellow-500/20 text-yellow-500' : idx === 1 ? 'bg-gray-300/20 text-gray-300' : idx === 2 ? 'bg-orange-500/20 text-orange-500' : 'bg-white/10 text-white/50'}`}>
                        {idx + 1}
                      </div>
                      <span className="font-medium text-sm truncate max-w-[150px]">{name}</span>
                    </div>
                    <div className="text-[#00FF00] font-mono text-xs font-bold">
                      {score} pts
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
