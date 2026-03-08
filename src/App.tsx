import { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { GoogleGenAI, LiveServerMessage, Modality, Type } from '@google/genai';
import { Mic, MicOff, BrainCircuit, Activity, Users, Zap, Bot } from 'lucide-react';
import { motion } from 'motion/react';
import IdeaSwarm from './components/IdeaSwarm';
import MermaidDiagram from './components/MermaidDiagram';
import QuadraticVoting from './components/QuadraticVoting';
import { startSimulation } from './utils/simulator';

// Initialize Gemini Live API
const ai = new GoogleGenAI({ apiKey: (import.meta as any).env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '' });

export default function App() {
  const [userName, setUserName] = useState('');
  const userNameRef = useRef('');
  useEffect(() => { userNameRef.current = userName; }, [userName]);
  const [role, setRole] = useState<'admin' | 'participant' | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [phase, setPhase] = useState<'divergent' | 'convergent' | 'forging'>('divergent');
  const [topic, setTopic] = useState<string>('Schema Design');
  const [isEditingTopic, setIsEditingTopic] = useState(false);
  const [ideas, setIdeas] = useState<any[]>([]);
  const ideasRef = useRef<any[]>([]);
  useEffect(() => { ideasRef.current = ideas; }, [ideas]);
  const [mermaidCode, setMermaidCode] = useState<string>('');
  const [isRecording, setIsRecording] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [session, setSession] = useState<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const stopSimulationRef = useRef<(() => void) | null>(null);

  // Connect to Socket.IO
  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('state_sync', (state) => {
      setTopic(state.topic || 'Schema Design');
      setPhase(state.phase);
      setIdeas(state.ideas);
      setMermaidCode(state.mermaidCode);
    });

    newSocket.on('topic_updated', (newTopic) => {
      setTopic(newTopic);
    });

    newSocket.on('idea_added', (idea) => {
      setIdeas((prev) => [...prev, idea]);
    });

    newSocket.on('idea_updated', (updatedIdea) => {
      setIdeas((prev) => prev.map(i => i.id === updatedIdea.id ? updatedIdea : i));
    });

    newSocket.on('mermaid_updated', (code) => {
      setMermaidCode(code);
    });

    newSocket.on('phase_changed', (newPhase) => {
      setPhase(newPhase);
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  // Gemini Live API Connection
  const toggleRecording = async () => {
    if (isRecording) {
      // Stop recording
      if (session) {
        session.close();
        setSession(null);
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      setIsRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const audioContext = new window.AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      source.connect(processor);
      processor.connect(audioContext.destination);

      const sessionPromise = ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        callbacks: {
          onopen: () => {
            console.log("Gemini Live Connected");
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              // Convert Float32Array to Int16Array (PCM16)
              const pcm16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                pcm16[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
              }
              // Convert to Base64
              const buffer = new ArrayBuffer(pcm16.length * 2);
              const view = new DataView(buffer);
              for (let i = 0; i < pcm16.length; i++) {
                view.setInt16(i * 2, pcm16[i], true); // true for little-endian
              }
              const base64Data = btoa(String.fromCharCode(...new Uint8Array(buffer)));

              sessionPromise.then((s) =>
                s.sendRealtimeInput({
                  media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
                })
              );
            };
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle tool calls from Gemini
            if (message.toolCall) {
              const calls = message.toolCall.functionCalls;
              if (calls) {
                const functionResponses: any[] = [];
                for (const call of calls) {
                  if (call.name === 'extractIdea') {
                    const args = call.args as any;
                    socket?.emit('add_idea', { text: args.idea, cluster: args.category, authorName: userNameRef.current || 'Anonymous Node' });
                    functionResponses.push({
                      id: call.id,
                      name: call.name,
                      response: { result: "Idea extracted successfully" }
                    });
                  } else if (call.name === 'generateMermaid') {
                    const args = call.args as any;
                    socket?.emit('update_mermaid', args.code);
                    functionResponses.push({
                      id: call.id,
                      name: call.name,
                      response: { result: "Mermaid diagram generated successfully" }
                    });
                  } else if (call.name === 'getIdeas') {
                    functionResponses.push({
                      id: call.id,
                      name: call.name,
                      response: { ideas: ideasRef.current }
                    });
                  }
                }
                sessionPromise.then(s => s.sendToolResponse({ functionResponses }));
              }
            }
            // Handle audio output if needed (omitted for simplicity, we focus on text/tools)
          },
          onerror: (err) => console.error("Gemini Error:", err),
          onclose: () => console.log("Gemini Closed"),
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: `You are the Supervisor of 'The Cognitive Swarm', a real-time brainstorming tool.
          Listen to the user's audio input.
          If they state an idea, use the 'extractIdea' tool to capture it.
          If they ask to summarize or create a diagram, FIRST use the 'getIdeas' tool to retrieve the current list of ideas, THEN use the 'generateMermaid' tool to create a flowchart or ER diagram based on those ideas.
          Keep your verbal responses extremely concise.`,
          tools: [{
            functionDeclarations: [
              {
                name: 'extractIdea',
                description: 'Extracts a brainstorming idea from the user audio.',
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    idea: { type: Type.STRING, description: 'The core idea or concept.' },
                    category: { type: Type.STRING, description: 'A 1-2 word category or cluster for this idea.' }
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
                  properties: {}
                }
              }
            ]
          }]
        },
      });

      sessionPromise.then(s => setSession(s));
      setIsRecording(true);
    } catch (err) {
      console.error("Failed to start recording:", err);
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

  const handleManualForge = async () => {
    try {
      setForgeError(null);
      setIsForging(true);
      const ai = new GoogleGenAI({ apiKey: (import.meta as any).env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '' });
      
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: JSON.stringify(ideasRef.current),
        config: {
          systemInstruction: 'You are the Visual Scribe for a brainstorming session. Based on the current ideas and their weights, generate a Mermaid.js ER diagram. Return ONLY the raw Mermaid code, without any markdown formatting like ```mermaid or ```.',
        }
      });

      let code = response.text || '';
      code = code.trim();
      if (code.startsWith('```mermaid')) {
        code = code.replace(/^```mermaid\n/, '').replace(/\n```$/, '');
      } else if (code.startsWith('```')) {
        code = code.replace(/^```\n/, '').replace(/\n```$/, '');
      }

      socket?.emit('update_mermaid', code);
    } catch (error: any) {
      console.error("Manual forge failed:", error);
      setForgeError(error.message || "Failed to generate diagram. Please try again.");
    } finally {
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
          
          <div className="mb-6 text-left">
            <label className="block text-xs font-mono text-white/50 mb-2 uppercase tracking-wider">Display Name</label>
            <input 
              type="text" 
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="Enter your name..."
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-[#00FF00]/50 transition-colors"
            />
          </div>

          <div className="space-y-4">
            <button
              onClick={() => setRole('admin')}
              disabled={!userName.trim()}
              className={`w-full py-4 px-6 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all flex items-center justify-between group ${!userName.trim() ? 'opacity-50 cursor-not-allowed' : ''}`}
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
              onClick={() => setRole('participant')}
              disabled={!userName.trim()}
              className={`w-full py-4 px-6 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all flex items-center justify-between group ${!userName.trim() ? 'opacity-50 cursor-not-allowed' : ''}`}
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
                      setIsEditingTopic(false);
                      socket?.emit('set_topic', topic);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
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
      </header>

      {/* Main Content Area */}
      <main className="flex-1 relative flex">
        {/* Left Panel: 3D Swarm or Voting */}
        <div className="flex-1 relative border-r border-white/10">
          {(phase === 'divergent' || phase === 'forging') && (
            <div className="absolute inset-0">
              <IdeaSwarm ideas={ideas} />
              <div className="absolute bottom-6 left-6 pointer-events-none">
                <div className="flex items-center gap-2 text-white/50 font-mono text-xs uppercase tracking-wider">
                  <Activity className="w-4 h-4" />
                  <span>Phase 1: Idea Swarm (Divergent)</span>
                </div>
              </div>
            </div>
          )}
          
          {phase === 'convergent' && (
            <div className="absolute inset-0 p-8 overflow-y-auto">
              <QuadraticVoting ideas={ideas} socket={socket} />
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

        {/* Right Panel: Artifacts (Mermaid) & Leaderboard */}
        <div className="w-[400px] bg-[#0a0a0a] flex flex-col border-l border-white/10">
          <div className="flex-1 flex flex-col min-h-0">
            <div className="p-4 border-b border-white/10 flex items-center gap-2">
              <Users className="w-4 h-4 text-[#00FF00]" />
              <span className="font-mono text-xs uppercase tracking-wider text-white/70">Live Artifact</span>
            </div>
            <div className="flex-1 p-4 overflow-auto">
              <MermaidDiagram code={mermaidCode} />
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
