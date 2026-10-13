import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const toolDirectory = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(toolDirectory, '../..')
const output = path.resolve(process.argv.slice(2).find(argument => argument !== '--allow-dirty') ?? path.join(tmpdir(), 'tonic-filament-release'))
const upstreamUrl = 'https://registry.npmjs.org/react-native-filament/-/react-native-filament-1.11.0.tgz'
const upstreamIntegrity = 'sha512-O4R5EDpdLIW5szhZTWAHbCWAonER8pOgIT0EnrXO8wWvnWg1wmQSDRXNmM5Apg9TYPTsURvjLGhciEVTaWAoTA=='
const temporary = await mkdtemp(path.join(tmpdir(), 'tonic-filament-package-'))
const staging = path.join(temporary, 'package')
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
const commit = run('git', ['rev-parse', 'HEAD']).trim()
const dirty = run('git', ['status', '--porcelain', '--untracked-files=normal']).trim().length > 0
if (dirty && !process.argv.includes('--allow-dirty')) throw new Error('Commit source changes before packaging; use --allow-dirty only for local review')

async function nativeManifest(directory) {
  const manifest = {}
  async function visit(relative) {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      const filename = `${relative}/${entry.name}`
      if (entry.isDirectory()) await visit(filename)
      else manifest[filename] = createHash('sha256').update(await readFile(path.join(directory, filename))).digest('hex')
    }
  }
  await visit('android/libs')
  await visit('ios/libs')
  return JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()))
}

try {
  await mkdir(output, { recursive: true })
  const response = await fetch(upstreamUrl)
  if (!response.ok) throw new Error(`Upstream download failed: ${response.status}`)
  const archive = Buffer.from(await response.arrayBuffer())
  const actualIntegrity = `sha512-${createHash('sha512').update(archive).digest('base64')}`
  if (actualIntegrity !== upstreamIntegrity) throw new Error('Upstream tarball integrity mismatch')
  const upstreamArchive = path.join(temporary, 'upstream.tgz')
  await writeFile(upstreamArchive, archive)
  run('tar', ['-xzf', upstreamArchive, '-C', temporary])
  const upstreamNativeManifest = await nativeManifest(staging)

  // Keep published native binaries; overlay only reviewed, tracked fork files.
  const tracked = run('git', ['ls-files', '-z', '--', 'package']).split('\0').filter(Boolean)
  for (const filename of tracked) {
    await cp(path.join(root, filename), path.join(temporary, filename), { force: true, recursive: true })
  }
  if (await nativeManifest(staging) !== upstreamNativeManifest) throw new Error('Fork overlay changed bundled upstream native libraries or headers')
  await cp(path.join(root, 'README.md'), path.join(staging, 'README.md'))
  await cp(path.join(root, 'LICENSE'), path.join(staging, 'LICENSE'))
  await cp(path.join(root, 'LICENSE'), path.join(staging, 'LICENSE'))
  await rm(path.join(staging, 'lib'), { recursive: true, force: true })
  console.log(run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], toolDirectory).trim())
  await symlink(path.join(toolDirectory, 'node_modules'), path.join(staging, 'node_modules'), 'dir')
  console.log(run(path.join(toolDirectory, 'node_modules/.bin/bob'), ['build'], staging).trim())
  await rm(path.join(staging, 'node_modules'))

  await writeFile(path.join(staging, 'TONIC-PROVENANCE.json'), JSON.stringify({
    upstream: { version: '1.11.0', url: upstreamUrl, integrity: upstreamIntegrity },
    fork: { repository: 'https://github.com/PocketConservatory/react-native-filament', commit, dirty },
    nativeBinaries: 'Unmodified files from the verified upstream npm tarball',
  }, null, 2) + '\n')
  const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', output], staging))[0]
  const artifact = path.join(output, packed.filename)
  const verification = path.join(temporary, 'verification')
  await mkdir(verification)
  run('tar', ['-xzf', artifact, '-C', verification])
  const unpacked = path.join(verification, 'package')
  if (await nativeManifest(unpacked) !== upstreamNativeManifest) throw new Error('Packed native libraries/headers differ from upstream')
  const manifest = JSON.parse(await readFile(path.join(unpacked, 'package.json'), 'utf8'))
  for (const filename of [manifest.main + '.js', manifest.module + '.js', manifest.types, manifest['react-native'] + '.tsx', manifest.codegenConfig.jsSrcsDir, 'LICENSE', 'README.md', 'assets']) {
    await access(path.join(unpacked, filename))
  }
  const sha256 = createHash('sha256').update(await readFile(artifact)).digest('hex')
  await writeFile(`${artifact}.sha256`, `${sha256}  ${packed.filename}\n`)
  console.log(JSON.stringify({ artifact, sha256, commit, dirty, size: packed.size, unpackedSize: packed.unpackedSize, verifiedNativeFiles: Object.keys(JSON.parse(upstreamNativeManifest)).length }, null, 2))
} finally {
  await rm(temporary, { recursive: true, force: true })
}
