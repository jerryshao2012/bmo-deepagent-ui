---
name: BMO Deep Agents UI
description: Enterprise deep research console with high-density telemetry, native artifact viewers, and human-in-the-loop governance.
colors:
  deep-cobalt: "#1155cc"
  midnight-obsidian: "#030a12"
  slate-navy: "#141a22"
  steely-slate: "#2c394c"
  ice-slate: "#eaf1ff"
  slate-fog: "#b7c4d6"
  signal-red: "#ee0000"
  emerald-teal: "#2fbf71"
  amber-warning: "#ffb73c"
typography:
  display:
    fontFamily: "Geist, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.25
  headline:
    fontFamily: "Geist, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
  title:
    fontFamily: "Geist, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: "Geist, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist Mono, SF Mono, Monaco, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "0.03em"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.deep-cobalt}"
    textColor: "{colors.ice-slate}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "#0d43a1"
  button-secondary:
    backgroundColor: "{colors.slate-navy}"
    textColor: "{colors.ice-slate}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  input-field:
    backgroundColor: "transparent"
    textColor: "{colors.ice-slate}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
---

# Design System: BMO Deep Agents UI

## Overview

**Creative North Star: "The Intelligence Console"**

The Intelligence Console is a high-density, mission-critical workspace engineered for deep research analysts and enterprise operators supervising autonomous AI agents. The environment evokes an executive command deck: deep obsidian backgrounds (#030a12) reduce cognitive fatigue during prolonged analysis sessions, dark slate-navy surfaces (#141a22) establish clear structural zones, and authoritative Deep Cobalt (#1155cc) anchors user attention to primary triggers, active execution states, and citation nodes.

Visual hierarchy prioritizes scannability, telemetry precision, and direct document inspection over decorative styling. Layouts are strictly composed with fine 1px steely slate borders (#2c394c) and subtle contrast shifts, providing structural clarity without noisy drop shadows or distracting ornamental gradients.

**Key Characteristics:**
- High-density information display balancing complex multi-agent execution traces with clear typographic hierarchy.
- Tonal-first spatial depth with surfaces flat at rest and elevation expressed via subtle 1px border contrast.
- Strict functional color discipline where cobalt accents denote actionable user intent and amber/emerald signals convey system health and tool statuses.

## Colors

The palette pairs a calibrated dark obsidian and slate substrate with authoritative cobalt blue accents and crisp high-contrast slate text.

### Primary
- **Deep Cobalt** (#1155cc): The primary interactive accent. Reserved exclusively for primary action triggers (Run, Approve, Submit), active execution glows, and grounded citation hyperlinks.

### Secondary
- **Slate Navy** (#141a22): Surface substrate for cards, drawers, tool call boxes, and sidebar panels.
- **Deep Sapphire** (#0f3f92): User message bubble background and selected state highlights.

### Neutral
- **Midnight Obsidian** (#030a12): Base application canvas background.
- **Steely Slate** (#2c394c): Standard structural 1px border for containers, card frames, and splitters.
- **Ice Slate** (#eaf1ff): Primary typography color ensuring crisp contrast against dark surfaces.
- **Slate Fog** (#b7c4d6): Secondary typography for labels, subtitles, timestamps, and muted helper text.
- **Subtle Muted Slate** (#8fa0b6): Tertiary metadata, token counts, and inactive control icons.

### Status & Feedback
- **Emerald Teal** (#2fbf71): Successful tool execution, verified facts, and connected backend indicator.
- **Amber Warning** (#ffb73c): Human-in-the-loop approval interrupts and pending execution pauses.
- **Signal Red** (#ee0000): Error states, run cancellations, and destructive action triggers.

### Named Rules
**The High-Stakes Accent Rule.** Deep Cobalt (#1155cc) is used on ≤10% of any screen. Its rarity guarantees immediate, unambiguous focus on actionable decisions and approval gates.
**The Obsidian Substrate Rule.** Dark surfaces never clip to pure pitch #000000; they maintain calibrated obsidian (#030a12) and slate-navy (#141a22) to preserve border readability and reduce optical harshness.

## Typography

**Display Font:** Geist, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif
**Body Font:** Geist, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif
**Label/Mono Font:** Geist Mono, "SF Mono", Monaco, Consolas, monospace

**Character:** Modern, geometric neo-grotesque type pairing with balanced x-height, delivering clinical legibility in Dense prose, paired with a monospaced companion for agent traces and technical telemetry.

### Hierarchy
- **Display** (SemiBold 600, 1.875rem / 30px, line-height 1.25): Page headers, welcome display titles.
- **Headline** (SemiBold 600, 1.5rem / 24px, line-height 1.25): Panel headers, thread titles, dialog headers.
- **Title** (SemiBold 600, 1.125rem / 18px, line-height 1.25): Tool call card headers, document viewer titles.
- **Body** (Regular 400, 0.875rem / 14px, line-height 1.5): Chat message text, markdown documents, agent reasoning. Line length optimal at 65–80ch.
- **Label** (Medium 500, 0.75rem / 12px, letter-spacing 0.03em, uppercase): Status badges, tab labels, metadata chips, timestamps.
- **Mono Telemetry** (Regular 400, 0.8125rem / 13px, line-height 1.4): Agent tool arguments, execution logs, file paths, JSON payloads.

### Named Rules
**The Telemetry Monospace Rule.** Monospace (Geist Mono) is mandatory for tool inputs/outputs, thread IDs, timestamps, token counts, and raw file names to prevent typographic ambiguity.

## Layout

The layout uses a multi-pane split architecture with adjustable resizable panels separating navigation, chat streams, and artifact previewers.

- **Sidebar Width:** 320px expanded, 60px collapsed.
- **Chat Container:** Centered conversational column max-width 900px, or full-width when document viewer panels are open.
- **Artifact Viewer Panel:** 40vw default width on desktop, split horizontally or vertically using react-resizable-panels.
- **Density:** Compact vertical rhythm utilizing 4px, 8px, and 16px steps to maximize visible intelligence per viewport.
- **Responsive Breakpoints:** 640px (sm), 768px (md), 1024px (lg), 1280px (xl). Mobile collapses sidebars into slide-over sheets.

## Elevation & Depth

Surfaces are flat at rest. Depth is established through stepped tonal layering rather than heavy ambient drop shadows:
Canvas (#030a12) → Structural Paneling (#141a22) → Interactive Inputs/Cards (#1a2230) → Popover/Modal Overlays.

### Shadow Vocabulary
- **Subtle Surface** (`box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05)`): Resting button separation and badge grounding.
- **Modal Overlay** (`box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.3)`): Floating dialogs, config modals, and context dropdowns.
- **Active Processing Glow** (`box-shadow: 0 0 0 1px rgba(17, 85, 204, 0.12), 0 2px 10px rgba(17, 85, 204, 0.12)`): Active agent execution indicator and pulsing tool execution cards.

### Named Rules
**The Tonal-First Rule.** Surfaces do not float above each other with arbitrary shadows; every elevation level is delimited by a 1px border (#2c394c) and a precise background lightness tier.

## Shapes

- **Radius Scale:** Small 4px (`rounded-sm`), Medium 6px (`rounded-md`), Large 8px (`rounded-lg`), Full (`rounded-full`).
- **Form Language:** Form factors use disciplined 6px corners. Circular pill shapes (9999px) are strictly reserved for status indicators, unread count badges, and avatar frames.
- **Borders:** Crisp 1px solid borders (#2c394c) encase cards, inputs, and splitters.

## Components

### Buttons
- **Shape:** 6px radius (`rounded-md`), height 36px (default), 32px (sm), 40px (lg).
- **Primary:** Background Deep Cobalt (#1155cc), text Ice Slate (#ffffff), font-weight 500. Hover: background #0d43a1.
- **Secondary / Outline:** Background Slate Navy (#141a22), border 1px solid #2c394c, text Ice Slate (#eaf1ff). Hover: background #1a2230.
- **Ghost:** Transparent background, text Slate Fog (#b7c4d6). Hover: background rgba(255, 255, 255, 0.05), text #ffffff.

### Inputs / Text Fields
- **Style:** Height 36px, background transparent or dark slate-navy (#141a22), border 1px solid #2c394c, radius 6px. Text Ice Slate (#eaf1ff), placeholder Slate Fog (#b7c4d6).
- **Focus:** 3px focus ring with 50% opacity Deep Cobalt (`ring-[3px] ring-[#1155cc]/50`), border transitions to Deep Cobalt (#1155cc).

### Cards / Tool Call Containers
- **Corner Style:** 6px or 8px radius.
- **Background:** Slate Navy (#141a22).
- **Border:** 1px solid Steely Slate (#2c394c).
- **Internal Padding:** 12px to 16px.

### Badges / Tags
- **Style:** Height 22px, padding 2px 8px, radius 4px or full pill for status dots.
- **Variants:** Success (Emerald Teal tint), Warning (Amber tint), Info (Cobalt tint), Neutral (Steely Slate tint).

### Navigation & Tabs
- **Sidebar Tabs:** Subtle hover background #1a2230, active state marked by cobalt indicator and brightened white text.

## Do's and Don'ts

### Do:
- **Do** maintain the 6px corner radius and 1px border consistency across all new cards, dialogs, and controls.
- **Do** use Geist Mono for any raw identifier, execution latency, timestamp, or tool invocation parameter.
- **Do** reserve Deep Cobalt (#1155cc) for primary triggers and active attention states.
- **Do** display document viewers (PDF, DOCX, XLSX, PPTX) in-situ using the split panel layout.

### Don't:
- **Don't** introduce playful pastel gradients, bouncy spring animations, or cartoonish graphics (**The Anti-Toy Rule**).
- **Don't** use pure black #000000 for backgrounds; adhere to Midnight Obsidian (#030a12) and Slate Navy (#141a22).
- **Don't** use arbitrary large border-radii (>8px) on cards or panels.
- **Don't** flood screens with loud notification banners; rely on inline tool status chips and targeted execution badges.
