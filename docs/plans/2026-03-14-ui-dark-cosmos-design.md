# Dark Cosmos UI Refresh — Design Document

**Date:** 2026-03-14
**Scope:** Visual-only refresh of both entry screen and main session UI. No functionality changes.
**Aesthetic:** Refined sci-fi ("Dark Cosmos") — polished, immersive, multi-accent on dark base.

---

## Color System

| Role | Color | Hex | Usage |
|------|-------|-----|-------|
| Primary | Emerald | #34D399 | Primary actions, success, phase indicators (divergent) |
| Secondary | Cyan | #22D3EE | Information, links, room codes, phase indicators (convergent) |
| Creative | Violet | #A78BFA | AI/creative elements, artifact canvas, forging phase |
| Warning | Amber | #FBBF24 | Warnings, leaderboard gold, attention items |

**Gradients:**
- Primary CTA: emerald → cyan
- AI-related: violet → cyan
- Phase badges: animated gradient border in phase-appropriate color

**Backgrounds:**
- Base: #050505 (unchanged)
- Panel surfaces: #0F0F11
- Elevated panels: #161618 with 1px white/8 borders
- Hover states: white/5 → white/10 background shift

## Typography

- **Anton**: Major headings only (used sparingly)
- **Inter**: All body text, increased line-height
- **JetBrains Mono**: Badges, codes, data displays, section headers
- Clearer size hierarchy — fewer competing sizes per section

## Entry Screen

- Full-screen centered card layout (replace left/right split)
- Subtle animated starfield background (existing Three.js Stars)
- App title + tagline centered above card with gradient text (emerald→cyan)
- Form card: Larger, rounded-2xl, soft violet/cyan glow border on hover
- Tab switcher: Pill-style tabs with emerald highlight on active
- Feature highlights: Minimal 3-icon row below card (not full feature cards)
- Room code input: JetBrains Mono, cyan accent, letter-spaced
- CTA button: Gradient background (emerald→cyan), larger, glow shadow

## Main Session — Header

Three-zone layout:
- **Left**: Smaller app logo + Phase indicator badge (color-coded pill with animated gradient border)
- **Center**: Topic display — larger, gradient text, edit icon on admin hover
- **Right**: Room code chip (cyan, monospace) → participant count → user name → grouped icon buttons with dividers

Overall: Taller header, better vertical padding, clear visual grouping via spacing.

## Main Session — Content Area

**3D Swarm (divergent):**
- Keep existing visualization
- Add subtle vignette overlay at edges for depth

**Edit Node Panel:**
- Slide-in with frosted glass (backdrop-blur-xl)
- Violet-tinged border, cleaner form controls, proper spacing

**Voting Phase (convergent):**
- Cards with left accent strip (color per cluster)
- Better spacing between cards
- Gradient vote buttons (emerald for +, muted for -)
- Credits display as floating pill at top

**Forging Phase:**
- Animated rings with violet/cyan glow (not just green)
- Pulsing orb with gradient

## Main Session — Sidebar

Clear two-section split with thin divider:

**Artifact Canvas (top ~60%):**
- Header with diagram type as violet badge
- Improved mermaid container with subtle inner shadow

**Leaderboard (bottom ~40%):**
- Cleaner contributor cards
- Refined gradient rank badges (gold/silver/bronze)
- Subtle entry animations

**Section headers:** Uppercase, letter-spaced, JetBrains Mono, thin gradient underline (emerald→cyan)
**Panel backgrounds:** #0F0F11, 1px white/8 borders, rounded-xl

## Floating Elements

- Direction suggestion: Emerald gradient border
- Error states: Amber accent (less visual shock than red)
- Phase label overlay: Frosted glass pill, phase-appropriate color

## Constraints

- **No functionality changes** — visual/layout only
- Preserve all existing interactivity, state management, and data flow
- Maintain responsive behavior
- Keep existing animation library (Framer Motion) usage patterns
