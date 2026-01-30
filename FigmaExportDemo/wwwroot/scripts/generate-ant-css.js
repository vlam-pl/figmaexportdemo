const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const tokensPath = path.join(repoRoot, 'tokens.json');
const outputDir = path.join(repoRoot, 'FigmaExportDemo', 'wwwroot', 'css');
const paletteFile = path.join(outputDir, 'figma-tokens.css');
const overridesFile = path.join(outputDir, 'ant-theme-overrides.css');

function fail(message) {
  console.error(message);
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
      Object.prototype.hasOwnProperty.call(node, 'type')) {
    const token = { path: [...pathSegments], value: node.value, type: node.type };
    tokens.push(token);

    const fullPath = pathSegments.join('.');
    tokenByPath.set(fullPath, token);
    if (pathSegments.length > 1) {
      const normalizedPath = pathSegments.slice(1).join('.');
      tokenByPath.set(normalizedPath, token);
    }

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
  fail('No tokens found in tokens.json.');
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

function getVariableDescriptor(pathSegments, tokenType) {
  const lastSegment = pathSegments[pathSegments.length - 1];
  const colorsIndex = pathSegments.indexOf('Colors');

  if (colorsIndex !== -1) {
    const afterColors = pathSegments.slice(colorsIndex + 1);

    if (tokenType === 'color' && afterColors[0] === 'Base' && afterColors.length >= 3 && isNumeric(lastSegment)) {
      const paletteName = afterColors[1];
      return { name: `--ant-${toKebab(paletteName)}-${lastSegment}`, bucket: 'palette' };
    }

    if (tokenType === 'color' && afterColors[0] === 'Gradient' && (lastSegment === 'From' || lastSegment === 'To')) {
      const gradientNameParts = afterColors.slice(1, -1).map(toKebab).filter(Boolean);
      const gradientName = gradientNameParts.join('-') || 'default';
      return { name: `--ant-gradient-${gradientName}-${toKebab(lastSegment)}`, bucket: 'overrides' };
    }
  }

  if (isNumeric(lastSegment)) {
    return null;
  }

  const componentsIndex = pathSegments.indexOf('Components');
  if (componentsIndex !== -1 && pathSegments.length > componentsIndex + 1) {
    const componentName = pathSegments[componentsIndex + 1];
    const tokenKey = String(lastSegment);
    const startsWithComponent = tokenKey.toLowerCase().startsWith(componentName.toLowerCase());
    const combinedName = startsWithComponent
      ? tokenKey
      : `${componentName}${tokenKey.charAt(0).toUpperCase()}${tokenKey.slice(1)}`;

    return {
      name: `--ant-${toKebab(combinedName)}`,
      bucket: 'overrides',
      componentName,
      tokenKey
    };
  }

  return { name: `--ant-${toKebab(lastSegment)}`, bucket: 'overrides' };
}

function addVariable(targetMap, name, value, sourcePath) {
  if (targetMap.has(name) && targetMap.get(name) !== value) {
    console.warn(`Warning: duplicate variable ${name} from ${sourcePath.join('.')} overwrote previous value.`);
  }
  targetMap.set(name, value);
}

const paletteVariables = new Map();
const overrideVariables = new Map();
const componentTokenEntries = [];

for (const token of tokens) {
  const resolvedValue = resolveValue(token.value);
  const descriptor = getVariableDescriptor(token.path, token.type);

  if (!descriptor || !descriptor.name.startsWith('--ant-')) {
    continue;
  }

  if (descriptor.bucket === 'palette') {
    addVariable(paletteVariables, descriptor.name, resolvedValue, token.path);
  } else {
    addVariable(overrideVariables, descriptor.name, resolvedValue, token.path);
    if (descriptor.componentName && descriptor.tokenKey) {
      componentTokenEntries.push({
        componentName: descriptor.componentName,
        tokenKey: descriptor.tokenKey,
        variableName: descriptor.name,
        tokenType: token.type
      });
    }
  }
}

function buildCssContent(variables, headerLabel, extraBlocks = []) {
  const lines = [];
  lines.push(`/* Generated by scripts/generate-ant-css.js (${headerLabel}) */`);
  lines.push(':root {');

  const entries = Array.from(variables.entries()).sort(([a], [b]) => a.localeCompare(b));
  for (const [name, value] of entries) {
    lines.push(`  ${name}: ${value};`);
  }

  lines.push('}');

  for (const block of extraBlocks) {
    if (block && block.trim().length) {
      lines.push('');
      lines.push(block.trim());
    }
  }

  lines.push('');
  return lines.join('\n');
}

function inferProperty(tokenKey, tokenType) {
  const key = tokenKey.toLowerCase();
  const type = String(tokenType || '').toLowerCase();

  if (type === 'color') {
    if (key.includes('bg') || key.includes('background')) {
      return 'background-color';
    }
    if (key.includes('border')) {
      return 'border-color';
    }
    if (key.includes('text') || key.includes('color') || key.includes('icon')) {
      return 'color';
    }
    return null;
  }

  if (type === 'text') {
    if (key.includes('fontfamily')) {
      return 'font-family';
    }
    return null;
  }

  if (type === 'dimension' || type === 'number') {
    if (key.includes('paddinginline')) {
      return 'padding-inline';
    }
    if (key.includes('paddingblock')) {
      return 'padding-block';
    }
    if (key.includes('padding')) {
      return 'padding';
    }
    if (key.includes('margin')) {
      return 'margin';
    }
    if (key.includes('outline')) {
      return 'outline-width';
    }
    if (key.includes('border') && key.includes('radius')) {
      return 'border-radius';
    }
    if (key.includes('radius')) {
      return 'border-radius';
    }
    if (key.includes('linewidth') || key.includes('borderwidth')) {
      return 'border-width';
    }
    if (key.includes('fontweight')) {
      return 'font-weight';
    }
    if (key.includes('fontsize')) {
      return 'font-size';
    }
    if (key.includes('lineheight')) {
      return 'line-height';
    }
    if (key.includes('height')) {
      return 'height';
    }
    if (key.includes('width')) {
      return 'width';
    }
    if (key.includes('gap')) {
      return 'gap';
    }
    if (key.includes('size')) {
      return 'font-size';
    }
  }

  if (type === 'opacity') {
    return 'opacity';
  }

  return null;
}

function inferSelector(componentName, tokenKey) {
  const componentClass = `.ant-${toKebab(componentName)}`;
  const key = tokenKey.toLowerCase();

  const subSelectors = [
    { match: 'header', suffix: 'header' },
    { match: 'footer', suffix: 'footer' },
    { match: 'content', suffix: 'content' },
    { match: 'body', suffix: 'body' },
    { match: 'item', suffix: 'item' },
    { match: 'track', suffix: 'track' },
    { match: 'tab', suffix: 'tab' },
    { match: 'panel', suffix: 'panel' }
  ];

  for (const entry of subSelectors) {
    if (key.includes(entry.match)) {
      return `${componentClass}-${entry.suffix}`;
    }
  }

  return componentClass;
}

function buildComponentOverrides(tokens) {
  if (!tokens.length) {
    return '';
  }

  const rules = new Map();

  for (const token of tokens) {
    const property = inferProperty(token.tokenKey, token.tokenType);
    if (!property) {
      continue;
    }

    const selector = inferSelector(token.componentName, token.tokenKey);
    if (!rules.has(selector)) {
      rules.set(selector, new Map());
    }

    rules.get(selector).set(property, `var(${token.variableName})`);
  }

  const lines = ['/* Generated component overrides */'];
  const selectors = Array.from(rules.keys()).sort();

  for (const selector of selectors) {
    const properties = rules.get(selector);
    lines.push(`${selector} {`);
    for (const [property, value] of Array.from(properties.entries()).sort()) {
      lines.push(`  ${property}: ${value} !important;`);
    }
    lines.push('}');
    lines.push('');
  }

  return lines.join('\n').trim();
}

function buildTagPresetOverrides(paletteMap) {
  const presetMap = {
    blue: 'seablue',
    cyan: 'aquamarine',
    green: 'green',
    red: 'red',
    orange: 'orange',
    purple: 'purple',
    pink: 'pink',
    yellow: 'yellow'
  };

  const lines = ['/* Generated tag preset overrides */'];
  let hasAny = false;

  for (const [preset, palette] of Object.entries(presetMap)) {
    const shade1 = `--ant-${palette}-1`;
    const shade3 = `--ant-${palette}-3`;
    const shade7 = `--ant-${palette}-7`;

    if (!(paletteMap.has(shade1) && paletteMap.has(shade3) && paletteMap.has(shade7))) {
      continue;
    }

    hasAny = true;
    lines.push(`.ant-tag-${preset} {`);
    lines.push(`  color: var(${shade7}) !important;`);
    lines.push(`  background-color: var(${shade1}) !important;`);
    lines.push(`  border-color: var(${shade3}) !important;`);
    lines.push('}');
    lines.push('');
  }

  return hasAny ? lines.join('\n').trim() : '';
}

try {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(paletteFile, buildCssContent(paletteVariables, 'palette'), 'utf8');
  const componentOverrides = buildComponentOverrides(componentTokenEntries);
  const tagPresetOverrides = buildTagPresetOverrides(paletteVariables);
  fs.writeFileSync(
    overridesFile,
    buildCssContent(overrideVariables, 'overrides', [componentOverrides, tagPresetOverrides]),
    'utf8'
  );
} catch (error) {
  fail(`Failed to write CSS files: ${error.message}`);
}

console.log(`Generated ${paletteFile}`);
console.log(`Generated ${overridesFile}`);
