import { motion } from 'motion/react';
import { Socket } from 'socket.io-client';
import { Plus, Minus, ShieldAlert } from 'lucide-react';

const focusRingClass =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#34D399]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505]';

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
  const sortedIdeas = [...ideas].sort((a, b) => (b.weight || 0) - (a.weight || 0));

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col">
      <div className="mb-6 flex flex-col gap-4 border-b border-white/8 pb-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <span className="inline-flex rounded-lg border border-[#22D3EE]/15 bg-[#22D3EE]/8 px-3 py-1 text-[9px] font-mono uppercase tracking-[0.28em] text-[#22D3EE]">
            Decision Layer
          </span>
          <h2 className="text-3xl font-bold uppercase tracking-tighter text-white" style={{ fontFamily: "'Anton', sans-serif" }}>
            Mechanism Duel
          </h2>
          <p className="max-w-2xl text-sm font-mono text-white/40">
            Quadratic voting is active. Stronger preference costs more, so each extra vote is a more deliberate trade.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-white/8 bg-[#0F0F11] px-4 py-3">
            <span className="text-[9px] font-mono uppercase tracking-[0.24em] text-white/35">Voting Rule</span>
            <p className="mt-2 text-sm text-white/70">Cost of your next vote equals <span className="font-mono text-[#22D3EE]">Votes²</span>.</p>
          </div>
          <div className="flex min-w-[11rem] flex-col rounded-xl border border-[#34D399]/20 bg-[#0F0F11] px-5 py-3 text-left sm:text-right">
            <span className="text-[9px] font-mono uppercase tracking-[0.24em] text-white/35">Influence Tokens</span>
            <span className="mt-1 text-3xl font-bold font-mono text-[#34D399]">{credits}</span>
            <span className="text-[10px] font-mono text-white/35">Spend them where consensus matters most.</span>
          </div>
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between gap-3 text-[10px] font-mono uppercase tracking-[0.22em] text-white/30">
        <span>Highest weighted ideas rise first</span>
        <span>{sortedIdeas.length} proposals</span>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto pr-1 md:pr-3">
        {sortedIdeas.map((idea) => {
          const myVotes = userVotes[idea.id] || 0;
          const nextCost = ((myVotes + 1) * (myVotes + 1)) - (myVotes * myVotes);

          return (
            <motion.div
              key={idea.id}
              layout
              className="flex flex-col gap-4 rounded-xl border border-white/6 bg-[#0F0F11] overflow-hidden transition-colors hover:border-white/15 md:flex-row md:items-center md:justify-between"
            >
              {/* Left content with accent strip */}
              <div className="flex flex-1 min-w-0 gap-4 p-5">
                <div className="w-1 shrink-0 rounded-full bg-[#22D3EE]/30" />
                <div className="min-w-0 flex-1">
                  <div className="mb-2.5 flex flex-wrap items-center gap-2">
                    <span className="rounded-md border border-white/8 bg-white/5 px-2 py-0.5 text-[9px] font-mono uppercase tracking-[0.22em] text-white/55">
                      {idea.cluster}
                    </span>
                    <span className="rounded-md border border-[#34D399]/15 bg-[#34D399]/8 px-2 py-0.5 text-[9px] font-mono uppercase tracking-[0.22em] text-[#34D399]">
                      Weight {idea.weight}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-white/80 sm:text-base">
                    {idea.text}
                  </p>
                </div>
              </div>

              {/* Voting controls */}
              <div className="flex w-full flex-col gap-2.5 border-t border-white/6 bg-black/25 p-3 md:w-auto md:min-w-[14rem] md:border-t-0 md:border-l">
                <div className="flex items-center justify-between text-[9px] font-mono uppercase tracking-[0.22em] text-white/35">
                  <span>Your position</span>
                  <span>Next cost {nextCost}</span>
                </div>

                <div className="flex items-center justify-between gap-2.5">
                  <button
                    onClick={() => onVote(idea.id, -1)}
                    disabled={myVotes === 0}
                    className={`${focusRingClass} rounded-lg border border-white/8 bg-white/5 p-2.5 text-white/50 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-25`}
                    aria-label={`Remove vote from ${idea.text}`}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>

                  <div className="min-w-[4rem] rounded-lg border border-white/6 bg-black/30 px-3 py-1.5 text-center">
                    <span className="block text-xl font-bold font-mono text-white">{myVotes}</span>
                    <span className="text-[8px] font-mono uppercase tracking-[0.22em] text-white/25">Votes</span>
                  </div>

                  <button
                    onClick={() => onVote(idea.id, 1)}
                    disabled={credits < nextCost}
                    className={`${focusRingClass} rounded-lg border border-[#34D399]/20 bg-[#34D399]/10 p-2.5 text-[#34D399] transition-colors hover:border-[#34D399]/40 hover:bg-[#34D399]/20 disabled:cursor-not-allowed disabled:opacity-25`}
                    title={`Cost: ${nextCost} tokens`}
                    aria-label={`Add vote to ${idea.text}`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </motion.div>
          );
        })}

        {ideas.length === 0 && (
          <div className="flex h-72 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-white/8 bg-white/[0.02] px-8 text-center text-white/25">
            <ShieldAlert className="h-10 w-10 opacity-40" />
            <div className="space-y-1">
              <p className="font-mono text-xs uppercase tracking-[0.24em] text-white/35">No ideas harvested yet</p>
              <p className="max-w-md text-sm text-white/25">
                Once participants submit ideas, this board will sort them by collective support.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
