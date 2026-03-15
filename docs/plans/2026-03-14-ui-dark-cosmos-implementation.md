# Dark Cosmos UI Refresh — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use the document-skills:frontend-design skill for implementation guidance on each task.

**Goal:** Refresh the visual design of The Cognitive Swarm app with a "Dark Cosmos" sci-fi aesthetic — multi-accent colors, better spacing, improved visual hierarchy — without changing any functionality.

**Architecture:** Pure CSS/className changes across 4 files. No new components, no logic changes. Color palette shifts from mono-green (#00FF00) to emerald/cyan/violet accents. Layout changes on entry screen (centered card) and header (three-zone). All existing event handlers, state management, and socket.io logic remain untouched.

**Tech Stack:** React, Tailwind CSS v4, Framer Motion (existing), Lucide icons (existing)

---

### Task 1: Update CSS Variables and Color Foundation

**Files:**
- Modify: `src/index.css` (entire file, 8 lines)

**Step 1: Update index.css with new color custom properties**

Replace the entire `src/index.css` with:

```css
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
@import "tailwindcss";

@theme {
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;
}
```

> Note: The CSS file stays minimal — all color changes are applied via Tailwind classes inline. No custom properties needed since Tailwind v4 handles the theme.

**Step 2: Update focusRingClass in App.tsx (line 47-48)**

Change the focus ring from green to emerald:

```tsx
// Before:
const focusRingClass =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9dff9d] focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505]';

// After:
const focusRingClass =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#34D399] focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505]';
```

**Step 3: Update focusRingClass in IdeaVoting.tsx (line 5-6)**

```tsx
// Before:
const focusRingClass =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00FF00]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black';

// After:
const focusRingClass =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#34D399]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505]';
```

**Step 4: Update focusRingClass in ArtifactCanvas.tsx (line 21-22)**

```tsx
// Before:
const focusRingClass =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00FF00]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black';

// After:
const focusRingClass =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#34D399]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505]';
```

**Step 5: Verify the app still loads**

Run: `npm run dev` and check the app loads without errors in the browser.

**Step 6: Commit**

```bash
git add src/index.css src/App.tsx src/components/IdeaVoting.tsx src/components/ArtifactCanvas.tsx
git commit -m "style: update focus ring colors to emerald for Dark Cosmos theme"
```

---

### Task 2: Redesign Entry Screen

**Files:**
- Modify: `src/App.tsx:684-854` (the `if (!role)` return block)

**Step 1: Replace entry screen layout**

Replace the entry screen (lines 684-854) with a centered card layout. The full replacement JSX:

```tsx
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
                  handleCreateRoom();
                } else {
                  handleJoinRoom();
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
```

**Step 2: Visually verify the entry screen**

Open the app in browser, verify:
- Centered card layout
- Gradient title text (emerald → cyan)
- Pill tabs with emerald active state
- Cyan room code input styling
- Gradient CTA button
- 3-icon feature row below card
- Both Create and Join modes work correctly

**Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "style: redesign entry screen with centered card layout and Dark Cosmos palette"
```

---

### Task 3: Redesign Session Header

**Files:**
- Modify: `src/App.tsx:857-1031` (the header section)

**Step 1: Add phase color mapping**

After the `phaseLabels` constant (line 50-54), add a phase color mapping:

```tsx
const phaseColors: Record<'divergent' | 'convergent' | 'forging', { text: string; bg: string; border: string; glow: string }> = {
  divergent: { text: 'text-[#34D399]', bg: 'bg-[#34D399]/10', border: 'border-[#34D399]/30', glow: 'shadow-[0_0_12px_rgba(52,211,153,0.25)]' },
  convergent: { text: 'text-[#22D3EE]', bg: 'bg-[#22D3EE]/10', border: 'border-[#22D3EE]/30', glow: 'shadow-[0_0_12px_rgba(34,211,238,0.25)]' },
  forging: { text: 'text-[#A78BFA]', bg: 'bg-[#A78BFA]/10', border: 'border-[#A78BFA]/30', glow: 'shadow-[0_0_12px_rgba(167,139,250,0.25)]' },
};
```

**Step 2: Replace the header section**

Replace lines 857-1031 with a three-zone header:

```tsx
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
            {/* Room code chip */}
            <button
              onClick={() => void copyRoomCode()}
              className={`hidden sm:flex items-center gap-1.5 rounded-lg border border-[#22D3EE]/20 bg-[#22D3EE]/8 px-3 py-1.5 font-mono text-xs tracking-[0.2em] text-[#22D3EE] transition-colors hover:bg-[#22D3EE]/15 ${focusRingClass}`}
              title="Click to copy"
            >
              {activeRoomCode}
            </button>

            {/* Participant count */}
            <div className="hidden md:flex items-center gap-1.5 rounded-lg border border-white/8 bg-white/5 px-3 py-1.5 text-[11px] font-mono text-white/50">
              <Users className="h-3 w-3" />
              {participantCount}
            </div>

            {/* Divider */}
            <div className="hidden md:block h-5 w-px bg-white/10" />

            {/* User name */}
            <div className="hidden lg:block text-[11px] font-mono text-white/50 truncate max-w-[100px]">
              {activeUserName}
            </div>
          </div>
        </div>

        {/* Controls bar */}
        <div className="flex items-center justify-between gap-3 border-t border-white/5 px-4 py-2.5 sm:px-6">
          {/* Phase switcher */}
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

          {/* Action buttons */}
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
                isRecording
                  ? 'border border-red-500/40 bg-red-500/15 text-red-300 shadow-[0_0_12px_rgba(239,68,68,0.2)]'
                  : 'border border-white/8 bg-white/5 text-white/55 hover:bg-white/8'
              }`}
            >
              {isRecording ? <Mic className="h-3.5 w-3.5 animate-pulse" /> : <MicOff className="h-3.5 w-3.5" />}
              {isRecording ? 'Live' : 'Join'}
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
```

**Step 2: Visually verify the header**

Check in browser:
- Three-zone layout (logo-left, topic-center, info-right)
- Phase-colored logo icon and badge
- Gradient topic text in center
- Cyan room code chip
- Compact controls bar below
- Phase switcher with color-coded active states
- All buttons still functional

**Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "style: redesign session header with three-zone layout and phase-colored accents"
```

---

### Task 4: Update Main Content Area (Swarm, Forging, Edit Panel, Overlays)

**Files:**
- Modify: `src/App.tsx:1033-1280` (main content area)

**Step 1: Update the room notice banner (lines 1033-1041)**

```tsx
      {(roomError || roomNotice) && (
        <div className="border-b border-white/5 px-4 py-2.5 sm:px-6">
          <div className={`rounded-xl border px-4 py-2.5 text-sm font-mono ${
            roomError ? 'border-[#FBBF24]/30 bg-[#FBBF24]/8 text-[#FBBF24]' : 'border-[#34D399]/20 bg-[#34D399]/8 text-[#34D399]'
          }`}>
            {roomError || roomNotice}
          </div>
        </div>
      )}
```

**Step 2: Update the phase label overlay (lines 1053-1059)**

```tsx
                <div className="flex w-fit items-center gap-2 rounded-lg border border-white/8 bg-black/60 px-3 py-1.5 text-white/50 backdrop-blur-xl">
                  <Activity className={`w-3.5 h-3.5 ${phaseColors[phase].text}`} />
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em]">
                    {phase === 'forging' ? 'Phase 3: Forging' : 'Phase 1: Idea Swarm'}
                  </span>
                </div>
```

**Step 3: Update direction suggestion banner (lines 1061-1074)**

Change emerald tones to use the design system emerald:

```tsx
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
```

**Step 4: Update audio error fallback (lines 1076-1109)**

Change red to amber accents:

```tsx
                {audioError && (
                  <div className="flex max-w-2xl items-start gap-3 rounded-xl border border-[#FBBF24]/30 bg-[#0F0F11]/90 px-4 py-3 pointer-events-auto shadow-lg backdrop-blur-xl">
                    <AlertTriangle className="mt-0.5 w-4 h-4 text-[#FBBF24] flex-shrink-0" />
                    <div className="flex flex-1 flex-col gap-3">
                      <span className="text-xs font-mono text-[#FBBF24]/80">Microphone access failed: {audioError}</span>
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
                          className={`flex-1 rounded-lg border border-[#FBBF24]/20 bg-black/50 px-3 py-2 text-sm text-white font-mono placeholder:text-white/25 ${focusRingClass}`}
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
```

**Step 5: Update edit node panel (lines 1112-1174)**

```tsx
              {/* Edit Idea Panel */}
              {selectedIdeaId && (
                <motion.div
                  initial={{ x: -300, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  className="absolute top-0 left-0 z-50 flex h-full w-full max-w-[22rem] flex-col border-r border-[#A78BFA]/15 bg-[#0F0F11]/90 p-6 shadow-2xl backdrop-blur-xl"
                >
                  <div className="flex justify-between items-center mb-6">
                    <h2 className="text-sm font-mono uppercase tracking-[0.22em] text-white/70">Edit Node</h2>
                    <button onClick={() => setSelectedIdeaId(null)} className={`text-white/40 hover:text-white transition-colors text-sm ${focusRingClass}`}>✕</button>
                  </div>

                  {(() => {
                    const idea = ideas.find(i => i.id === selectedIdeaId);
                    if (!idea) return null;
                    return (
                      <div className="flex flex-col gap-4">
                        <div>
                          <label className="block text-[10px] text-white/40 font-mono uppercase tracking-[0.2em] mb-1.5">Author</label>
                          <div className="text-sm text-white/80 bg-white/5 px-3 py-2 rounded-lg border border-white/8">{idea.authorName}</div>
                        </div>
                        <div>
                          <label className="block text-[10px] text-white/40 font-mono uppercase tracking-[0.2em] mb-1.5">Weight (Votes)</label>
                          <div className="flex items-center gap-2">
                            <div className="text-sm text-white/80 bg-white/5 px-3 py-2 rounded-lg border border-white/8 font-mono">{idea.weight}</div>
                            <button
                              onClick={() => handleVote(idea.id, 1)}
                              className={`bg-[#34D399]/10 hover:bg-[#34D399]/20 text-[#34D399] px-3 py-1.5 rounded-lg text-[10px] font-mono uppercase tracking-wider transition-colors ${focusRingClass}`}
                              title={`Cost: ${Math.pow((userVotes[idea.id] || 0) + 1, 2) - Math.pow(userVotes[idea.id] || 0, 2)} credits`}
                            >
                              +1
                            </button>
                            <button
                              onClick={() => handleVote(idea.id, -1)}
                              className={`bg-white/5 hover:bg-white/10 text-white/55 px-3 py-1.5 rounded-lg text-[10px] font-mono uppercase tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${focusRingClass}`}
                              disabled={(userVotes[idea.id] || 0) <= 0}
                            >
                              -1
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] text-white/40 font-mono uppercase tracking-[0.2em] mb-1.5">Cluster</label>
                          <input
                            type="text"
                            value={idea.cluster}
                            onChange={(e) => handleEditIdea(idea.id, idea.text, e.target.value)}
                            className={`w-full text-sm text-white bg-white/5 px-3 py-2 rounded-lg border border-white/10 focus:border-[#A78BFA]/50 focus:outline-none transition-colors ${focusRingClass}`}
                          />
                        </div>
                        <div className="flex-1">
                          <label className="block text-[10px] text-white/40 font-mono uppercase tracking-[0.2em] mb-1.5">Idea Text</label>
                          <textarea
                            value={idea.text}
                            onChange={(e) => handleEditIdea(idea.id, e.target.value, idea.cluster)}
                            className={`w-full h-32 text-sm text-white bg-white/5 px-3 py-2 rounded-lg border border-white/10 focus:border-[#A78BFA]/50 focus:outline-none transition-colors resize-none ${focusRingClass}`}
                          />
                        </div>
                      </div>
                    );
                  })()}
                </motion.div>
              )}
```

**Step 6: Update forging phase (lines 1190-1279)**

Replace the forging phase overlay with violet/cyan accents:

```tsx
          {phase === 'forging' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 flex items-center justify-center p-8 overflow-hidden"
            >
              {/* Background animated rings */}
              <div className="absolute inset-0 flex items-center justify-center opacity-25 pointer-events-none">
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
                  className="inline-block mb-6"
                >
                  <Zap className="w-16 h-16 text-[#A78BFA]" />
                </motion.div>

                <h2 className="text-3xl font-bold mb-3 tracking-wider uppercase" style={{ fontFamily: "'Anton', sans-serif" }}>
                  The Forging
                </h2>

                <p className="text-white/50 font-mono text-xs leading-relaxed mb-6">
                  The swarm is collapsing into a structured diagram. The Visual Scribe is processing the consensus.
                </p>

                <div className="flex justify-center items-center gap-3 mb-6">
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
                      className={`px-6 py-3 font-bold rounded-xl text-sm flex items-center gap-2 mx-auto uppercase tracking-wider transition-all ${focusRingClass} ${isForging ? 'opacity-50 cursor-not-allowed' : 'shadow-[0_0_20px_rgba(167,139,250,0.3)]'}`}
                      style={{ background: 'linear-gradient(135deg, #A78BFA, #22D3EE)', color: '#000' }}
                    >
                      <Zap className={`w-4 h-4 ${isForging ? 'animate-pulse' : ''}`} />
                      {isForging ? 'Forging...' : 'Forge Diagram'}
                    </button>

                    {forgeError && (
                      <div className="mt-4 p-3 bg-[#FBBF24]/10 border border-[#FBBF24]/30 rounded-xl text-[#FBBF24] text-xs font-mono">
                        {forgeError}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="px-5 py-2.5 bg-white/5 text-white/40 font-mono rounded-xl text-xs border border-white/8 inline-block">
                    Waiting for Administrator to forge...
                  </div>
                )}
              </div>
            </motion.div>
          )}
```

**Step 2: Verify all overlays and panels in browser**

Test: direction suggestions, audio error, edit panel, forging phase. All should use new colors.

**Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "style: update overlays, edit panel, and forging phase with Dark Cosmos palette"
```

---

### Task 5: Update Sidebar (Artifact Canvas header + Leaderboard)

**Files:**
- Modify: `src/App.tsx:1282-1353` (sidebar section)

**Step 1: Replace the sidebar section**

```tsx
        <div className="w-full xl:w-[400px] min-h-[420px] xl:min-h-0 bg-[#0a0a0a] flex flex-col border-t xl:border-t-0 xl:border-l border-white/8">
          {/* Artifact Canvas */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <BrainCircuit className="w-3.5 h-3.5 text-[#A78BFA]" />
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/50">Live Artifact</span>
              </div>
              <div className="h-px flex-1 mx-2" style={{ background: 'linear-gradient(90deg, #34D399, #22D3EE, transparent)' }} />
            </div>
            <div className="flex-1 overflow-hidden relative">
              <ArtifactCanvas artifact={artifact} />
            </div>
          </div>

          {/* Leaderboard */}
          <div className="h-[320px] xl:h-[35%] border-t border-white/8 flex flex-col bg-[#050505]">
            <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-[#22D3EE]" />
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/50">Top Contributors</span>
              </div>
              <span className="rounded-lg border border-white/8 bg-white/5 px-2.5 py-1 text-[9px] font-mono uppercase tracking-[0.18em] text-white/35">
                {ideas.length} ideas
              </span>
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
                    <div className="mt-2 rounded-xl border border-dashed border-white/8 bg-white/[0.02] px-4 py-5 text-center">
                      <div className="text-[9px] font-mono uppercase tracking-[0.22em] text-white/30">Leaderboard idle</div>
                      <div className="mt-1.5 text-xs text-white/25">No contributions yet.</div>
                    </div>
                  );
                }

                return sortedAuthors.map(([name, score], idx) => (
                  <motion.div
                    key={name}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="flex items-center justify-between rounded-xl border border-white/6 bg-white/[0.03] p-2.5 transition-colors hover:border-white/12"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className={`flex h-6 w-6 items-center justify-center rounded-lg text-[10px] font-bold ${
                        idx === 0 ? 'bg-[#FBBF24]/15 text-[#FBBF24]' : idx === 1 ? 'bg-gray-300/15 text-gray-300' : idx === 2 ? 'bg-orange-400/15 text-orange-400' : 'bg-white/8 text-white/40'
                      }`}>
                        {idx + 1}
                      </div>
                      <span className="truncate text-xs font-medium text-white/80">{name}</span>
                    </div>
                    <span className="rounded-lg border border-[#34D399]/15 bg-[#34D399]/8 px-2 py-0.5 text-[10px] font-bold font-mono text-[#34D399]">
                      {score}
                    </span>
                  </motion.div>
                ));
              })()}
            </div>
          </div>
        </div>
```

**Step 2: Verify sidebar**

Check: gradient underline on section headers, violet artifact icon, cyan leaderboard icon, animated leaderboard entries, refined rank badges.

**Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "style: update sidebar with gradient headers, refined leaderboard, and Dark Cosmos palette"
```

---

### Task 6: Update ArtifactCanvas Component

**Files:**
- Modify: `src/components/ArtifactCanvas.tsx` (entire file)

**Step 1: Update the empty state (lines 106-121)**

Replace the empty state with violet accents:

```tsx
  if (!artifact) {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-8 text-center">
        <div className="max-w-md rounded-2xl border border-white/8 bg-[#0F0F11] px-8 py-10">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-[#A78BFA]/20 bg-[#A78BFA]/10 text-[#A78BFA]">
            <BrainCircuit className="h-6 w-6" />
          </div>
          <p className="mt-5 text-[10px] font-mono uppercase tracking-[0.28em] text-white/35">Artifact Workspace</p>
          <h3 className="mt-2 text-lg font-semibold text-white/90">Waiting for the next forged diagram</h3>
          <p className="mt-3 text-sm leading-relaxed text-white/35">
            When the administrator forges an artifact, it will appear here with pan and zoom controls.
          </p>
        </div>
      </div>
    );
  }
```

**Step 2: Update the artifact header (lines 124-168)**

```tsx
  return (
    <div className="absolute inset-0 flex flex-col bg-[#050505]">
      <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#A78BFA]/20 bg-[#A78BFA]/10">
            <BrainCircuit className="h-3.5 w-3.5 text-[#A78BFA]" />
          </div>
          <span className="truncate text-sm font-medium text-white/85">{artifact.title}</span>
          <span className="rounded-md border border-[#A78BFA]/20 bg-[#A78BFA]/10 px-2 py-0.5 text-[9px] font-mono uppercase tracking-[0.2em] text-[#A78BFA]">
            {diagramLabel}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setScale((value) => Math.max(0.4, value - 0.1))}
            className={`${focusRingClass} rounded-lg border border-white/8 bg-white/5 p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white/80`}
            title="Zoom out"
          >
            <ZoomOut className="h-3 w-3" />
          </button>
          <button
            onClick={() => {
              setScale(1);
              setOffset({ x: 0, y: 0 });
            }}
            className={`${focusRingClass} rounded-lg border border-white/8 bg-white/5 p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white/80`}
            title="Reset view"
          >
            <Search className="h-3 w-3" />
          </button>
          <button
            onClick={() => setScale((value) => Math.min(2.5, value + 0.1))}
            className={`${focusRingClass} rounded-lg border border-white/8 bg-white/5 p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white/80`}
            title="Zoom in"
          >
            <ZoomIn className="h-3 w-3" />
          </button>
          <span className="ml-1 text-[9px] font-mono text-white/30">{(scale * 100).toFixed(0)}%</span>
        </div>
      </div>
```

**Step 3: Update the pan hint and error state (lines 170-186)**

```tsx
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex items-center gap-1.5 rounded-lg border border-white/8 bg-black/60 px-2.5 py-1 text-[9px] font-mono uppercase tracking-[0.2em] text-white/40 backdrop-blur-xl">
        <Move className="h-3 w-3" />
        Drag to pan
      </div>

      <div
        className="relative flex-1 overflow-hidden"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {renderError ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
            <div className="max-w-lg rounded-xl border border-[#FBBF24]/20 bg-[#FBBF24]/8 px-6 py-4 text-sm">
              <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-[#FBBF24]/70">Render Error</p>
              <p className="mt-2 leading-relaxed text-[#FBBF24]/80">Failed to render diagram: {renderError}</p>
            </div>
          </div>
```

The rest of the file (pointer handlers, svg render) stays the same.

**Step 4: Verify artifact canvas**

Check: empty state with violet icon, violet diagram type badge, refined zoom controls, amber error state.

**Step 5: Commit**

```bash
git add src/components/ArtifactCanvas.tsx
git commit -m "style: update ArtifactCanvas with violet accents and refined controls"
```

---

### Task 7: Update IdeaVoting Component

**Files:**
- Modify: `src/components/IdeaVoting.tsx` (entire component)

**Step 1: Update the header section (lines 24-48)**

Replace all `#00FF00` references with the new palette:

```tsx
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
```

**Step 2: Update the sort indicator (lines 50-53)**

```tsx
      <div className="mb-4 flex items-center justify-between gap-3 text-[10px] font-mono uppercase tracking-[0.22em] text-white/30">
        <span>Highest weighted ideas rise first</span>
        <span>{sortedIdeas.length} proposals</span>
      </div>
```

**Step 3: Update idea cards (lines 55-114)**

Replace each card with the new accent strip and refined colors:

```tsx
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
              {/* Left accent strip */}
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
```

**Step 2: Verify voting screen**

Check: cyan "Decision Layer" badge, emerald influence tokens, accent strips on cards, refined vote buttons, muted empty state.

**Step 3: Commit**

```bash
git add src/components/IdeaVoting.tsx
git commit -m "style: update IdeaVoting with cyan/emerald accents and card accent strips"
```

---

### Task 8: Final Visual QA

**Step 1: Run the dev server**

Run: `npm run dev`

**Step 2: Test all screens and states**

Walk through:
1. Entry screen — Create Room tab, Join Room tab
2. Create a room, verify header three-zone layout
3. Check divergent phase — 3D swarm, edit panel
4. Switch to convergent — voting cards
5. Switch to forging — violet/cyan animated rings, forge button
6. Check sidebar — artifact empty state, leaderboard
7. Test responsive: resize browser to mobile width

**Step 3: Final commit with all remaining tweaks**

```bash
git add -A
git commit -m "style: Dark Cosmos UI refresh — complete visual overhaul"
```
