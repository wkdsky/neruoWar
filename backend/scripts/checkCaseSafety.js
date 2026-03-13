const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const IGNORED_SEGMENTS = new Set([
  '.git',
  'node_modules'
]);
const IGNORED_PATH_PREFIXES = [
  'frontend/build'
];
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const IMPORT_PATTERN = /(?:import|export)\s+(?:[^'"]+?\s+from\s+)?['"](\.[^'"]+)['"]|require\(\s*['"](\.[^'"]+)['"]\s*\)/g;

const toRepoRelative = (targetPath) => path.relative(repoRoot, targetPath).split(path.sep).join('/');

const shouldIgnorePath = (targetPath) => {
  const relativePath = toRepoRelative(targetPath);
  if (!relativePath || relativePath === '.') return false;
  const pathSegments = relativePath.split('/').filter(Boolean);
  if (pathSegments.some((segment) => IGNORED_SEGMENTS.has(segment))) return true;
  return IGNORED_PATH_PREFIXES.some((entry) => (
    relativePath === entry || relativePath.startsWith(`${entry}/`)
  ));
};

const walkEntries = (targetDir, visitor) => {
  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  entries.forEach((entry) => {
    const fullPath = path.join(targetDir, entry.name);
    if (shouldIgnorePath(fullPath)) return;
    visitor(fullPath, entry);
    if (entry.isDirectory()) walkEntries(fullPath, visitor);
  });
};

const collectCaseCollisions = () => {
  const byLowerPath = new Map();
  walkEntries(repoRoot, (fullPath) => {
    const relativePath = toRepoRelative(fullPath);
    const lowerKey = relativePath.toLowerCase();
    if (!byLowerPath.has(lowerKey)) byLowerPath.set(lowerKey, []);
    byLowerPath.get(lowerKey).push(relativePath);
  });
  return Array.from(byLowerPath.values())
    .map((items) => Array.from(new Set(items)).sort())
    .filter((items) => items.length > 1);
};

const resolvePathWithExactCase = (targetPath) => {
  const normalizedTarget = path.resolve(targetPath);
  const parsed = path.parse(normalizedTarget);
  let currentPath = parsed.root;
  const remainder = normalizedTarget.slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean);

  for (const segment of remainder) {
    const directoryEntries = fs.readdirSync(currentPath, { withFileTypes: true });
    const exactMatch = directoryEntries.find((entry) => entry.name === segment);
    if (!exactMatch) return null;
    currentPath = path.join(currentPath, exactMatch.name);
  }
  return currentPath;
};

const resolveImportTarget = (sourceFilePath, importPath) => {
  const basePath = path.resolve(path.dirname(sourceFilePath), importPath);
  const candidatePaths = [
    basePath,
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.mjs`,
    `${basePath}.cjs`,
    path.join(basePath, 'index.js'),
    path.join(basePath, 'index.jsx'),
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx')
  ];
  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
};

const collectImportCaseMismatches = () => {
  const mismatches = [];
  walkEntries(repoRoot, (fullPath, entry) => {
    if (!entry.isFile()) return;
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) return;
    const sourceText = fs.readFileSync(fullPath, 'utf8');
    let match = null;
    while ((match = IMPORT_PATTERN.exec(sourceText)) !== null) {
      const importPath = match[1] || match[2];
      if (!importPath) continue;
      const resolvedImportTarget = resolveImportTarget(fullPath, importPath);
      if (!resolvedImportTarget) continue;

      const intendedBase = path.resolve(path.dirname(fullPath), importPath);
      const expectedExactBase = resolvePathWithExactCase(intendedBase);
      const exactResolvedTarget = resolvePathWithExactCase(resolvedImportTarget);
      if (!exactResolvedTarget) continue;

      if (expectedExactBase && expectedExactBase === intendedBase) continue;

      const importedRelative = toRepoRelative(intendedBase);
      const actualRelative = toRepoRelative(
        exactResolvedTarget.endsWith('/index.js')
        || exactResolvedTarget.endsWith('/index.jsx')
        || exactResolvedTarget.endsWith('/index.ts')
        || exactResolvedTarget.endsWith('/index.tsx')
          ? path.dirname(exactResolvedTarget)
          : exactResolvedTarget.replace(/\.(js|jsx|ts|tsx|mjs|cjs)$/i, '')
      );

      if (importedRelative.toLowerCase() === actualRelative.toLowerCase() && importedRelative !== actualRelative) {
        mismatches.push({
          source: toRepoRelative(fullPath),
          importPath,
          actual: toRepoRelative(exactResolvedTarget)
        });
      }
    }
    IMPORT_PATTERN.lastIndex = 0;
  });
  return mismatches;
};

const reportAndExit = () => {
  const collisions = collectCaseCollisions();
  const importMismatches = collectImportCaseMismatches();

  if (collisions.length === 0 && importMismatches.length === 0) {
    console.log('Case safety check passed: no case-only path collisions or import casing mismatches found.');
    process.exit(0);
  }

  if (collisions.length > 0) {
    console.error('Found case-only path collisions:');
    collisions.forEach((group) => {
      console.error(`- ${group.join(' | ')}`);
    });
  }

  if (importMismatches.length > 0) {
    console.error('Found relative import casing mismatches:');
    importMismatches.forEach((item) => {
      console.error(`- ${item.source}: "${item.importPath}" -> ${item.actual}`);
    });
  }

  process.exit(1);
};

reportAndExit();
