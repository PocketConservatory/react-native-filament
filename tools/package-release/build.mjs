import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

const toolDirectory = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(toolDirectory, '../..')
const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'allow-dirty': { type: 'boolean', default: false },
    'android-engine': { type: 'string' },
    'ios-engine': { type: 'string' },
  },
})
if (!options['android-engine'] || !options['ios-engine']) {
  throw new Error('Pass --android-engine and --ios-engine: the filament/ trees built by tools/filament-engine/build.py')
}
const engines = { android: path.resolve(options['android-engine']), ios: path.resolve(options['ios-engine']) }
const output = path.resolve(positionals[0] ?? path.join(tmpdir(), 'tonic-filament-release'))
const upstreamUrl = 'https://registry.npmjs.org/react-native-filament/-/react-native-filament-1.11.0.tgz'
const upstreamIntegrity = 'sha512-O4R5EDpdLIW5szhZTWAHbCWAonER8pOgIT0EnrXO8wWvnWg1wmQSDRXNmM5Apg9TYPTsURvjLGhciEVTaWAoTA=='
const engineCommit = 'd852e34cd5629a6f3851d613dcd17aa0ffd025a2'
const engineMaterialVersion = 77
const temporary = await mkdtemp(path.join(tmpdir(), 'tonic-filament-package-'))
const staging = path.join(temporary, 'package')
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
const sha256 = data => createHash('sha256').update(data).digest('hex')
const commit = run('git', ['rev-parse', 'HEAD']).trim()
const dirty = run('git', ['status', '--porcelain', '--untracked-files=normal']).trim().length > 0
if (dirty && !options['allow-dirty']) throw new Error('Commit source changes before packaging; use --allow-dirty only for local review')

async function manifest(directory, relative) {
  const files = {}
  async function visit(name) {
    for (const entry of await readdir(path.join(directory, name), { withFileTypes: true })) {
      const filename = name ? `${name}/${entry.name}` : entry.name
      if (entry.isDirectory()) await visit(filename)
      else files[filename] = sha256(await readFile(path.join(directory, filename)))
    }
  }
  await visit(relative)
  return Object.fromEntries(Object.entries(files).sort())
}
const nativeManifest = async directory => JSON.stringify({ ...await manifest(directory, 'android/libs'), ...await manifest(directory, 'ios/libs') })

// An engine tree must be exactly what its tonic-engine.json describes, built from the pinned
// commit with the tracked Animator patch, and its headers must be the tracked headers.
async function verifyEngine(platform) {
  const engine = engines[platform]
  const record = JSON.parse(await readFile(path.join(engine, 'tonic-engine.json'), 'utf8'))
  const patch = sha256(await readFile(path.join(root, 'package/filament_animator_feat.patch')))
  if (record.platform !== platform || record.commit !== engineCommit || record.materialVersion !== engineMaterialVersion || record.animatorPatchSha256 !== patch) {
    throw new Error(`${platform} engine was not built from Filament ${engineCommit} with the tracked Animator patch`)
  }
  const actual = await manifest(engine, '')
  delete actual['tonic-engine.json']
  const recorded = Object.fromEntries(Object.entries(record.files).sort())
  if (JSON.stringify(actual) !== JSON.stringify(recorded)) throw new Error(`${platform} engine files differ from its tonic-engine.json`)
  const tracked = await manifest(path.join(root, 'package', platform, 'libs/filament'), 'include')
  const built = Object.fromEntries(Object.entries(actual).filter(([filename]) => filename.startsWith('include/')))
  if (JSON.stringify(tracked) !== JSON.stringify(built)) throw new Error(`Tracked ${platform} headers differ from the ${platform} engine build`)
  const { files, ...summary } = record
  return { ...summary, recordSha256: sha256(await readFile(path.join(engine, 'tonic-engine.json'))), fileCount: Object.keys(files).length }
}

try {
  const engineProvenance = { android: await verifyEngine('android'), ios: await verifyEngine('ios') }
  await mkdir(output, { recursive: true })
  const response = await fetch(upstreamUrl)
  if (!response.ok) throw new Error(`Upstream download failed: ${response.status}`)
  const archive = Buffer.from(await response.arrayBuffer())
  const actualIntegrity = `sha512-${createHash('sha512').update(archive).digest('base64')}`
  if (actualIntegrity !== upstreamIntegrity) throw new Error('Upstream tarball integrity mismatch')
  const upstreamArchive = path.join(temporary, 'upstream.tgz')
  await writeFile(upstreamArchive, archive)
  run('tar', ['-xzf', upstreamArchive, '-C', temporary])
  const upstreamBullet = JSON.stringify({ ...await manifest(staging, 'android/libs/bullet3'), ...await manifest(staging, 'ios/libs/bullet3') })

  // Replace upstream's bundled Filament with the verified engines, then overlay tracked fork files.
  for (const platform of ['android', 'ios']) {
    await rm(path.join(staging, platform, 'libs/filament'), { recursive: true, force: true })
    await cp(path.join(engines[platform], 'lib'), path.join(staging, platform, 'libs/filament/lib'), { recursive: true })
    await cp(path.join(engines[platform], 'tonic-engine.json'), path.join(staging, platform, 'libs/filament/tonic-engine.json'))
  }
  const tracked = run('git', ['ls-files', '-z', '--', 'package']).split('\0').filter(Boolean)
  for (const filename of tracked) {
    await cp(path.join(root, filename), path.join(temporary, filename), { force: true, recursive: true })
  }
  const bullet = JSON.stringify({ ...await manifest(staging, 'android/libs/bullet3'), ...await manifest(staging, 'ios/libs/bullet3') })
  if (bullet !== upstreamBullet) throw new Error('Fork overlay changed bundled upstream bullet3 libraries')
  for (const platform of ['android', 'ios']) {
    const staged = await manifest(path.join(staging, platform, 'libs/filament'), '')
    const engine = await manifest(engines[platform], '')
    for (const [filename, digest] of Object.entries(engine)) {
      if (staged[filename] !== digest) throw new Error(`Staged ${platform} engine file differs: ${filename}`)
    }
  }
  const expectedNativeManifest = await nativeManifest(staging)

  await cp(path.join(root, 'README.md'), path.join(staging, 'README.md'))
  await cp(path.join(root, 'LICENSE'), path.join(staging, 'LICENSE'))
  await rm(path.join(staging, 'lib'), { recursive: true, force: true })
  console.log(run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], toolDirectory).trim())
  await symlink(path.join(toolDirectory, 'node_modules'), path.join(staging, 'node_modules'), 'dir')
  console.log(run(path.join(toolDirectory, 'node_modules/.bin/bob'), ['build'], staging).trim())
  await rm(path.join(staging, 'node_modules'))

  await writeFile(path.join(staging, 'TONIC-PROVENANCE.json'), JSON.stringify({
    upstream: { version: '1.11.0', url: upstreamUrl, integrity: upstreamIntegrity },
    fork: { repository: 'https://github.com/PocketConservatory/react-native-filament', commit, dirty },
    nativeBinaries: {
      bullet3: 'Unmodified files from the verified upstream npm tarball',
      filament: engineProvenance,
    },
  }, null, 2) + '\n')
  const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', output], staging))[0]
  const artifact = path.join(output, packed.filename)
  const verification = path.join(temporary, 'verification')
  await mkdir(verification)
  run('tar', ['-xzf', artifact, '-C', verification])
  const unpacked = path.join(verification, 'package')
  if (await nativeManifest(unpacked) !== expectedNativeManifest) throw new Error('Packed native libraries/headers differ from the verified engines')
  const packageManifest = JSON.parse(await readFile(path.join(unpacked, 'package.json'), 'utf8'))
  for (const filename of [packageManifest.main + '.js', packageManifest.module + '.js', packageManifest.types, packageManifest['react-native'] + '.tsx', packageManifest.codegenConfig.jsSrcsDir, 'LICENSE', 'README.md', 'assets']) {
    await access(path.join(unpacked, filename))
  }
  const digest = sha256(await readFile(artifact))
  await writeFile(`${artifact}.sha256`, `${digest}  ${packed.filename}\n`)
  console.log(JSON.stringify({ artifact, sha256: digest, commit, dirty, size: packed.size, unpackedSize: packed.unpackedSize, verifiedNativeFiles: Object.keys(JSON.parse(expectedNativeManifest)).length }, null, 2))
} finally {
  await rm(temporary, { recursive: true, force: true })
}
