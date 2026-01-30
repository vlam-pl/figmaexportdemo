const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const tokensPath = path.join(repoRoot, 'tokens.json');
const reportDir = __dirname;
const reportPath = path.join(reportDir, 'ant-hardcoded-colors.json');

const userProfile = process.env.USERPROFILE || process.env.HOME || '';
const defaultAntCssPath = path.join(userProfile, '.nuget', 'packages', 'antdesign', '1.5.1', 'staticwebassets', 'css', 'ant-design-blazor.css');
const antCssPath = process.env.ANTDESIGN_CSS || defaultAntCssPath;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function normalizeHex(value) {
  const hex = value.trim().toLowerCase();
  if (!hex.startsWith('#')) {
    return null;
  }

  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }

  if (hex.length === 5) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}${hex[4]}${hex[4]}`;
  }

  if (hex.length === 7 || hex.length === 9) {
    return hex;
  }

  return null;
}

let tokensJson;
try {
  tokensJson = fs.readFileSync(tokensPath, 'utf8');
} catch (error) {
  fail(`Failed to read tokens.json: ${error.message}`);
}

let tokensData;
try {
  tokensData = JSON.parse(tokensJson);
} catch (error) {
  fail(`Failed to parse tokens.json: ${error.message}`);
}

const tokens = [];
const tokenByPath = new Map();

function collectTokens(node, pathSegments) {
  if (!node || typeof node !== 'object') {
    return;
  }

  if (Object.prototype.hasOwnProperty.call(node, 'value') &&
      Object.prototype.hasOwnProperty.call(node, 'type') &&
      node.type === 'color') {
    const token = { path: [...pathSegments], value: node.value };
    tokens.push(token);

    const fullPath = pathSegments.join('.');
    tokenByPath.set(fullPath, token);

    const colorsIndex = pathSegments.indexOf('Colors');
    if (colorsIndex !== -1) {
      const normalizedPath = pathSegments.slice(colorsIndex).join('.');
      tokenByPath.set(normalizedPath, token);
    }
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    collectTokens(value, pathSegments.concat(key));
  }
}

collectTokens(tokensData, []);

if (tokens.length === 0) {
  fail('No color tokens found in tokens.json.');
}

const referencePattern = /^\{(.+)\}$/;

function resolveValue(rawValue, stack = []) {
  if (typeof rawValue !== 'string') {
    return rawValue;
  }

  const match = rawValue.match(referencePattern);
  if (!match) {
    return rawValue;
  }

  const refPath = match[1];
  if (stack.includes(refPath)) {
    fail(`Circular reference detected: ${stack.join(' -> ')} -> ${refPath}`);
  }

  const token = tokenByPath.get(refPath);
  if (!token) {
    fail(`Unresolved reference: ${refPath}`);
  }

  return resolveValue(token.value, stack.concat(refPath));
}

const valueToTokens = new Map();
for (const token of tokens) {
  const resolvedValue = resolveValue(token.value);
  const normalized = normalizeHex(String(resolvedValue));
  if (!normalized) {
    continue;
  }

  if (!valueToTokens.has(normalized)) {
    valueToTokens.set(normalized, []);
  }
  valueToTokens.get(normalized).push(token.path.join('.'));
}

if (!fs.existsSync(antCssPath)) {
  fail(`AntDesign CSS not found at ${antCssPath}. Set ANTDESIGN_CSS to the file path.`);
}

let cssContent;
try {
  cssContent = fs.readFileSync(antCssPath, 'utf8');
} catch (error) {
  fail(`Failed to read AntDesign CSS: ${error.message}`);
}

const hexPattern = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const matches = cssContent.match(hexPattern) || [];

const colorCounts = new Map();
for (const raw of matches) {
  const normalized = normalizeHex(raw);
  if (!normalized) {
    continue;
  }
  colorCounts.set(normalized, (colorCounts.get(normalized) || 0) + 1);
}

const colorMatches = [];
const unmatched = [];

for (const [hex, count] of Array.from(colorCounts.entries()).sort()) {
  const tokensForValue = valueToTokens.get(hex) || [];
  if (tokensForValue.length) {
    colorMatches.push({ hex, count, tokens: tokensForValue });
  } else {
    unmatched.push({ hex, count });
  }
}

const report = {
  sourceCssPath: antCssPath,
  totalHardcodedColors: colorCounts.size,
  matchedCount: colorMatches.length,
  unmatchedCount: unmatched.length,
  colorMatches,
  unmatched
};

try {
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
} catch (error) {
  fail(`Failed to write report: ${error.message}`);
}

console.log(`Generated ${reportPath}`);
