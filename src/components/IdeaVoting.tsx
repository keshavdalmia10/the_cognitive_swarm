import { motion } from 'motion/react';
import { Socket } from 'socket.io-client';
import { Plus, Minus, ShieldAlert } from 'lucide-react';

export default function IdeaVoting({
  ideas,
  socket,
  credits,
  userVotes,
  onVote,
}: {
  ideas: any[];
  socket: Socket | null;
  credits: number;
  userVotes: Record<string, number>;
  onVote: (ideaId: string, delta: number) => void;
}) {
  return (
    <div className="w-full max-w-4xl mx-auto h-full flex flex-col">
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-white/10">
        <div>
          <h2 className="text-3xl font-bold uppercase tracking-tighter" style={{ fontFamily: "'Anton', sans-serif" }}>
            Mechanism Duel
          </h2>
          <p className="text-white/50 font-mono text-sm mt-1">
            Quadratic Voting active. Cost = Votes²
          </p>
        </div>
        <div className="bg-[#141414] px-6 py-3 rounded-xl border border-[#00FF00]/30 flex flex-col items-end">
          <span className="text-xs font-mono text-white/50 uppercase">Influence Tokens</span>
          <span className="text-2xl font-bold text-[#00FF00] font-mono">{credits}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-4 space-y-4">
        {[...ideas].sort((a, b) => (b.weight || 0) - (a.weight || 0)).map((idea) => {
          const myVotes = userVotes[idea.id] || 0;
          const nextCost = ((myVotes + 1) * (myVotes + 1)) - (myVotes * myVotes);

          return (
            <motion.div
              key={idea.id}
              layout
              className="bg-[#141414] rounded-xl p-5 border border-white/5 flex items-center justify-between gap-6 hover:border-white/20 transition-colors"
            >
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span className="px-2 py-0.5 rounded-full bg-white/10 text-[10px] font-mono text-white/70 uppercase tracking-wider">
                    {idea.cluster}
                  </span>
                  <span className="text-xs font-mono text-[#00FF00]/70">
                    Global Weight: {idea.weight}
                  </span>
                </div>
                <p className="text-lg text-white/90 leading-relaxed font-sans">
                  {idea.text}
                </p>
              </div>

              <div className="flex items-center gap-4 bg-black/50 p-2 rounded-lg border border-white/5">
                <button
                  onClick={() => onVote(idea.id, -1)}
                  disabled={myVotes === 0}
                  className="p-2 rounded-md hover:bg-white/10 disabled:opacity-30 transition-colors"
                >
                  <Minus className="w-4 h-4" />
                </button>

                <div className="flex flex-col items-center min-w-[40px]">
                  <span className="text-xl font-bold font-mono">{myVotes}</span>
                  <span className="text-[10px] text-white/30 font-mono uppercase">Votes</span>
                </div>

                <button
                  onClick={() => onVote(idea.id, 1)}
                  disabled={credits < nextCost}
                  className="p-2 rounded-md hover:bg-white/10 disabled:opacity-30 transition-colors"
                  title={`Cost: ${nextCost} tokens`}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          );
        })}

        {ideas.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-white/30 gap-4">
            <ShieldAlert className="w-12 h-12 opacity-50" />
            <p className="font-mono text-sm">No ideas harvested yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
