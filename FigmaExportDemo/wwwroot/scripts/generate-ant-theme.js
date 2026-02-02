const fs = require('fs');
const path = require('path');
const less = require('less');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const tokensPath = path.join(repoRoot, 'tokens.json');
const outputDir = path.join(repoRoot, 'FigmaExportDemo', 'wwwroot', 'css');
const customCssFile = path.join(outputDir, 'ant-design-blazor-custom.css');
const darkCssFile = path.join(outputDir, 'ant-design-blazor-dark.css');
const paletteFile = path.join(outputDir, 'figma-tokens.css');

const ANT_DESIGN_VERSION = process.env.ANT_DESIGN_VERSION || '1.5.1';
const userProfile = process.env.USERPROFILE || process.env.HOME || '';
const lessSourceDir = path.join(
  userProfile, '.nuget', 'packages', 'antdesign',
  ANT_DESIGN_VERSION, 'staticwebassets', 'less'
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(message) {
  console.error('ERROR:', message);
  process.exit(1);
}

function toKebab(input) {
  return String(input)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function isNumeric(value) {
  return /^\d+$/.test(String(value));
}

// ---------------------------------------------------------------------------
// Phase A: Token Loading (reused from generate-ant-css.js)
// ---------------------------------------------------------------------------

let tokensData;
try {
  tokensData = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
} catch (error) {
  fail(`Failed to read/parse tokens.json: ${error.message}`);
}

const tokens = [];
const tokenByPath = new Map();

function collectTokens(node, pathSegments) {
  if (!node || typeof node !== 'object') return;

  if (Object.prototype.hasOwnProperty.call(node, 'value') &&
      Object.prototype.hasOwnProperty.call(node, 'type')) {
    const token = { path: [...pathSegments], value: node.value, type: node.type };
    tokens.push(token);

    const fullPath = pathSegments.join('.');
    tokenByPath.set(fullPath, token);

    if (pathSegments.length > 1) {
      tokenByPath.set(pathSegments.slice(1).join('.'), token);
    }

    const colorsIndex = pathSegments.indexOf('Colors');
    if (colorsIndex !== -1) {
      tokenByPath.set(pathSegments.slice(colorsIndex).join('.'), token);
    }
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    collectTokens(value, pathSegments.concat(key));
  }
}

collectTokens(tokensData, []);
if (tokens.length === 0) fail('No tokens found in tokens.json.');

const referencePattern = /^\{(.+)\}$/;

function resolveValue(rawValue, stack = []) {
  if (typeof rawValue !== 'string') return rawValue;
  const match = rawValue.match(referencePattern);
  if (!match) return rawValue;

  const refPath = match[1];
  if (stack.includes(refPath)) fail(`Circular reference: ${stack.join(' -> ')} -> ${refPath}`);

  const token = tokenByPath.get(refPath);
  if (!token) fail(`Unresolved reference: ${refPath}`);

  return resolveValue(token.value, stack.concat(refPath));
}

function lookupResolved(tokenPath) {
  const token = tokenByPath.get(tokenPath);
  if (!token) return null;
  return resolveValue(token.value);
}

// ---------------------------------------------------------------------------
// Phase B: Figma-to-Less Mapping
// ---------------------------------------------------------------------------

// Transforms applied to resolved token values before passing to modifyVars
const transforms = {
  stripPx(value) {
    return String(value).replace(/px$/, '');
  },
  fontFamily(value) {
    // Ensure proper CSS font-family syntax with fallback
    const name = String(value).trim();
    if (!name.includes(',')) {
      return `'${name}', sans-serif`;
    }
    return name;
  },
  fontFamilyCode(value) {
    const name = String(value).trim();
    if (!name.includes(',')) {
      return `'${name}', monospace`;
    }
    return name;
  },
  lineHeightRatio(value) {
    // Convert pixel line-height to unitless ratio using font-size-base
    const px = parseFloat(String(value));
    const fontSizeToken = lookupResolved('Typography.Font Size.fontSize');
    const fontSize = fontSizeToken ? parseFloat(fontSizeToken) : 14;
    if (isNaN(px) || isNaN(fontSize) || fontSize === 0) return String(value);
    return (px / fontSize).toFixed(4);
  }
};

// Map from Figma token path (normalized, without top-level set name) to Less variable
// Format: { tokenPath, lessVar, transform? }
const FIGMA_TO_LESS = [
  // --- Semantic Colors (override base palette vars used in html{} block) ---
  { tokenPath: 'Colors.Semantic.Primary.colorPrimary',    lessVar: 'blue-6' },
  { tokenPath: 'Colors.Semantic.Success.colorSuccess',    lessVar: 'green-6' },
  { tokenPath: 'Colors.Semantic.Error.colorError',        lessVar: 'red-5' },
  { tokenPath: 'Colors.Semantic.Warning.colorWarning',    lessVar: 'gold-6' },

  // --- Neutral Colors (literal Less vars, not wrapped in var()) ---
  { tokenPath: 'Colors.Neutral.Text.colorText',           lessVar: 'text-color' },
  { tokenPath: 'Colors.Neutral.Text.colorTextSecondary',  lessVar: 'text-color-secondary' },
  { tokenPath: 'Colors.Neutral.Bg.colorBgContainer',      lessVar: 'component-background' },
  { tokenPath: 'Colors.Neutral.Bg.colorBgLayout',         lessVar: 'layout-body-background' },
  { tokenPath: 'Colors.Neutral.Border.colorBorder',       lessVar: 'border-color-base' },
  { tokenPath: 'Colors.Neutral.Text.colorText',           lessVar: 'heading-color' },

  // --- Typography ---
  { tokenPath: 'Typography.Font Family.fontFamily',     lessVar: 'font-family',     transform: 'fontFamily' },
  { tokenPath: 'Typography.Font Family.fontFamilyCode', lessVar: 'code-family',     transform: 'fontFamilyCode' },
  { tokenPath: 'Typography.Font Size.fontSize',         lessVar: 'font-size-base' },
  { tokenPath: 'Typography.Font Size.fontSizeLG',       lessVar: 'font-size-lg' },
  { tokenPath: 'Typography.Font Size.fontSizeSM',       lessVar: 'font-size-sm' },
  { tokenPath: 'Typography.Font Size.fontSizeHeading1', lessVar: 'heading-1-size' },
  { tokenPath: 'Typography.Font Size.fontSizeHeading2', lessVar: 'heading-2-size' },
  { tokenPath: 'Typography.Font Size.fontSizeHeading3', lessVar: 'heading-3-size' },
  { tokenPath: 'Typography.Font Weight.fontWeightStrong', lessVar: 'typography-title-font-weight', transform: 'stripPx' },
  { tokenPath: 'Typography.Line Height.lineHeight',     lessVar: 'line-height-base', transform: 'lineHeightRatio' },

  // --- Border Radius ---
  { tokenPath: 'Border Radius.borderRadius',   lessVar: 'border-radius-base' },
  { tokenPath: 'Border Radius.borderRadiusSM', lessVar: 'border-radius-sm' },

  // --- Padding ---
  { tokenPath: 'Space.Padding.paddingLG',  lessVar: 'padding-lg' },
  { tokenPath: 'Space.Padding.padding',    lessVar: 'padding-md' },
  { tokenPath: 'Space.Padding.paddingSM',  lessVar: 'padding-sm' },
  { tokenPath: 'Space.Padding.paddingXS',  lessVar: 'padding-xs' },
  { tokenPath: 'Space.Padding.paddingXXS', lessVar: 'padding-xss' },

  // --- Margin ---
  { tokenPath: 'Space.Margin.marginLG',  lessVar: 'margin-lg' },
  { tokenPath: 'Space.Margin.marginMD',  lessVar: 'margin-md' },
  { tokenPath: 'Space.Margin.marginSM',  lessVar: 'margin-sm' },
  { tokenPath: 'Space.Margin.marginXS',  lessVar: 'margin-xs' },
  { tokenPath: 'Space.Margin.marginXXS', lessVar: 'margin-xss' },

  // --- Control Heights ---
  { tokenPath: 'Size.Height.controlHeight',   lessVar: 'height-base' },
  { tokenPath: 'Size.Height.controlHeightLG', lessVar: 'height-lg' },
  { tokenPath: 'Size.Height.controlHeightSM', lessVar: 'height-sm' },

  // --- Line Width ---
  { tokenPath: 'Size.Line Width.lineWidth', lessVar: 'border-width-base' },
];

// ---------------------------------------------------------------------------
// Dark Theme: Neutral color overrides for Less compilation
// ---------------------------------------------------------------------------

// Default dark-mode neutral overrides (used when tokens.json has no "Colors/Dark" set).
// These follow the standard Ant Design dark theme pattern.
const DARK_NEUTRAL_OVERRIDES = {
  'body-background':          '#141414',
  'component-background':     '#1f1f1f',
  'popover-background':       '#1f1f1f',
  'text-color':               'rgba(255, 255, 255, 0.85)',
  'text-color-secondary':     'rgba(255, 255, 255, 0.65)',
  'text-color-inverse':       'rgba(0, 0, 0, 0.85)',
  'heading-color':            'rgba(255, 255, 255, 0.85)',
  'border-color-base':        '#434343',
  'border-color-split':       '#303030',
  'background-color-light':   'rgba(255, 255, 255, 0.04)',
  'background-color-base':    'rgba(255, 255, 255, 0.04)',
  'item-hover-bg':            'rgba(255, 255, 255, 0.04)',
  'item-active-bg':           'rgba(255, 255, 255, 0.08)',
  'disabled-color':           'rgba(255, 255, 255, 0.30)',
  'disabled-bg':              'rgba(255, 255, 255, 0.08)',
  'layout-body-background':   '#141414',
  'layout-header-background': '#1f1f1f',
  'layout-sider-background':  '#1f1f1f',
  'table-header-bg':          '#1d1d1d',
  'table-body-sort-bg':       'rgba(255, 255, 255, 0.04)',
  'table-row-hover-bg':       'rgba(255, 255, 255, 0.04)',
  'table-expanded-row-bg':    '#1d1d1d',
  'input-bg':                 'transparent',
  'select-background':        'transparent',
  'shadow-color':             'rgba(0, 0, 0, 0.45)',
  'skeleton-color':           'rgba(255, 255, 255, 0.08)',
};

/**
 * Detect additional color sets in tokens.json beyond the default "Colors/Light".
 * Returns an array of { name, setKey } for each extra color set found.
 * Example: "1. Colors/Dark" → { name: 'dark', setKey: '1. Colors/Dark' }
 */
function detectColorSets() {
  const colorSetPattern = /^\d+\.\s*Colors\/(.+)$/;
  const sets = [];

  for (const key of Object.keys(tokensData)) {
    const match = key.match(colorSetPattern);
    if (!match) continue;
    const themeName = match[1].toLowerCase();
    if (themeName === 'light') continue; // skip the default
    sets.push({ name: themeName, setKey: key });
  }

  return sets;
}

/**
 * Build dark-mode modifyVars by starting with the light base and overlaying
 * dark neutral overrides. If a "Colors/Dark" set exists in tokens.json,
 * its semantic color values are used; otherwise the light semantic colors
 * are preserved (they work well on dark backgrounds).
 */
function buildDarkModifyVars(lightModifyVars, darkColorSet) {
  const darkVars = { ...lightModifyVars };

  // If tokens.json has a dark color set, rebuild semantic color mappings from it
  if (darkColorSet) {
    const darkTokenByPath = new Map();
    const darkTokens = [];

    collectTokensInto(tokensData[darkColorSet.setKey], [], darkTokens, darkTokenByPath);

    // Re-resolve semantic color mappings from the dark set
    const colorMappings = FIGMA_TO_LESS.filter(e =>
      e.tokenPath.startsWith('Colors.Semantic.') || e.tokenPath.startsWith('Colors.Neutral.')
    );

    for (const entry of colorMappings) {
      const token = darkTokenByPath.get(entry.tokenPath);
      if (!token) continue;
      let value = resolveValueFrom(token.value, darkTokenByPath);
      if (entry.transform && transforms[entry.transform]) {
        value = transforms[entry.transform](value);
      }
      darkVars[entry.lessVar] = value;
    }
  }

  // Overlay dark neutral overrides (these always apply for dark mode)
  Object.assign(darkVars, DARK_NEUTRAL_OVERRIDES);

  return darkVars;
}

/**
 * collectTokens variant that populates external arrays/maps (for dark set parsing).
 */
function collectTokensInto(node, pathSegments, tokensArr, pathMap) {
  if (!node || typeof node !== 'object') return;

  if (Object.prototype.hasOwnProperty.call(node, 'value') &&
      Object.prototype.hasOwnProperty.call(node, 'type')) {
    const token = { path: [...pathSegments], value: node.value, type: node.type };
    tokensArr.push(token);

    const fullPath = pathSegments.join('.');
    pathMap.set(fullPath, token);

    if (pathSegments.length > 1) {
      pathMap.set(pathSegments.slice(1).join('.'), token);
    }

    const colorsIndex = pathSegments.indexOf('Colors');
    if (colorsIndex !== -1) {
      pathMap.set(pathSegments.slice(colorsIndex).join('.'), token);
    }
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    collectTokensInto(value, pathSegments.concat(key), tokensArr, pathMap);
  }
}

/**
 * Resolve references using a specific token map (for dark set resolution).
 * Falls back to the main tokenByPath if not found in the provided map.
 */
function resolveValueFrom(rawValue, pathMap, stack = []) {
  if (typeof rawValue !== 'string') return rawValue;
  const match = rawValue.match(referencePattern);
  if (!match) return rawValue;

  const refPath = match[1];
  if (stack.includes(refPath)) fail(`Circular reference: ${stack.join(' -> ')} -> ${refPath}`);

  // Try dark set first, fall back to main token map
  const token = pathMap.get(refPath) || tokenByPath.get(refPath);
  if (!token) fail(`Unresolved reference: ${refPath}`);

  return resolveValueFrom(token.value, pathMap, stack.concat(refPath));
}

function buildModifyVars() {
  const modifyVars = {};
  const mapped = [];
  const unmapped = [];

  for (const entry of FIGMA_TO_LESS) {
    const resolved = lookupResolved(entry.tokenPath);
    if (resolved === null) {
      unmapped.push(entry.tokenPath);
      continue;
    }

    let value = resolved;
    if (entry.transform && transforms[entry.transform]) {
      value = transforms[entry.transform](value);
    }

    modifyVars[entry.lessVar] = value;
    mapped.push({ tokenPath: entry.tokenPath, lessVar: entry.lessVar, value });
  }

  return { modifyVars, mapped, unmapped };
}

// ---------------------------------------------------------------------------
// Phase C: Less Compilation
// ---------------------------------------------------------------------------

async function compileLess(modifyVars) {
  const entryFile = path.join(lessSourceDir, 'ant-design-blazor.variable.less');

  if (!fs.existsSync(entryFile)) {
    fail(
      `Ant Design Less source not found at: ${entryFile}\n` +
      `Ensure AntDesign ${ANT_DESIGN_VERSION} NuGet package is restored.\n` +
      `Run: dotnet restore`
    );
  }

  const lessSource = fs.readFileSync(entryFile, 'utf8');

  // Use forward slashes for Less path resolution (even on Windows)
  const lessPaths = [
    lessSourceDir.replace(/\\/g, '/'),
    path.join(lessSourceDir, 'style').replace(/\\/g, '/'),
  ];

  const result = await less.render(lessSource, {
    paths: lessPaths,
    filename: entryFile.replace(/\\/g, '/'),
    javascriptEnabled: true,
    modifyVars: modifyVars,
    math: 'always',
  });

  return result.css;
}

// ---------------------------------------------------------------------------
// Phase D: Palette CSS Generation (preserved for non-Ant usage)
// ---------------------------------------------------------------------------

function buildPaletteCss() {
  const paletteVars = new Map();

  for (const token of tokens) {
    const colorsIndex = token.path.indexOf('Colors');
    if (colorsIndex === -1) continue;

    const afterColors = token.path.slice(colorsIndex + 1);
    if (afterColors[0] !== 'Base' || afterColors.length < 3) continue;

    const lastSegment = token.path[token.path.length - 1];
    if (!isNumeric(lastSegment)) continue;
    if (token.type !== 'color') continue;

    const paletteName = afterColors[1];
    const shade = lastSegment;
    const varName = `--ant-${toKebab(paletteName)}-${shade}`;
    const resolved = resolveValue(token.value);
    paletteVars.set(varName, resolved);
  }

  const lines = ['/* Generated by scripts/generate-ant-theme.js (palette) */'];
  lines.push(':root {');

  const entries = Array.from(paletteVars.entries()).sort(([a], [b]) => a.localeCompare(b));
  for (const [name, value] of entries) {
    lines.push(`  ${name}: ${value};`);
  }

  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('[generate-ant-theme] Starting...');
  console.log(`  Tokens: ${tokensPath}`);
  console.log(`  Less source: ${lessSourceDir}`);
  console.log(`  Output: ${outputDir}`);
  console.log('');

  // Build modifyVars from Figma tokens
  const { modifyVars, mapped, unmapped } = buildModifyVars();

  console.log(`[Mapping] ${mapped.length} tokens mapped to Less variables:`);
  for (const m of mapped) {
    console.log(`  @${m.lessVar}: ${m.value}  (from ${m.tokenPath})`);
  }
  if (unmapped.length > 0) {
    console.log(`\n[Warning] ${unmapped.length} tokens not found in tokens.json:`);
    for (const u of unmapped) {
      console.log(`  - ${u}`);
    }
  }
  console.log('');

  // Compile Less
  console.log('[Less] Compiling ant-design-blazor.variable.less...');
  const css = await compileLess(modifyVars);

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(customCssFile, css, 'utf8');
  console.log(`[Less] Written ${customCssFile} (${css.length} bytes, ${css.split('\n').length} lines)`);

  // Compile dark theme
  const darkColorSets = detectColorSets();
  const darkSet = darkColorSets.find(s => s.name === 'dark') || null;

  if (darkSet) {
    console.log(`[Dark] Found dark color set: "${darkSet.setKey}"`);
  } else {
    console.log('[Dark] No "Colors/Dark" set in tokens.json — using default dark neutrals.');
  }

  const darkModifyVars = buildDarkModifyVars(modifyVars, darkSet);
  console.log('[Dark] Compiling dark variant...');
  const darkCss = await compileLess(darkModifyVars);

  fs.writeFileSync(darkCssFile, darkCss, 'utf8');
  console.log(`[Dark] Written ${darkCssFile} (${darkCss.length} bytes, ${darkCss.split('\n').length} lines)`);

  // Generate palette CSS
  const paletteCss = buildPaletteCss();
  fs.writeFileSync(paletteFile, paletteCss, 'utf8');
  console.log(`[Palette] Written ${paletteFile}`);

  console.log('\n[Done] Theme generation complete.');
}

main().catch(err => {
  fail(err.message || err);
});
