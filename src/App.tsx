import { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Mic, MicOff, BrainCircuit, Activity, Users, Zap, Bot } from 'lucide-react';
import { motion } from 'motion/react';
import IdeaSwarm from './components/IdeaSwarm';
import IdeaVoting from './components/IdeaVoting';
import { startSimulation } from './utils/simulator';
import { ReactFlow, Background, Controls, MiniMap, Node, Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';

export default function App() {
  const [userName, setUserName] = useState('');
  const userNameRef = useRef('');
  useEffect(() => { userNameRef.current = userName; }, [userName]);
  const [role, setRole] = useState<'admin' | 'participant' | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [phase, setPhase] = useState<'divergent' | 'convergent' | 'forging'>('divergent');
  const [topic, setTopic] = useState<string>('');
  const [isEditingTopic, setIsEditingTopic] = useState(false);
  const [ideas, setIdeas] = useState<any[]>([]);
  const ideasRef = useRef<any[]>([]);
  useEffect(() => { ideasRef.current = ideas; }, [ideas]);
  const [flowNodes, setFlowNodes] = useState<Node[]>([]);
  const [flowEdges, setFlowEdges] = useState<Edge[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const stopSimulationRef = useRef<(() => void) | null>(null);

  const handleEditIdea = (id: string, text: string, cluster: string) => {
    if (socket) {
      const idea = ideas.find(i => i.id === id);
      if (idea && idea.text !== text) {
        socket.emit('edit_idea', { id, text, cluster, textChanged: true });
      } else {
        socket.emit('edit_idea', { id, text, cluster, textChanged: false });
      }
    }
  };

  // Connect to Socket.IO
  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('state_sync', (state) => {
      setTopic(state.topic || '');
      setPhase(state.phase);
      setIdeas(state.ideas);
      if (state.flowData) {
        setFlowNodes(state.flowData.nodes || []);
        setFlowEdges(state.flowData.edges || []);
      }
    });

    newSocket.on('topic_updated', (newTopic) => {
      setTopic(newTopic);
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

    newSocket.on('flow_updated', (data) => {
      setFlowNodes(data.nodes || []);
      setFlowEdges(data.edges || []);
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
      socket?.emit('stop_audio_session');
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
      }
      if (workletNodeRef.current) {
        workletNodeRef.current.disconnect();
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
      
      const workletCode = `
        const base64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        function arrayBufferToBase64(buffer) {
          const bytes = new Uint8Array(buffer);
          let result = '';
          const len = bytes.length;
          for (let i = 0; i < len; i += 3) {
            result += base64chars[bytes[i] >> 2];
            result += base64chars[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
            result += base64chars[((bytes[i + 1] & 15) << 2) | (bytes[i + 2] >> 6)];
            result += base64chars[bytes[i + 2] & 63];
          }
          if (len % 3 === 2) {
            result = result.substring(0, result.length - 1) + '=';
          } else if (len % 3 === 1) {
            result = result.substring(0, result.length - 2) + '==';
          }
          return result;
        }

        class PCMProcessor extends AudioWorkletProcessor {
          constructor() {
            super();
            this.bufferSize = 4096;
            this.buffer = new Int16Array(this.bufferSize);
            this.bytesWritten = 0;
          }
          process(inputs, outputs, parameters) {
            const input = inputs[0];
            if (input && input.length > 0) {
              const channelData = input[0];
              for (let i = 0; i < channelData.length; i++) {
                this.buffer[this.bytesWritten++] = Math.max(-1, Math.min(1, channelData[i])) * 0x7FFF;
                if (this.bytesWritten >= this.bufferSize) {
                  const outBuffer = new Int16Array(this.buffer);
                  const base64Data = arrayBufferToBase64(outBuffer.buffer);
                  this.port.postMessage(base64Data);
                  this.bytesWritten = 0;
                }
              }
            }
            return true;
          }
        }
        registerProcessor('pcm-processor', PCMProcessor);
      `;

      const blob = new Blob([workletCode], { type: 'application/javascript' });
      const workletUrl = URL.createObjectURL(blob);
      await audioContext.audioWorklet.addModule(workletUrl);
      
      const workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');
      workletNodeRef.current = workletNode;

      source.connect(workletNode);
      workletNode.connect(audioContext.destination);

      socket?.emit('start_audio_session', { topic, userName: userNameRef.current });

      workletNode.port.onmessage = (e) => {
        const base64Data = e.data;
        socket?.emit('audio_chunk', base64Data);
      };

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
      
      const currentIdeas = ideasRef.current;
      
      const safeTopic = (topic || 'Brainstorming Session').replace(/["{}()\[\]]/g, '');

      if (currentIdeas.length === 0) {
        const emptyNodes: Node[] = [
          { id: 'root', position: { x: 0, y: 0 }, data: { label: safeTopic }, style: { background: '#00FF00', color: '#000', fontWeight: 'bold', padding: '10px', borderRadius: '8px' } },
          { id: 'empty', position: { x: 0, y: 100 }, data: { label: 'No ideas generated yet' }, style: { background: '#111', color: '#fff', border: '1px solid #333', padding: '10px', borderRadius: '8px' } }
        ];
        const emptyEdges: Edge[] = [
          { id: 'e-root-empty', source: 'root', target: 'empty', animated: true, style: { stroke: '#00FF00' } }
        ];
        socket?.emit('update_flow', { nodes: emptyNodes, edges: emptyEdges });
        return;
      }

      // 1. Sort by weight (highest first) and take top 30
      const topIdeas = [...currentIdeas].sort((a, b) => (b.weight || 0) - (a.weight || 0)).slice(0, 30);
      
      // 2. Group by cluster
      const clusters = new Map<string, typeof currentIdeas>();
      topIdeas.forEach(idea => {
        const c = idea.cluster || 'General';
        if (!clusters.has(c)) clusters.set(c, []);
        clusters.get(c)!.push(idea);
      });

      // 3. Generate React Flow Nodes & Edges
      const newNodes: Node[] = [];
      const newEdges: Edge[] = [];

      const dagreGraph = new dagre.graphlib.Graph();
      dagreGraph.setDefaultEdgeLabel(() => ({}));
      dagreGraph.setGraph({ rankdir: 'TB', ranksep: 100, nodesep: 50 });

      // Root Node
      newNodes.push({
        id: 'root',
        data: { label: safeTopic },
        position: { x: 0, y: 0 },
        style: { background: '#00FF00', color: '#000', fontWeight: 'bold', padding: '15px', borderRadius: '10px', fontSize: '18px', border: '2px solid #000' }
      });
      dagreGraph.setNode('root', { width: 250, height: 60 });

      let clusterIndex = 0;
      for (const [clusterName, clusterIdeas] of clusters.entries()) {
        const cId = `C${clusterIndex}`;
        const safeClusterName = clusterName.replace(/["{}()\[\]]/g, '');
        
        newNodes.push({
          id: cId,
          data: { label: safeClusterName },
          position: { x: 0, y: 0 },
          style: { background: '#111', color: '#00FF00', fontWeight: 'bold', padding: '10px', borderRadius: '8px', border: '2px dashed #00FF00' }
        });
        dagreGraph.setNode(cId, { width: 200, height: 50 });
        
        newEdges.push({
          id: `e-root-${cId}`,
          source: 'root',
          target: cId,
          animated: true,
          style: { stroke: '#00FF00', strokeWidth: 2 }
        });
        dagreGraph.setEdge('root', cId);
        
        clusterIdeas.forEach((idea, i) => {
          const iId = `I${clusterIndex}_${i}`;
          const safeText = idea.text.replace(/["{}()\[\]]/g, '').replace(/\n/g, ' ').substring(0, 60) + (idea.text.length > 60 ? '...' : '');
          
          const weight = idea.weight || 1;
          const r = Math.min(255, 26 + (weight * 10));
          const g = Math.min(255, 54 + (weight * 15));
          const b = Math.min(255, 93 + (weight * 20));
          
          newNodes.push({
            id: iId,
            data: { label: safeText },
            position: { x: 0, y: 0 },
            style: { background: `rgb(${r},${g},${b})`, color: '#fff', padding: '10px', borderRadius: '8px', border: `2px solid #63b3ed`, width: 250 }
          });
          dagreGraph.setNode(iId, { width: 250, height: 60 });
          
          newEdges.push({
            id: `e-${cId}-${iId}`,
            source: cId,
            target: iId,
            style: { stroke: '#63b3ed', strokeWidth: Math.min(4, 1 + weight * 0.5) }
          });
          dagreGraph.setEdge(cId, iId);
        });
        clusterIndex++;
      }

      // Apply dagre layout
      dagre.layout(dagreGraph);
      
      newNodes.forEach((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        node.position = {
          x: nodeWithPosition.x - nodeWithPosition.width / 2,
          y: nodeWithPosition.y - nodeWithPosition.height / 2,
        };
      });

      socket?.emit('update_flow', { nodes: newNodes, edges: newEdges });
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
                setRole('participant');
                socket?.emit('set_topic', topic);
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
        <div className="flex-1 relative border-r border-white/10 overflow-hidden">
          {(phase === 'divergent' || phase === 'forging') && (
            <div className="absolute inset-0">
              <IdeaSwarm ideas={ideas} onIdeaClick={(idea) => setSelectedIdeaId(idea.id)} />
              <div className="absolute bottom-6 left-6 pointer-events-none">
                <div className="flex items-center gap-2 text-white/50 font-mono text-xs uppercase tracking-wider">
                  <Activity className="w-4 h-4" />
                  <span>Phase 1: Idea Swarm (Divergent)</span>
                </div>
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
                          <div className="text-sm text-white/90 bg-white/5 px-3 py-2 rounded border border-white/10">{idea.weight}</div>
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
              <IdeaVoting ideas={ideas} socket={socket} />
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
              {flowNodes.length > 0 ? (
                <ReactFlow
                  nodes={flowNodes}
                  edges={flowEdges}
                  fitView
                  className="bg-[#050505]"
                  minZoom={0.1}
                  maxZoom={4}
                  colorMode="dark"
                >
                  <Background color="#333" gap={16} />
                  <Controls style={{ backgroundColor: '#111', fill: '#fff' }} />
                  <MiniMap nodeColor="#00FF00" maskColor="rgba(0, 0, 0, 0.8)" style={{ backgroundColor: '#111' }} />
                </ReactFlow>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-white/30 font-mono text-sm p-8 text-center">
                  Waiting for Administrator to forge the diagram...
                </div>
              )}
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
