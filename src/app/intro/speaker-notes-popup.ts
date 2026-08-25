import {
  INTRO_SLIDES,
  type IntroSlideId,
} from "./presentation-navigation";
import {
  INTRO_SPEAKER_NOTES,
  type SlideSpeakerNote,
} from "./speaker-notes-data";

export class SpeakerNotesPopupManager {
  private popupWindow: Window | null = null;
  private onNavigate: (id: IntroSlideId) => void;
  private currentSlideId: IntroSlideId = "hero";
  private timerSeconds = 0;
  private timerRunning = false;
  private timerInterval: number | null = null;
  private clockInterval: number | null = null;
  private baseFontSize = 15;

  constructor(onNavigate: (id: IntroSlideId) => void) {
    this.onNavigate = onNavigate;
  }

  public isOpen(): boolean {
    return Boolean(this.popupWindow && !this.popupWindow.closed);
  }

  public async openOrFocus(initialSlideId: IntroSlideId): Promise<boolean> {
    this.currentSlideId = initialSlideId;

    if (this.isOpen()) {
      this.popupWindow?.focus();
      this.render();
      return true;
    }

    let width = Math.min(1040, window.screen?.availWidth || 1040);
    let height = Math.min(800, window.screen?.availHeight || 800);
    const screenAny = window.screen as unknown as {
      availLeft?: number;
      availTop?: number;
    };
    let left =
      (screenAny?.availLeft !== undefined ? screenAny.availLeft : 0) + 40;
    let top =
      (screenAny?.availTop !== undefined ? screenAny.availTop : 0) + 40;

    // Use Window Management API to target external/secondary screen if available
    if (typeof window !== "undefined" && "getScreenDetails" in window) {
      try {
        const screenDetails = await (window as unknown as {
          getScreenDetails: () => Promise<{
            screens: Array<{
              availLeft?: number;
              availTop?: number;
              availWidth?: number;
              availHeight?: number;
            }>;
            currentScreen: unknown;
          }>;
        }).getScreenDetails();

        if (
          screenDetails?.screens &&
          Array.isArray(screenDetails.screens) &&
          screenDetails.screens.length > 1
        ) {
          const otherScreen =
            screenDetails.screens.find(
              (s) => s !== screenDetails.currentScreen
            ) || screenDetails.screens[1];

          if (otherScreen) {
            const availWidth = otherScreen.availWidth || 1040;
            const availHeight = otherScreen.availHeight || 800;
            width = Math.min(1040, availWidth);
            height = Math.min(800, availHeight);
            left =
              (otherScreen.availLeft ?? 0) +
              Math.max(20, Math.floor((availWidth - width) / 2));
            top =
              (otherScreen.availTop ?? 0) +
              Math.max(20, Math.floor((availHeight - height) / 2));
          }
        }
      } catch {
        // Fallback gracefully if permission denied or window-management unsupported
      }
    }

    const features = `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes`;

    try {
      this.popupWindow = window.open(
        "",
        "AppliedAIDeepAgentSpeakerNotes",
        features
      );
    } catch {
      this.popupWindow = null;
    }

    if (!this.popupWindow || this.popupWindow.closed) {
      return false;
    }

    this.initPopupDocument();
    this.render();
    this.popupWindow.focus();
    return true;
  }

  public updateSlide(id: IntroSlideId): void {
    this.currentSlideId = id;
    if (this.isOpen()) {
      this.render();
    }
  }

  public close(): void {
    if (this.timerInterval) {
      window.clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.clockInterval) {
      window.clearInterval(this.clockInterval);
      this.clockInterval = null;
    }
    if (this.popupWindow && !this.popupWindow.closed) {
      this.popupWindow.close();
    }
    this.popupWindow = null;
  }

  private initPopupDocument(): void {
    if (!this.popupWindow) return;
    const doc = this.popupWindow.document;
    doc.open();
    doc.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Speaker Notes — Applied AI Deep Agent</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #001928;
      --panel: #00253d;
      --card: #002e47;
      --card-alt: #003a59;
      --ink: #f5f6f7;
      --muted: #8fa0b0;
      --line: rgba(255, 255, 255, 0.08);
      --line-bright: rgba(115, 195, 235, 0.36);
      --blue: #0075be;
      --blue-bright: #73c3eb;
      --cyan: #009ec9;
      --green: #00e7b4;
      --amber: #ffc827;
      --red: #e9425f;
      --font-display: "Heebo", Arial, sans-serif;
      --font-mono: "IBM Plex Mono", monospace;
      --ease: cubic-bezier(0.16, 1, 0.3, 1);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--ink);
      font-family: var(--font-display);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
      -webkit-font-smoothing: antialiased;
    }
    header.speaker-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.75rem 1.4rem;
      background: var(--panel);
      border-bottom: 1px solid var(--line);
      flex-wrap: wrap;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 0.85rem;
    }
    .deck-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-family: var(--font-mono);
      font-size: 0.72rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--cyan);
      background: rgba(0, 117, 190, 0.22);
      border: 1px solid var(--line-bright);
      padding: 0.22rem 0.55rem;
      border-radius: 999px;
    }
    .deck-badge::before {
      content: "";
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--green);
      box-shadow: 0 0 6px var(--green);
    }
    .slide-badge {
      font-family: var(--font-mono);
      font-size: 0.85rem;
      font-weight: 600;
      color: #fff;
    }
    .header-center {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .clock-pill, .target-pill {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      padding: 0.25rem 0.65rem;
      border-radius: 6px;
      border: 1px solid var(--line);
      background: rgba(0, 0, 0, 0.4);
      color: var(--muted);
    }
    .clock-pill strong, .target-pill strong {
      color: #fff;
    }
    .target-pill strong {
      color: var(--amber);
    }
    .header-right {
      display: flex;
      align-items: center;
      gap: 0.6rem;
    }
    .timer-display {
      font-family: var(--font-mono);
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--green);
      background: rgba(0, 0, 0, 0.5);
      padding: 0.25rem 0.65rem;
      border-radius: 6px;
      border: 1px solid var(--line);
      min-width: 7.2rem;
      text-align: center;
    }
    .btn {
      font-family: var(--font-mono);
      font-size: 0.72rem;
      padding: 0.35rem 0.75rem;
      border: 1px solid var(--line-bright);
      border-radius: 6px;
      background: var(--card);
      color: #fff;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      transition: 160ms ease;
    }
    .btn:hover {
      background: var(--blue);
      border-color: var(--blue-bright);
      color: #fff;
    }
    .btn-nav {
      font-weight: 600;
      padding: 0.4rem 0.9rem;
      font-size: 0.78rem;
    }
    .btn-nav.primary {
      background: var(--blue);
      border-color: var(--blue-bright);
    }
    .btn-nav.primary:hover {
      background: #005f9e;
    }
    .btn-icon {
      padding: 0.35rem 0.55rem;
      font-weight: bold;
    }
    .main-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.65fr) minmax(18rem, 0.95fr);
      flex: 1;
      gap: 1.25rem;
      padding: 1.25rem 1.4rem;
    }
    .notes-pane {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 1.4rem;
    }
    .slide-meta-bar {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      padding-bottom: 0.9rem;
      border-bottom: 1px solid var(--line);
    }
    .slide-meta-info {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }
    .slide-eyebrow {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--cyan);
      font-weight: 600;
    }
    .slide-heading {
      font-size: 1.45rem;
      font-weight: 700;
      color: #fff;
      line-height: 1.25;
    }
    .talking-points-card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
    }
    .talking-points-header {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--muted);
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .talking-points-header::before {
      content: "";
      width: 4px;
      height: 12px;
      background: var(--blue-bright);
      border-radius: 2px;
    }
    .points-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
    }
    .points-list li {
      display: flex;
      align-items: flex-start;
      gap: 0.65rem;
      line-height: 1.5;
      color: #e2eaf0;
    }
    .points-list li::before {
      content: "▸";
      color: var(--cyan);
      font-weight: bold;
      margin-top: 0.1rem;
      flex-shrink: 0;
    }
    .points-list li strong {
      color: #fff;
      font-weight: 600;
    }
    .transition-card {
      background: rgba(0, 117, 190, 0.12);
      border: 1px dashed var(--line-bright);
      border-radius: 8px;
      padding: 0.85rem 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .transition-label {
      font-family: var(--font-mono);
      font-size: 0.7rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--cyan);
      font-weight: 600;
    }
    .transition-text {
      font-style: italic;
      color: #c4d7e6;
      line-height: 1.45;
    }
    .side-pane {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }
    .card-box {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 1.15rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .card-box-header {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--line);
      padding-bottom: 0.5rem;
    }
    .up-next-card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 0.9rem 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .up-next-eyebrow {
      font-family: var(--font-mono);
      font-size: 0.7rem;
      color: var(--amber);
      font-weight: 600;
    }
    .up-next-title {
      font-size: 0.95rem;
      font-weight: 600;
      color: #fff;
    }
    .up-next-points {
      font-size: 0.8rem;
      color: var(--muted);
      line-height: 1.4;
    }
    .slides-nav-list {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      max-height: 380px;
      overflow-y: auto;
      padding-right: 0.25rem;
    }
    .nav-item-btn {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.55rem 0.75rem;
      border-radius: 6px;
      background: var(--card);
      border: 1px solid transparent;
      color: #d1dde6;
      cursor: pointer;
      text-align: left;
      font-size: 0.8rem;
      font-family: inherit;
      transition: 140ms ease;
      width: 100%;
    }
    .nav-item-btn:hover {
      background: var(--card-alt);
      border-color: var(--line-bright);
      color: #fff;
    }
    .nav-item-btn.active {
      background: rgba(0, 117, 190, 0.28);
      border-color: var(--blue-bright);
      color: #fff;
      font-weight: 600;
    }
    .nav-item-num {
      font-family: var(--font-mono);
      font-size: 0.72rem;
      color: var(--cyan);
    }
    .nav-item-time {
      font-family: var(--font-mono);
      font-size: 0.7rem;
      color: var(--muted);
      flex-shrink: 0;
    }
    .shortcuts-footer {
      padding: 0.75rem 1.4rem;
      background: var(--panel);
      border-top: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 0.75rem;
      font-family: var(--font-mono);
      font-size: 0.72rem;
      color: var(--muted);
    }
    .kbd-tag {
      background: rgba(0, 0, 0, 0.5);
      border: 1px solid var(--line);
      border-radius: 4px;
      padding: 0.1rem 0.35rem;
      color: #fff;
    }
    @media (max-width: 820px) {
      .main-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header class="speaker-header">
    <div class="header-left">
      <span class="deck-badge">Presenter View</span>
      <span class="slide-badge" id="popupSlideBadge">01 / 06</span>
    </div>
    <div class="header-center">
      <div class="clock-pill">Clock: <strong id="popupClock">--:-- --</strong></div>
      <div class="target-pill">Target: <strong id="popupTarget">1 min</strong></div>
    </div>
    <div class="header-right">
      <div class="timer-display" id="popupTimerDisplay">00:00:00</div>
      <button type="button" class="btn" id="popupTimerToggle">Start</button>
      <button type="button" class="btn" id="popupTimerReset">Reset</button>
      <button type="button" class="btn" id="popupScreenBtn" title="Move window to other display">⇄ Screen</button>
      <button type="button" class="btn btn-icon" id="popupFontMinus" title="Decrease font size">A-</button>
      <button type="button" class="btn btn-icon" id="popupFontPlus" title="Increase font size">A+</button>
      <button type="button" class="btn btn-nav" id="popupPrevBtn">← Prev</button>
      <button type="button" class="btn btn-nav primary" id="popupNextBtn">Next →</button>
    </div>
  </header>

  <main class="main-grid">
    <section class="notes-pane" id="popupNotesPane">
      <div class="slide-meta-bar">
        <div class="slide-meta-info">
          <span class="slide-eyebrow" id="popupSlideCategory">Vision & Overview</span>
          <h1 class="slide-heading" id="popupSlideTitle">Loading...</h1>
        </div>
      </div>

      <div class="talking-points-card">
        <div class="talking-points-header">Key Talking Points &amp; Guidance</div>
        <ul class="points-list" id="popupPointsList"></ul>
      </div>

      <div class="transition-card" id="popupTransitionCard">
        <span class="transition-label">Bridge to Next Slide</span>
        <p class="transition-text" id="popupTransitionText"></p>
      </div>
    </section>

    <aside class="side-pane">
      <div class="card-box">
        <div class="card-box-header">
          <span>Up Next</span>
          <span id="popupNextNumber">Slide 02</span>
        </div>
        <div class="up-next-card" id="popupUpNextCard">
          <div class="up-next-eyebrow" id="popupUpNextCategory">Category</div>
          <div class="up-next-title" id="popupUpNextTitle">Next slide title</div>
          <div class="up-next-points" id="popupUpNextSnippet">Next slide snippet</div>
        </div>
      </div>

      <div class="card-box">
        <div class="card-box-header">
          <span>Slide Index</span>
          <span>6 Slides</span>
        </div>
        <div class="slides-nav-list" id="popupSlideNavList"></div>
      </div>
    </aside>
  </main>

  <footer class="shortcuts-footer">
    <div>
      Keyboard: <span class="kbd-tag">→</span> / <span class="kbd-tag">Space</span> Next · <span class="kbd-tag">←</span> Prev · <span class="kbd-tag">1-6</span> Jump to slide
    </div>
    <div>Applied AI Deep Agent · Enterprise Research Workspace</div>
  </footer>
</body>
</html>`);
    doc.close();

    this.setupPopupEvents();
    this.startClock();
    this.startTimerLoop();
  }

  private setupPopupEvents(): void {
    if (!this.popupWindow) return;
    const doc = this.popupWindow.document;

    doc
      .getElementById("popupPrevBtn")
      ?.addEventListener("click", () => this.navigateAdjacent(-1));
    doc
      .getElementById("popupNextBtn")
      ?.addEventListener("click", () => this.navigateAdjacent(1));

    doc
      .getElementById("popupTimerToggle")
      ?.addEventListener("click", () => this.toggleTimer());
    doc
      .getElementById("popupTimerReset")
      ?.addEventListener("click", () => this.resetTimer());

    doc
      .getElementById("popupScreenBtn")
      ?.addEventListener("click", () => {
        void this.moveToNextScreen();
      });

    doc
      .getElementById("popupFontMinus")
      ?.addEventListener("click", () => this.adjustFontSize(-1));
    doc
      .getElementById("popupFontPlus")
      ?.addEventListener("click", () => this.adjustFontSize(1));

    this.popupWindow.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.target && (e.target as HTMLElement).tagName === "INPUT") return;

      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        this.navigateAdjacent(1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        this.navigateAdjacent(-1);
      } else if (e.key === "Home") {
        e.preventDefault();
        this.onNavigate(INTRO_SLIDES[0].id);
      } else if (e.key === "End") {
        e.preventDefault();
        this.onNavigate(INTRO_SLIDES[INTRO_SLIDES.length - 1].id);
      } else if (/^[1-6]$/.test(e.key)) {
        e.preventDefault();
        const targetIndex = Number(e.key) - 1;
        if (INTRO_SLIDES[targetIndex]) {
          this.onNavigate(INTRO_SLIDES[targetIndex].id);
        }
      }
    });
  }

  private navigateAdjacent(direction: -1 | 1): void {
    const currentIndex = INTRO_SLIDES.findIndex(
      (s) => s.id === this.currentSlideId
    );
    if (currentIndex < 0) return;
    const nextIndex = Math.max(
      0,
      Math.min(INTRO_SLIDES.length - 1, currentIndex + direction)
    );
    const target = INTRO_SLIDES[nextIndex];
    if (target) {
      this.onNavigate(target.id);
    }
  }

  private toggleTimer(): void {
    this.timerRunning = !this.timerRunning;
    if (this.popupWindow) {
      const toggleBtn =
        this.popupWindow.document.getElementById("popupTimerToggle");
      if (toggleBtn) {
        toggleBtn.textContent = this.timerRunning ? "Pause" : "Resume";
      }
    }
  }

  private resetTimer(): void {
    this.timerSeconds = 0;
    this.timerRunning = false;
    if (this.popupWindow) {
      const display = this.popupWindow.document.getElementById(
        "popupTimerDisplay"
      );
      if (display) display.textContent = "00:00:00";
      const toggleBtn =
        this.popupWindow.document.getElementById("popupTimerToggle");
      if (toggleBtn) toggleBtn.textContent = "Start";
    }
  }

  private adjustFontSize(delta: number): void {
    this.baseFontSize = Math.max(12, Math.min(22, this.baseFontSize + delta));
    if (this.popupWindow) {
      const pane = this.popupWindow.document.getElementById("popupNotesPane");
      if (pane) {
        pane.style.fontSize = `${this.baseFontSize}px`;
      }
    }
  }

  private async moveToNextScreen(): Promise<void> {
    if (!this.popupWindow || this.popupWindow.closed) return;
    if (typeof window === "undefined" || !("getScreenDetails" in window)) {
      return;
    }
    try {
      const screenDetails = await (window as unknown as {
        getScreenDetails: () => Promise<{
          screens: Array<{
            availLeft?: number;
            availTop?: number;
            availWidth?: number;
            availHeight?: number;
          }>;
          currentScreen: unknown;
        }>;
      }).getScreenDetails();

      if (!screenDetails?.screens || screenDetails.screens.length < 2) {
        return;
      }

      const screens = screenDetails.screens;
      const current = screenDetails.currentScreen;
      const currentIndex = screens.findIndex((s) => s === current);
      const nextIndex =
        currentIndex >= 0 ? (currentIndex + 1) % screens.length : 1;
      const targetScreen = screens[nextIndex];
      if (!targetScreen) return;

      const availWidth = targetScreen.availWidth || 1040;
      const availHeight = targetScreen.availHeight || 800;
      const width = Math.min(1040, availWidth);
      const height = Math.min(800, availHeight);
      const left =
        (targetScreen.availLeft ?? 0) +
        Math.max(20, Math.floor((availWidth - width) / 2));
      const top =
        (targetScreen.availTop ?? 0) +
        Math.max(20, Math.floor((availHeight - height) / 2));

      this.popupWindow.moveTo(left, top);
      this.popupWindow.resizeTo(width, height);
      this.popupWindow.focus();
    } catch {
      // Ignore if screen detail access is denied
    }
  }

  private startClock(): void {
    if (this.clockInterval) return;
    const update = () => {
      if (!this.popupWindow || this.popupWindow.closed) return;
      const el = this.popupWindow.document.getElementById("popupClock");
      if (el) {
        const now = new Date();
        el.textContent = now.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
      }
    };
    update();
    this.clockInterval = window.setInterval(update, 1000);
  }

  private startTimerLoop(): void {
    if (this.timerInterval) return;
    this.timerInterval = window.setInterval(() => {
      if (!this.timerRunning || !this.popupWindow || this.popupWindow.closed) {
        return;
      }
      this.timerSeconds++;
      const hrs = String(Math.floor(this.timerSeconds / 3600)).padStart(2, "0");
      const mins = String(
        Math.floor((this.timerSeconds % 3600) / 60)
      ).padStart(2, "0");
      const secs = String(this.timerSeconds % 60).padStart(2, "0");
      const display = this.popupWindow.document.getElementById(
        "popupTimerDisplay"
      );
      if (display) {
        display.textContent = `${hrs}:${mins}:${secs}`;
      }
    }, 1000);
  }

  private render(): void {
    if (!this.popupWindow || this.popupWindow.closed) return;
    const doc = this.popupWindow.document;

    const currentIndex = INTRO_SLIDES.findIndex(
      (s) => s.id === this.currentSlideId
    );
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const currentSlide = INTRO_SLIDES[safeIndex];
    const notes: SlideSpeakerNote =
      INTRO_SPEAKER_NOTES[currentSlide.id] || {
        id: currentSlide.id,
        title: currentSlide.label,
        duration: "2 mins",
        minutes: 2,
        category: "General",
        talkingPoints: ["Present slide content clearly."],
        transitionCue: "Move to next slide.",
      };

    // Update badges & header
    const badge = doc.getElementById("popupSlideBadge");
    if (badge) {
      badge.textContent = `${String(safeIndex + 1).padStart(2, "0")} / ${String(
        INTRO_SLIDES.length
      ).padStart(2, "0")}`;
    }

    const targetEl = doc.getElementById("popupTarget");
    if (targetEl) targetEl.textContent = notes.duration;

    const catEl = doc.getElementById("popupSlideCategory");
    if (catEl) catEl.textContent = notes.category;

    const titleEl = doc.getElementById("popupSlideTitle");
    if (titleEl) titleEl.textContent = notes.title;

    // Talking points
    const pointsList = doc.getElementById("popupPointsList");
    if (pointsList) {
      pointsList.innerHTML = notes.talkingPoints
        .map((point) => {
          // Convert **text** to <strong>text</strong>
          const html = point.replace(
            /\*\*(.*?)\*\*/g,
            "<strong>$1</strong>"
          );
          return `<li><span>${html}</span></li>`;
        })
        .join("");
    }

    // Transition cue
    const transText = doc.getElementById("popupTransitionText");
    if (transText) {
      transText.textContent = notes.transitionCue;
    }

    // Up Next preview
    const nextIndex = safeIndex + 1;
    const upNextCard = doc.getElementById("popupUpNextCard");
    const nextNumEl = doc.getElementById("popupNextNumber");
    const upNextCatEl = doc.getElementById("popupUpNextCategory");
    const upNextTitleEl = doc.getElementById("popupUpNextTitle");
    const upNextSnippetEl = doc.getElementById("popupUpNextSnippet");

    if (nextIndex < INTRO_SLIDES.length) {
      const nextSlide = INTRO_SLIDES[nextIndex];
      const nextNotes = INTRO_SPEAKER_NOTES[nextSlide.id];
      if (nextNumEl)
        nextNumEl.textContent = `Slide ${String(nextIndex + 1).padStart(
          2,
          "0"
        )}`;
      if (upNextCatEl)
        upNextCatEl.textContent = nextNotes?.category || "Next";
      if (upNextTitleEl)
        upNextTitleEl.textContent = nextNotes?.title || nextSlide.label;
      if (upNextSnippetEl)
        upNextSnippetEl.textContent =
          nextNotes?.talkingPoints[0]?.replace(/\*\*/g, "") ||
          "Upcoming topic overview.";
      if (upNextCard) upNextCard.style.opacity = "1";
    } else {
      if (nextNumEl) nextNumEl.textContent = "Final Slide";
      if (upNextCatEl) upNextCatEl.textContent = "Conclusion";
      if (upNextTitleEl)
        upNextTitleEl.textContent = "End of Presentation";
      if (upNextSnippetEl)
        upNextSnippetEl.textContent = "Q&A and open discussion.";
    }

    // Slide navigation list
    const navList = doc.getElementById("popupSlideNavList");
    if (navList) {
      navList.innerHTML = INTRO_SLIDES.map((slide, idx) => {
        const isActive = slide.id === this.currentSlideId;
        const slideNotes = INTRO_SPEAKER_NOTES[slide.id];
        return `<button type="button" class="nav-item-btn ${
          isActive ? "active" : ""
        }" data-slide-id="${slide.id}">
          <span class="nav-item-num">${String(idx + 1).padStart(2, "0")}</span>
          <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${
            slide.label
          }</span>
          <span class="nav-item-time">${slideNotes?.duration || "2m"}</span>
        </button>`;
      }).join("");

      navList.querySelectorAll(".nav-item-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const sid = btn.getAttribute("data-slide-id") as IntroSlideId;
          if (sid) this.onNavigate(sid);
        });
      });
    }
  }
}
