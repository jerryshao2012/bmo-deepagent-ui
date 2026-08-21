import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const introPagePath = new URL("../src/app/intro/page.tsx", import.meta.url);

const revealSelectors = [
  ".hero-copy",
  ".hero-preview",
  ".chapter-copy",
  ".chapter-visual",
  ".chapter-reveal",
  ".launch-content",
];

function getInlineCss(source) {
  const cssMarker = "__html: `";
  const cssStart = source.indexOf(cssMarker);
  const cssEnd = source.indexOf("\n      `,", cssStart);

  assert.notEqual(cssStart, -1);
  assert.notEqual(cssEnd, -1);
  return source.slice(cssStart + cssMarker.length, cssEnd);
}

function getCssRules(css, selector) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((match) => ({
      selectors: match[1].split(",").map((value) => value.trim()),
      declarations: match[2],
      index: match.index ?? -1,
    }))
    .filter((rule) => rule.selectors.includes(selector));
}

function getSelectorSpecificity(selector) {
  const idCount = selector.match(/#[\w-]+/g)?.length ?? 0;
  const classLikeCount =
    selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g)?.length ?? 0;
  const elementCount = selector
    .split(/[\s>+~]+/)
    .filter((part) => /^[a-z][\w-]*/i.test(part)).length;

  return [idCount, classLikeCount, elementCount];
}

function compareSpecificity(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

// Intentional slide-copy changes must update both checksum sentinels after review.
function extractPresentationText(source) {
  const sourceFile = ts.createSourceFile(
    introPagePath.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let main;

  function findMain(node) {
    if (
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(sourceFile) === "main"
    ) {
      main = node;
      return;
    }
    if (!main) ts.forEachChild(node, findMain);
  }

  findMain(sourceFile);
  assert.ok(main, "expected presentation main JSX element");

  const entries = [];
  const append = (value) => {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized) entries.push(normalized);
  };

  function collectRenderedExpression(expression) {
    if (
      ts.isStringLiteral(expression) ||
      ts.isNoSubstitutionTemplateLiteral(expression)
    ) {
      append(expression.text);
      return;
    }
    if (ts.isParenthesizedExpression(expression)) {
      collectRenderedExpression(expression.expression);
      return;
    }
    if (ts.isConditionalExpression(expression)) {
      collectRenderedExpression(expression.whenTrue);
      collectRenderedExpression(expression.whenFalse);
      return;
    }
    if (
      ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      collectRenderedExpression(expression.right);
    }
  }

  function collectChildren(children) {
    for (const child of children) {
      if (ts.isJsxText(child)) {
        append(child.getText(sourceFile));
      } else if (ts.isJsxElement(child) || ts.isJsxFragment(child)) {
        collectChildren(child.children);
      } else if (ts.isJsxExpression(child) && child.expression) {
        collectRenderedExpression(child.expression);
      }
    }
  }

  collectChildren(main.children);
  return entries;
}

for (const [variable, value] of [
  ["--bmo-blue", "#0075be"],
  ["--bmo-navy", "#001928"],
  ["--bmo-red", "#e31837"],
  ["--bmo-surface", "#f3f7fa"],
  ["--bmo-line", "#d6e2ea"],
]) {
  test(`intro page declares ${variable} on its page root`, async () => {
    const source = await readFile(introPagePath, "utf8");
    const css = getInlineCss(source);
    const rootRule = getCssRules(css, ".intro-page")[0];

    assert.ok(rootRule, "expected an .intro-page CSS rule");
    assert.match(
      rootRule.declarations,
      new RegExp(`${variable}:\\s*${value};`, "i")
    );
  });
}

test("intro page renders exactly six ordered semantic presentation slides", async () => {
  const source = await readFile(introPagePath, "utf8");
  const slideSections = [...source.matchAll(/<section\b[\s\S]*?>/g)]
    .map(([openingTag]) => openingTag)
    .filter((openingTag) => openingTag.includes("data-intro-slide"));

  assert.equal(source.match(/\bdata-intro-slide\b/g)?.length, 6);
  assert.deepEqual(
    slideSections.map((openingTag) => openingTag.match(/id="([^"]+)"/)?.[1]),
    ["hero", "preview", "phase1", "phase2", "phase3", "launch"]
  );
  for (const openingTag of slideSections) {
    assert.match(openingTag, /className="[^"]*\bintro-slide\b[^"]*"/);
    assert.match(openingTag, /min-h-\[100dvh\]/);
  }
  assert.doesNotMatch(
    source,
    /<section className="border-t border-stone-200\/40 bg-white">/
  );
});

test("all six slides preserve the approved visible-copy checksum", async () => {
  const source = await readFile(introPagePath, "utf8");
  const entries = extractPresentationText(source);
  const checksum = createHash("sha256")
    .update(JSON.stringify(entries))
    .digest("hex");

  assert.equal(entries.length, 94);
  assert.equal(
    checksum,
    "f357fe008405b6bee0f4ad54b3c0742387b53d27730a144f25b410f6c0c90d78"
  );
});

test("intro page removes obsolete sticky story and negative launch tail", async () => {
  const source = await readFile(introPagePath, "utf8");
  const css = getInlineCss(source);

  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /scroll-margin-top/);
  assert.doesNotMatch(source, /min-height:\s*145vh/);
  assert.doesNotMatch(source, /lg:-mt-\[calc\(40vh-3rem\)\]/);
  assert.doesNotMatch(source, /lg:min-h-\[calc\(100vh-3rem\)\]/);
  assert.doesNotMatch(source, /data-scroll-chapter/);
  assert.doesNotMatch(source, /data-scroll-reveal/);
  assert.doesNotMatch(css, /\.apple-fade\s*\{[^}]*opacity:\s*0/);
});

test("intro page gates reveal hiding behind JS readiness and activates every reveal role", async () => {
  const source = await readFile(introPagePath, "utf8");
  const css = getInlineCss(source);

  for (const selector of revealSelectors) {
    const gatedSelector = `.intro-presentation-ready .intro-slide ${selector}`;
    const activeSelector = `.intro-presentation-ready .intro-slide.is-active ${selector}`;
    const gatedRule = getCssRules(css, gatedSelector).find((rule) =>
      /opacity:\s*0/.test(rule.declarations)
    );
    const activeRule = getCssRules(css, activeSelector).find((rule) =>
      /opacity:\s*1/.test(rule.declarations)
    );

    assert.ok(gatedRule, `expected JS-ready gated hiding for ${selector}`);
    assert.match(gatedRule.declarations, /transform:\s*translateY\([^)]*\)/);
    assert.match(
      gatedRule.declarations,
      /opacity 700ms cubic-bezier\(\.16,\s*1,\s*\.3,\s*1\)/
    );
    assert.match(
      gatedRule.declarations,
      /transform 700ms cubic-bezier\(\.16,\s*1,\s*\.3,\s*1\)/
    );
    assert.ok(activeRule, `expected active-slide reveal for ${selector}`);
    assert.match(activeRule.declarations, /transform:\s*translateY\(0\)/);

    const unsafeHiddenRule = getCssRules(css, selector).find((rule) =>
      /opacity:\s*0/.test(rule.declarations)
    );
    assert.equal(
      unsafeHiddenRule,
      undefined,
      `${selector} must stay visible without the JS-ready root class`
    );
  }
});

test("chapter reveal items keep deliberate active-slide stagger", async () => {
  const source = await readFile(introPagePath, "utf8");
  const css = getInlineCss(source);

  const second = getCssRules(
    css,
    '.intro-presentation-ready .intro-slide.is-active .chapter-reveal[data-reveal="2"]'
  )[0];
  const third = getCssRules(
    css,
    '.intro-presentation-ready .intro-slide.is-active .chapter-reveal[data-reveal="3"]'
  )[0];

  assert.match(second?.declarations ?? "", /transition-delay:\s*120ms/);
  assert.match(third?.declarations ?? "", /transition-delay:\s*220ms/);
});

test("reduced motion makes every reveal visible and disables workflow motion", async () => {
  const source = await readFile(introPagePath, "utf8");
  const css = getInlineCss(source);
  const reducedMotionStart = css.indexOf(
    "@media (prefers-reduced-motion: reduce)"
  );
  const reducedMotionCss = css.slice(reducedMotionStart);

  assert.notEqual(reducedMotionStart, -1);
  for (const selector of revealSelectors) {
    const override = getCssRules(
      reducedMotionCss,
      `.intro-presentation-ready .intro-slide ${selector}`
    ).find(
      (rule) =>
        /opacity:\s*1/.test(rule.declarations) &&
        /transform:\s*none/.test(rule.declarations) &&
        /transition:\s*none/.test(rule.declarations)
    );
    assert.ok(override, `expected reduced-motion visibility for ${selector}`);
  }

  assert.match(
    reducedMotionCss,
    /\.workflow-route\s*\{\s*transition:\s*none;\s*\}/
  );
  assert.match(
    reducedMotionCss,
    /\.workflow-node\s*\{\s*transition:\s*none;\s*transform:\s*none;\s*\}/
  );
  assert.match(
    reducedMotionCss,
    /\.workflow-particle\s*\{\s*display:\s*none;\s*\}/
  );
});

test("reduced motion wins the cascade for active and inactive reveal roles", async () => {
  const source = await readFile(introPagePath, "utf8");
  const css = getInlineCss(source);
  const reducedMotionStart = css.indexOf(
    "@media (prefers-reduced-motion: reduce)"
  );

  assert.notEqual(reducedMotionStart, -1);

  for (const selector of revealSelectors) {
    const inactiveSelector = `.intro-presentation-ready .intro-slide ${selector}`;
    const activeSelector = `.intro-presentation-ready .intro-slide.is-active ${selector}`;
    const inactiveRule = getCssRules(css, inactiveSelector).find(
      (rule) =>
        rule.index < reducedMotionStart &&
        /opacity:\s*0/.test(rule.declarations)
    );
    const activeRule = getCssRules(css, activeSelector).find(
      (rule) =>
        rule.index < reducedMotionStart &&
        /opacity:\s*1/.test(rule.declarations)
    );
    const reducedInactiveRule = getCssRules(css, inactiveSelector).find(
      (rule) =>
        rule.index > reducedMotionStart &&
        /opacity:\s*1/.test(rule.declarations) &&
        /transform:\s*none/.test(rule.declarations) &&
        /transition:\s*none/.test(rule.declarations)
    );
    const reducedActiveRule = getCssRules(css, activeSelector).find(
      (rule) =>
        rule.index > reducedMotionStart &&
        /opacity:\s*1/.test(rule.declarations) &&
        /transform:\s*none/.test(rule.declarations) &&
        /transition:\s*none/.test(rule.declarations)
    );

    assert.ok(inactiveRule, `expected initial inactive rule for ${selector}`);
    assert.ok(activeRule, `expected initial active rule for ${selector}`);
    assert.ok(
      reducedInactiveRule,
      `expected later reduced-motion inactive override for ${selector}`
    );
    assert.ok(
      reducedActiveRule,
      `expected later reduced-motion active override for ${selector}`
    );
    assert.ok(reducedInactiveRule.index > inactiveRule.index);
    assert.ok(reducedActiveRule.index > activeRule.index);
    assert.doesNotMatch(reducedInactiveRule.declarations, /!important/);
    assert.doesNotMatch(reducedActiveRule.declarations, /!important/);
    const initialInactiveSelector = inactiveRule.selectors.find(
      (candidate) => candidate === inactiveSelector
    );
    const initialActiveSelector = activeRule.selectors.find(
      (candidate) => candidate === activeSelector
    );
    const reducedInactiveSelector = reducedInactiveRule.selectors.find(
      (candidate) => candidate === inactiveSelector
    );
    const reducedActiveSelector = reducedActiveRule.selectors.find(
      (candidate) => candidate === activeSelector
    );

    assert.ok(initialInactiveSelector && reducedInactiveSelector);
    assert.ok(initialActiveSelector && reducedActiveSelector);
    assert.ok(
      compareSpecificity(
        getSelectorSpecificity(reducedInactiveSelector),
        getSelectorSpecificity(initialInactiveSelector)
      ) >= 0
    );
    assert.ok(
      compareSpecificity(
        getSelectorSpecificity(reducedActiveSelector),
        getSelectorSpecificity(initialActiveSelector)
      ) >= 0
    );
  }

  for (const revealIndex of ["2", "3"]) {
    const staggerSelector = `.intro-presentation-ready .intro-slide.is-active .chapter-reveal[data-reveal="${revealIndex}"]`;
    const staggerRules = getCssRules(css, staggerSelector);
    const staggerRule = staggerRules.find(
      (rule) =>
        rule.index < reducedMotionStart &&
        /transition-delay:\s*(?:120|220)ms/.test(rule.declarations)
    );
    const reducedStaggerRule = staggerRules.find(
      (rule) =>
        rule.index > reducedMotionStart &&
        /transition-delay:\s*0s/.test(rule.declarations)
    );

    assert.ok(staggerRule, `expected stagger ${revealIndex}`);
    assert.ok(
      reducedStaggerRule,
      `expected reduced-motion delay reset for reveal ${revealIndex}`
    );
    assert.ok(reducedStaggerRule.index > staggerRule.index);
    assert.doesNotMatch(reducedStaggerRule.declarations, /!important/);
    const initialStaggerSelector = staggerRule.selectors.find(
      (candidate) => candidate === staggerSelector
    );
    const reducedDelaySelector = reducedStaggerRule.selectors.find(
      (candidate) => candidate === staggerSelector
    );

    assert.ok(initialStaggerSelector && reducedDelaySelector);
    assert.ok(
      compareSpecificity(
        getSelectorSpecificity(reducedDelaySelector),
        getSelectorSpecificity(initialStaggerSelector)
      ) >= 0
    );
  }
});

test("intro slides keep readable viewport sizing and snap anchors", async () => {
  const source = await readFile(introPagePath, "utf8");
  const css = getInlineCss(source);
  const slideRule = getCssRules(css, ".intro-slide")[0];

  assert.ok(slideRule);
  assert.match(slideRule.declarations, /min-height:\s*100dvh/);
  assert.match(slideRule.declarations, /scroll-margin-top:\s*4rem/);
  assert.match(slideRule.declarations, /scroll-snap-align:\s*start/);
  assert.match(slideRule.declarations, /position:\s*relative/);
  assert.doesNotMatch(css, /(?:^|[;{])\s*height:\s*100vh/);
});

test("intro page keeps document as the only vertical scroll container", async () => {
  const source = await readFile(introPagePath, "utf8");

  assert.match(source, /min-h-screen overflow-x-clip/);
  assert.doesNotMatch(source, /min-h-screen overflow-x-hidden/);
});

test("intro page pre-renders presentation content without a JavaScript-only Suspense shell", async () => {
  const source = await readFile(introPagePath, "utf8");
  const threadEffectStart = source.indexOf(
    "// Generate 6-digit Thread ID if not present in query params"
  );
  const threadEffectEnd = source.indexOf(
    "// Handle mouse move for interactive card 3D tilt",
    threadEffectStart
  );
  const threadEffect = source.slice(threadEffectStart, threadEffectEnd);

  assert.notEqual(threadEffectStart, -1);
  assert.ok(threadEffectEnd > threadEffectStart);
  assert.doesNotMatch(
    source,
    /import \{ useSearchParams \} from "next\/navigation";/
  );
  assert.doesNotMatch(source, /\buseSearchParams\(\)/);
  assert.doesNotMatch(source, /<React\.Suspense|Loading Harness Engine/);
  assert.match(threadEffect, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(threadEffect, /const tid = searchParams\.get\("thread_id"\);/);
  assert.match(
    threadEffect,
    /window\.history\.replaceState\(\{\}, "", url\.toString\(\)\);/
  );
  assert.match(threadEffect, /\}, \[\]\);/);
  assert.match(
    source,
    /export default function IntroPage\(\) \{\s*return <IntroPageContent \/>;\s*\}/
  );
});

test("hero and workspace preview are separate sibling slides", async () => {
  const source = await readFile(introPagePath, "utf8");
  const heroStart = source.indexOf('id="hero"');
  const heroEnd = source.indexOf("</section>", heroStart);
  const previewStart = source.indexOf('id="preview"', heroEnd);
  const previewEnd = source.indexOf("</section>", previewStart);

  assert.notEqual(heroStart, -1);
  assert.notEqual(heroEnd, -1);
  assert.ok(previewStart > heroEnd);
  assert.ok(previewEnd > previewStart);
  assert.match(source.slice(heroStart, heroEnd), /hero-copy/);
  assert.doesNotMatch(source.slice(heroStart, heroEnd), /hero-preview/);
  assert.match(source.slice(previewStart, previewEnd), /hero-preview/);
  assert.match(
    source.slice(previewStart, previewEnd),
    /aria-label="Workspace preview"/
  );
  assert.match(source.slice(previewStart, previewEnd), /ref=\{stackRef\}/);
  assert.match(
    source.slice(previewStart, previewEnd),
    /Active Thread: #\{threadId\}/
  );
});

test("intro page integrates suspended presentation control and chrome", async () => {
  const source = await readFile(introPagePath, "utf8");
  const chromeStart = source.indexOf("<PresentationChrome");
  const inlineStyleEnd = source.indexOf("/>", source.indexOf("<style"));
  const headerStart = source.indexOf("<header", inlineStyleEnd);

  assert.match(
    source,
    /import \{ PresentationChrome \} from "\.\/presentation-chrome";/
  );
  assert.match(
    source,
    /import \{ useIntroPresentation \} from "\.\/use-intro-presentation";/
  );
  assert.equal(
    source.match(/useIntroPresentation\(\{ suspended: isDialogOpen \}\)/g)
      ?.length,
    1
  );
  assert.match(source, /activeSlideId=\{presentation\.activeSlideId\}/);
  assert.match(source, /isFullscreen=\{presentation\.isFullscreen\}/);
  assert.match(source, /fullscreenStatus=\{presentation\.fullscreenStatus\}/);
  assert.match(
    source,
    /onNavigate=\{\(id\) => presentation\.goToSlide\(id, "push"\)\}/
  );
  assert.match(
    source,
    /onToggleFullscreen=\{\(\) => void presentation\.toggleFullscreen\(\)\}/
  );
  assert.ok(inlineStyleEnd < chromeStart && chromeStart < headerStart);
});

test("controlled Radix dialog isolates the Markdown preview", async () => {
  const source = await readFile(introPagePath, "utf8");
  const dialogStart = source.indexOf("<DialogPrimitive.Root");
  const dialog = source.slice(dialogStart);

  assert.match(
    source,
    /import \* as DialogPrimitive from "@radix-ui\/react-dialog";/
  );
  assert.notEqual(dialogStart, -1);
  assert.match(dialog, /open=\{isDialogOpen\}/);
  assert.match(
    dialog,
    /onOpenChange=\{\(open\) => \{[\s\S]{0,100}if \(!open\) closeMarkdownPreview\(\);[\s\S]{0,40}\}\}/
  );
  assert.match(dialog, /<DialogPrimitive\.Portal>/);
  assert.match(
    dialog,
    /<DialogPrimitive\.Overlay[\s\S]{0,180}z-\[100\][\s\S]{0,120}bg-black\/75[\s\S]{0,120}backdrop-blur-md/
  );
  assert.match(
    dialog,
    /<DialogPrimitive\.Content[\s\S]{0,260}onPointerDownOutside=\{\(event\) => event\.preventDefault\(\)\}[\s\S]{0,600}z-\[101\]/
  );
  assert.match(
    dialog,
    /<DialogPrimitive\.Title asChild>[\s\S]{0,160}<h3[\s\S]{0,160}Markdown Online Preview[\s\S]{0,80}<\/h3>[\s\S]{0,40}<\/DialogPrimitive\.Title>/
  );
  assert.doesNotMatch(source, /\{isDialogOpen && \(\s*<div/);
});

test("presentation slides use one labelled main and active phase link semantics", async () => {
  const source = await readFile(introPagePath, "utf8");
  const mainStart = source.indexOf(
    '<main aria-label="Applied AI Deep Agent presentation">'
  );
  const mainEnd = source.indexOf("</main>", mainStart);
  const dialogStart = source.indexOf("<DialogPrimitive.Root");
  const main = source.slice(mainStart, mainEnd);

  assert.notEqual(mainStart, -1);
  assert.ok(main.includes('id="hero"'));
  assert.ok(main.includes('id="launch"'));
  assert.ok(mainEnd < dialogStart);
  assert.equal(main.match(/\bdata-intro-slide\b/g)?.length, 6);
  for (const phaseId of ["phase1", "phase2", "phase3"]) {
    assert.match(
      source,
      new RegExp(
        `aria-current=\\{\\s*presentation\\.activeSlideId === "${phaseId}" \\? "step" : undefined\\s*\\}`
      )
    );
  }
});

test("intro header retains product actions and follows active presentation slide", async () => {
  const source = await readFile(introPagePath, "utf8");
  const header = source.slice(
    source.indexOf("<header"),
    source.indexOf("</header>")
  );

  assert.doesNotMatch(source, /\bscrollY\b/);
  for (const stableHeaderClass of [
    "border-[#D6E2EA]",
    "bg-white/95",
    "shadow-sm",
    "backdrop-blur-xl",
  ]) {
    assert.ok(header.includes(stableHeaderClass));
  }
  assert.match(header, /Applied AI Deep Agent/);
  assert.match(header, /ref=\{markdownPreviewTriggerRef\}/);
  assert.match(header, /Collab Thread/);
  assert.match(header, /: #\{threadId\}/);
  assert.match(header, /Launch Workspace/);
  for (const phaseId of ["phase1", "phase2", "phase3"]) {
    assert.match(
      header,
      new RegExp(
        `presentation\\.activeSlideId === "${phaseId}" && "text-\\[#0075BE\\]"`
      )
    );
  }
});

test("phase 2 keeps complete connector tracks beneath animated paths", async () => {
  const source = await readFile(introPagePath, "utf8");
  const connectorPaths = [
    "M 120 180 Q 220 180 320 120",
    "M 120 180 Q 220 180 320 240",
    "M 320 120 Q 420 120 520 180",
    "M 320 240 Q 420 240 520 180",
  ];

  assert.match(source, /data-connector-track[\s\S]{0,220}stroke="#e2e8f0"/);
  for (const path of connectorPaths) {
    assert.equal(source.split(`d="${path}"`).length - 1, 2);
  }
});

test("phase 2 activates complete contextual workflow routes", async () => {
  const source = await readFile(introPagePath, "utf8");

  assert.match(source, /type WorkflowNodeId = "A" \| "B" \| "C" \| "D";/);
  assert.match(source, /useState<WorkflowNodeId \| null>\(null\)/);
  assert.match(source, /const activeNode = hoveredNode \?\? focusedNode;/);
  assert.match(
    source,
    /upperRouteActive\s*=\s*activeNode !== null &&\s*\["A", "B", "C"\]\.includes\(activeNode\)/
  );
  assert.match(
    source,
    /lowerRouteActive\s*=\s*activeNode !== null &&\s*\["A", "B", "D"\]\.includes\(activeNode\)/
  );
  assert.equal(source.match(/data-workflow-route="upper"/g)?.length, 2);
  assert.equal(source.match(/data-workflow-route="lower"/g)?.length, 2);
  assert.equal(
    source.match(/stroke=\{upperRouteActive \? "#0075be" : "transparent"\}/gi)
      ?.length,
    2
  );
  assert.equal(
    source.match(/stroke=\{lowerRouteActive \? "#0075be" : "transparent"\}/gi)
      ?.length,
    2
  );
  assert.equal(source.match(/className="workflow-route"/g)?.length, 4);
  assert.match(
    source,
    /\.workflow-route\s*\{\s*transition:\s*stroke 240ms ease;\s*\}/
  );
  assert.doesNotMatch(source, /chapter-path/);
});

test("phase 2 shows directional particles only on active routes", async () => {
  const source = await readFile(introPagePath, "utf8");

  assert.equal(
    source.match(/<circle\s+className="workflow-particle"/g)?.length,
    2
  );
  assert.equal(source.match(/<animateMotion/g)?.length, 2);
  assert.equal(source.match(/dur="1\.6s"/g)?.length, 2);
  assert.equal(source.match(/repeatCount="indefinite"/g)?.length, 2);
  assert.match(
    source,
    /\{upperRouteActive && \([\s\S]*path="M 120 180 Q 220 180 320 120 Q 420 120 520 180"[\s\S]*?\)\}/
  );
  assert.match(
    source,
    /\{lowerRouteActive && \([\s\S]*begin=\{upperRouteActive \? "0\.18s" : "0s"\}[\s\S]*path="M 120 180 Q 220 180 320 240 Q 420 240 520 180"[\s\S]*?\)\}/
  );
  assert.match(
    source,
    /\.workflow-particle\s*\{\s*fill:\s*#0075be;\s*filter:\s*drop-shadow\(0 0 4px rgba\(0, 117, 190, 0\.72\)\);\s*pointer-events:\s*none;\s*\}/i
  );
  assert.match(
    source,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.workflow-particle\s*\{\s*display:\s*none;\s*\}/
  );
});

test("phase 2 workflow cards preserve pointer state and support focus", async () => {
  const source = await readFile(introPagePath, "utf8");

  assert.match(
    source,
    /const \[hoveredNode, setHoveredNode\] =\s*useState<WorkflowNodeId \| null>\(null\);/
  );
  assert.match(
    source,
    /const \[focusedNode, setFocusedNode\] =\s*useState<WorkflowNodeId \| null>\(null\);/
  );
  for (const [id, label] of [
    ["A", "Source Material"],
    ["B", "Source-Linked Report"],
    ["C", "Living Wiki"],
    ["D", "Research Plan"],
  ]) {
    assert.match(
      source,
      new RegExp(`onMouseEnter=\\{\\(\\) => setHoveredNode\\("${id}"\\)\\}`)
    );
    assert.match(
      source,
      new RegExp(`onFocus=\\{\\(\\) => setFocusedNode\\("${id}"\\)\\}`)
    );
    assert.match(source, new RegExp(`aria-label="${label}"`));
  }
  assert.equal(source.match(/tabIndex=\{0\}/g)?.length, 4);
  assert.equal(
    source.match(/onMouseLeave=\{\(\) => setHoveredNode\(null\)\}/g)?.length,
    4
  );
  assert.equal(
    source.match(/onBlur=\{\(\) => setFocusedNode\(null\)\}/g)?.length,
    4
  );
  assert.equal(source.match(/activeNode === "[ABCD]"/g)?.length, 8);
  assert.doesNotMatch(source, /hoveredNode === "[ABCD]"/);
  assert.match(source, /\{!activeNode &&\s*"Hover or focus nodes/);
});

test("all four workflow nodes use BMO-blue active borders and focus rings", async () => {
  const source = await readFile(introPagePath, "utf8");
  const phase2Id = source.indexOf('id="phase2"');
  const phase2Start = source.lastIndexOf("<section", phase2Id);
  const phase2End = source.indexOf("</section>", phase2Start);
  const phase2 = source.slice(phase2Start, phase2End);
  const nodeClasses = [
    ...phase2.matchAll(
      /className=\{cn\(\s*"([^"]*\bworkflow-node\b[^"]*)",\s*activeNode === "([ABCD])"\s*\?\s*"([^"]*)"\s*:\s*"([^"]*)"\s*\)\}/g
    ),
  ].map(([, baseClasses, nodeId, activeClasses, inactiveClasses]) => ({
    activeClasses,
    baseClasses,
    inactiveClasses,
    nodeId,
  }));

  assert.ok(phase2Start >= 0 && phase2End > phase2Start);
  assert.equal(nodeClasses.length, 4);
  assert.deepEqual(nodeClasses.map(({ nodeId }) => nodeId).sort(), [
    "A",
    "B",
    "C",
    "D",
  ]);
  for (const { activeClasses, baseClasses, inactiveClasses } of nodeClasses) {
    assert.match(baseClasses, /focus-visible:ring-2/);
    assert.match(baseClasses, /focus-visible:ring-\[#0075BE\]/i);
    assert.match(activeClasses, /border-\[#0075BE\]/i);
    assert.match(
      activeClasses,
      /shadow-\[0_8px_20px_-12px_rgba\(0,117,190,0\.45\)\]/i
    );
    assert.match(inactiveClasses, /border-\[#D6E2EA\]/i);
    assert.doesNotMatch(
      `${baseClasses} ${activeClasses} ${inactiveClasses}`,
      /#e31837|#ff8a42/i
    );
  }
});

test("presentation uses blue identity accents, red launch actions, and navy final surface", async () => {
  const source = await readFile(introPagePath, "utf8");
  const presentationStart = source.indexOf("<style");
  const presentationEnd = source.indexOf("<DialogPrimitive.Root");
  const presentation = source.slice(presentationStart, presentationEnd);
  const header = source.slice(
    source.indexOf("<header", presentationStart),
    source.indexOf("</header>", presentationStart)
  );
  const hero = source.slice(
    source.indexOf('id="hero"', presentationStart),
    source.indexOf("</section>", source.indexOf('id="hero"'))
  );
  const launch = source.slice(
    source.indexOf('id="launch"', presentationStart),
    source.indexOf("</section>", source.indexOf('id="launch"'))
  );
  const launchAnchors = [...presentation.matchAll(/<a\b[\s\S]*?<\/a>/g)]
    .map(([anchor]) => anchor)
    .filter((anchor) => anchor.includes("Launch Workspace"));

  assert.match(
    header,
    /bg-\[#0075BE\][^\"]*[^>]*>[\s\S]{0,700}Applied AI Deep Agent/i
  );
  assert.match(
    hero,
    /text-\[#0075BE\][\s\S]{0,100}Enterprise Research Workspace/i
  );
  assert.equal(launchAnchors.length, 3);
  for (const anchor of launchAnchors) {
    assert.match(anchor, /bg-\[#E31837\]/i);
    assert.match(anchor, /hover:bg-\[#B8122D\]/i);
    assert.match(anchor, /active:bg-\[#971126\]/i);
  }
  assert.match(launch, /className="[^"]*bg-\[#001928\][^"]*"/i);
  assert.match(
    launch,
    /radial-gradient\(circle_at_center,rgba\(0,117,190,0\.12\)_0%,transparent_70%\)/i
  );
  assert.doesNotMatch(presentation, /#ff8a42|rgba\(255,\s*138,\s*66/i);
  assert.match(presentation, /Applied AI Deep Agent/);
});

test("presentation reserves its red palette for exactly three launch actions", async () => {
  const source = await readFile(introPagePath, "utf8");
  const headerStart = source.indexOf("<header");
  const headerEnd =
    source.indexOf("</header>", headerStart) + "</header>".length;
  const mainStart = source.indexOf("<main", headerEnd);
  const mainEnd = source.indexOf("</main>", mainStart) + "</main>".length;
  const presentationMarkup =
    source.slice(headerStart, headerEnd) + source.slice(mainStart, mainEnd);
  const redPalette = /var\(--bmo-red\)|#e31837|#b8122d|#971126/gi;
  const launchActions = [...presentationMarkup.matchAll(/<a\b[\s\S]*?<\/a>/g)]
    .map(([anchor]) => anchor)
    .filter((anchor) => /Launch Workspace/.test(anchor));

  assert.ok(
    headerStart >= 0 && headerEnd > headerStart,
    "expected bounded presentation header"
  );
  assert.ok(
    mainStart >= 0 && mainEnd > mainStart,
    "expected bounded presentation main"
  );
  assert.equal(launchActions.length, 3);
  for (const action of launchActions) {
    assert.equal(action.match(redPalette)?.length, 3);
    assert.match(action, /bg-\[(?:var\(--bmo-red\)|#E31837)\]/i);
    assert.match(action, /hover:bg-\[#B8122D\]/i);
    assert.match(action, /active:bg-\[#971126\]/i);
  }

  const nonLaunchMarkup = launchActions.reduce(
    (markup, action) => markup.replace(action, ""),
    presentationMarkup
  );
  assert.doesNotMatch(nonLaunchMarkup, redPalette);
});

test("phase 2 workflow semantics respect accessibility motion settings", async () => {
  const source = await readFile(introPagePath, "utf8");

  assert.equal(source.match(/role="group"/g)?.length, 4);
  assert.equal(
    source.match(/workflow-node w-full max-w-36 cursor-pointer/g)?.length,
    4
  );
  for (const label of [
    "Source Material",
    "Living Wiki",
    "Research Plan",
    "Source-Linked Report",
  ]) {
    assert.match(
      source,
      new RegExp(
        `role="group"[\\s\\S]{0,600}aria-label="${label}"[\\s\\S]{0,160}"workflow-node`
      )
    );
  }
  assert.match(
    source,
    /Node Tree Visualizer[\s\S]{0,350}<svg[\s\S]{0,250}aria-hidden="true"[\s\S]{0,100}focusable="false"/
  );
  assert.match(
    source,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.workflow-route\s*\{\s*transition:\s*none;\s*\}[\s\S]*?\.workflow-node\s*\{\s*transition:\s*none;\s*transform:\s*none;\s*\}[\s\S]*?\.workflow-particle\s*\{\s*display:\s*none;\s*\}/
  );
});

test("phase 2 workflow stacks safely below sm and keeps diagram layout above it", async () => {
  const source = await readFile(introPagePath, "utf8");
  const phase2Start = source.indexOf('id="phase2"');
  const phase2End = source.indexOf("</section>", phase2Start);
  const phase2 = source.slice(phase2Start, phase2End);

  assert.match(
    phase2,
    /<svg[\s\S]{0,180}className="[^"]*hidden[^"]*sm:block[^"]*"/
  );
  assert.match(phase2, /className="[^"]*grid-cols-1[^"]*sm:grid-cols-3[^"]*"/);
  assert.match(phase2, /gap-4[^"]*sm:gap-x-20[^"]*sm:gap-y-12/);
  assert.equal(
    phase2.match(/workflow-node w-full max-w-36 cursor-pointer/g)?.length,
    4
  );
  assert.doesNotMatch(phase2, /workflow-node w-36 cursor-pointer/);
  assert.match(
    phase2,
    /Dynamic status helper[\s\S]{0,180}className="[^"]*relative[^"]*sm:absolute[^"]*"/
  );
  assert.match(
    phase2,
    /Dynamic status helper[\s\S]{0,320}<span className="[^"]*inline-block[^"]*max-w-full[^"]*whitespace-normal[^"]*"/
  );
  assert.match(phase2, /chapter-visual[^"]*flex-col[^"]*p-4[^"]*sm:p-8/);
});

test("launch slide keeps its content wrapper without sticky-tail layout", async () => {
  const source = await readFile(introPagePath, "utf8");
  const launchStart = source.indexOf('id="launch"');
  const launchEnd = source.indexOf("</section>", launchStart);
  const launch = source.slice(launchStart, launchEnd);

  assert.notEqual(launchStart, -1);
  assert.match(launch, /className="launch-content relative z-10 max-w-3xl"/);
  assert.match(launch, /Designed for Human Oversight/);
  assert.equal(
    launch.match(/https:\/\/medium\.com\/@jerry\.shao\//g)?.length,
    2
  );
  assert.doesNotMatch(launch, /sticky|lg:-mt-|data-scroll-reveal/);
});

test("phase navigation keeps semantic anchors and uses scoped scrolling", async () => {
  const source = await readFile(introPagePath, "utf8");

  assert.match(
    source,
    /import\s*\{\s*navigateToIntroPhase,\s*type IntroPhaseId,?\s*\}\s*from "\.\/phase-navigation";/
  );
  assert.match(
    source,
    /const handlePhaseNavigation = \(\s*event: React\.MouseEvent<HTMLAnchorElement>,\s*phaseId: IntroPhaseId\s*\) => \{\s*navigateToIntroPhase\(event, phaseId\);\s*\};/
  );
  for (const phaseId of ["phase1", "phase2", "phase3"]) {
    assert.match(source, new RegExp(`href="#${phaseId}"`));
    assert.match(
      source,
      new RegExp(
        `onClick=\\{\\(event\\) => handlePhaseNavigation\\(event, "${phaseId}"\\)\\}`
      )
    );
  }
  assert.doesNotMatch(source, /scroll-behavior\s*:\s*smooth/);
  assert.doesNotMatch(source, /addEventListener\("popstate"/);
});
