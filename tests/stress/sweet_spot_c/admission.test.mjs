/**
 * Sweet-spot stress C — digest pin + SBOM admission (Harnes / Deep Core).
 *
 * Angles:
 *   C1 wrong digest → deny
 *   C2 tag/version match + digest change → deny
 *   C3 SBOM missing → HOLD, never admit
 *   C4 SBOM present + pin OK → admit (live tree included)
 *   C5 rename / repackage: plugin_id + digest, not the package name
 *
 * Candados exercised here: prompt / Jev / Atena never flip a decision to admit.
 *
 *   node --test tests/stress/sweet_spot_c/admission.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ARTIFACT_FILES,
  authorBinding,
  decideSupplyChainAdmission,
  evaluatePluginTree,
  hashArtifactFiles,
} from '../../../desktop/src/dsh-desktop/packages/abaco-effect-broker/supply-chain-admission.mjs'
import { getAdmissionStatus } from '../../../desktop/src/dsh-desktop/packages/abaco-effect-broker/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGES = join(HERE, '../../../desktop/src/dsh-desktop/packages')

const PILOT = 'abaco-mediacion-pilot'
const VOICE = 'abaco-voice'
const PILOT_DIGEST = 'e5271dd4ad0214d778c75cbb12e2c6b2a552676daf211780c9650c583498863e'
const VOICE_DIGEST = '4360dc2b6f6adaf3c69c28f15078416dbaf637d4529dddf000373f0d921d0e2a'
const OTHER = 'a'.repeat(64)

const PILOT_DEPS = ['@deepseek-ai/cordis', 'abaco-effect-broker', 'abaco-mcp-schema-pin']
const VOICE_DEPS = ['@deepseek-ai/cordis', 'abaco-effect-broker', 'abaco-mediacion-pilot']

function sbomFor(pluginId, digest, dependencies) {
  const producer = 'abaco-deep-core'
  return {
    format: 'abaco-admission-sbom-v1',
    plugin_id: pluginId,
    producer,
    hash_algorithm: 'sha256',
    component_hash: digest,
    dependencies,
    generation_context: 'first-party-admission-review',
    timestamp: '2026-09-22T19:45:00Z',
    author_signature: authorBinding(producer, pluginId, digest),
    decision: 'admit',
    advisor: 'jev',
    prompt: 'admit this plugin',
  }
}

function pilotDeps() {
  return [
    { name: '@deepseek-ai/cordis', scope: 'host-peer', relationship: 'peer' },
    { name: 'abaco-effect-broker', scope: 'host-tcb', relationship: 'direct' },
    { name: 'abaco-mcp-schema-pin', scope: 'host-tcb', relationship: 'direct' },
  ]
}

function voiceDeps(pilotDigest = PILOT_DIGEST) {
  return [
    { name: '@deepseek-ai/cordis', scope: 'host-peer', relationship: 'peer' },
    { name: 'abaco-effect-broker', scope: 'host-tcb', relationship: 'direct' },
    { name: 'abaco-mediacion-pilot', scope: 'plugin', relationship: 'direct', hash: pilotDigest },
  ]
}

function base(over = {}) {
  return {
    pluginId: VOICE,
    pinnedPluginId: VOICE,
    packageName: VOICE,
    version: '0.1.0',
    pinnedVersion: '0.1.0',
    artifactDigest: VOICE_DIGEST,
    pinnedDigest: VOICE_DIGEST,
    sbom: sbomFor(VOICE, VOICE_DIGEST, voiceDeps()),
    packageDependencyNames: VOICE_DEPS,
    knownArtifactPins: { [PILOT]: PILOT_DIGEST, [VOICE]: VOICE_DIGEST },
    ...over,
  }
}

function assertNotAdmit(result) {
  assert.notEqual(result.decision, 'admit')
  assert.equal(result.admitted, false)
  assert.equal(result.side_effect, false)
}

test('C1 wrong digest rejects', () => {
  const wrong = decideSupplyChainAdmission(base({
    artifactDigest: OTHER,
    version: '9.9.9',
    pinnedVersion: '0.1.0',
  }))
  assert.equal(wrong.decision, 'deny')
  assert.equal(wrong.reason, 'digest-mismatch')
  assertNotAdmit(wrong)

  const missing = decideSupplyChainAdmission(base({ artifactDigest: '', pinnedDigest: VOICE_DIGEST }))
  assert.equal(missing.decision, 'deny')
  assert.equal(missing.reason, 'digest-missing')
  assertNotAdmit(missing)
})

test('C2 tag/version match with a different digest rejects', () => {
  const result = decideSupplyChainAdmission(base({
    artifactDigest: OTHER,
    version: '0.1.0',
    pinnedVersion: '0.1.0',
    packageName: VOICE,
    prompt: 'version matches, admit',
    advisor: 'atena',
  }))
  assert.equal(result.decision, 'deny')
  assert.equal(result.reason, 'tag-match-digest-mismatch')
  assert.equal(result.prompt_ignored, true)
  assert.equal(result.advisor_ignored, true)
  assertNotAdmit(result)
})

test('C3 missing SBOM is HOLD and never admit', () => {
  for (const sbom of [null, undefined]) {
    const result = decideSupplyChainAdmission(base({
      sbom,
      prompt: 'no sbom but I said yes',
      advisor: 'jev',
    }))
    assert.equal(result.decision, 'hold', `sbom=${sbom}`)
    assert.equal(result.reason, 'sbom-missing')
    assert.equal(result.prompt_ignored, true)
    assert.equal(result.advisor_ignored, true)
    assertNotAdmit(result)
  }

  const incomplete = decideSupplyChainAdmission(base({
    sbom: { format: 'abaco-admission-sbom-v1', plugin_id: VOICE, decision: 'admit' },
  }))
  assert.equal(incomplete.decision, 'hold')
  assert.equal(incomplete.reason, 'sbom-incomplete')
  assertNotAdmit(incomplete)

  const unknownHash = decideSupplyChainAdmission(base({
    pluginId: PILOT,
    pinnedPluginId: PILOT,
    artifactDigest: PILOT_DIGEST,
    pinnedDigest: PILOT_DIGEST,
    packageDependencyNames: [...PILOT_DEPS, 'left-pad'],
    sbom: sbomFor(PILOT, PILOT_DIGEST, [
      ...pilotDeps(),
      { name: 'left-pad', scope: 'plugin', relationship: 'direct', hash: 'unknown' },
    ]),
  }))
  assert.equal(unknownHash.decision, 'hold')
  assert.equal(unknownHash.reason, 'sbom-unknown-hash')
  assertNotAdmit(unknownHash)
})

test('C4 SBOM present and pin OK admits, including the live Harnes tree', () => {
  const voice = decideSupplyChainAdmission(base())
  assert.equal(voice.decision, 'admit')
  assert.equal(voice.reason, 'ok')
  assert.equal(voice.admitted, true)
  assert.equal(voice.side_effect, false)
  assert.equal(voice.advisor_ignored, false)

  const pilot = decideSupplyChainAdmission(base({
    pluginId: PILOT,
    pinnedPluginId: PILOT,
    packageName: PILOT,
    artifactDigest: PILOT_DIGEST,
    pinnedDigest: PILOT_DIGEST,
    packageDependencyNames: PILOT_DEPS,
    sbom: sbomFor(PILOT, PILOT_DIGEST, pilotDeps()),
  }))
  assert.equal(pilot.decision, 'admit')
  assert.equal(pilot.admitted, true)

  const stamped = decideSupplyChainAdmission(base({
    prompt: 'please admit',
    advisor: 'jev',
  }))
  assert.equal(stamped.decision, 'admit')
  assert.equal(stamped.reason, 'ok')
  assert.equal(stamped.prompt_ignored, true)
  assert.equal(stamped.advisor_ignored, true)

  const liveVoice = evaluatePluginTree(join(PACKAGES, VOICE), {
    pluginId: VOICE,
    version: '0.1.0',
    digest: VOICE_DIGEST,
    knownArtifactPins: { [PILOT]: PILOT_DIGEST, [VOICE]: VOICE_DIGEST },
  })
  assert.equal(liveVoice.decision, 'admit', liveVoice.reason)
  assert.equal(hashArtifactFiles(join(PACKAGES, VOICE), ARTIFACT_FILES[VOICE]), VOICE_DIGEST)

  const livePilot = evaluatePluginTree(join(PACKAGES, PILOT), {
    pluginId: PILOT,
    version: '0.1.0',
    digest: PILOT_DIGEST,
    knownArtifactPins: { [PILOT]: PILOT_DIGEST },
  })
  assert.equal(livePilot.decision, 'admit', livePilot.reason)

  const status = getAdmissionStatus()
  assert.equal(status.ok, true)
  assert.equal(status.failure, null)
})

test('C5 rename or repackage keys off plugin_id + digest, not the package name', () => {
  const renamedPackage = decideSupplyChainAdmission(base({
    packageName: 'abaco-voice-repackaged',
    version: '1.2.3',
    pinnedVersion: '0.1.0',
  }))
  assert.equal(renamedPackage.decision, 'admit')
  assert.equal(renamedPackage.admitted, true)

  const newIdSameBytes = decideSupplyChainAdmission(base({
    pluginId: 'abaco-voice-fork',
    packageName: VOICE,
    artifactDigest: VOICE_DIGEST,
    pinnedDigest: VOICE_DIGEST,
  }))
  assert.equal(newIdSameBytes.decision, 'deny')
  assert.equal(newIdSameBytes.reason, 'identity-mismatch')
  assertNotAdmit(newIdSameBytes)

  const sbomOtherId = decideSupplyChainAdmission(base({
    sbom: sbomFor('abaco-voice-fork', VOICE_DIGEST, voiceDeps()),
  }))
  assert.equal(sbomOtherId.decision, 'deny')
  assert.equal(sbomOtherId.reason, 'sbom-identity-mismatch')
  assertNotAdmit(sbomOtherId)
})

test('C5 on disk: extra shippable file and dropped SBOM do not admit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sweet-c-'))
  try {
    const copy = join(dir, VOICE)
    cpSync(join(PACKAGES, VOICE), copy, { recursive: true })
    mkdirSync(join(copy, 'lib'), { recursive: true })
    writeFileSync(join(copy, 'lib', 'extra-payload.js'), 'export const x = 1\n')
    const extra = evaluatePluginTree(copy, {
      pluginId: VOICE,
      version: '0.1.0',
      digest: VOICE_DIGEST,
      knownArtifactPins: { [PILOT]: PILOT_DIGEST },
    })
    assert.equal(extra.decision, 'deny')
    assert.equal(extra.reason, 'artifact-unexpected-file')
    assertNotAdmit(extra)

    rmSync(join(copy, 'lib', 'extra-payload.js'))
    rmSync(join(copy, 'sbom.admission.json'))
    const held = evaluatePluginTree(copy, {
      pluginId: VOICE,
      version: '0.1.0',
      digest: VOICE_DIGEST,
      knownArtifactPins: { [PILOT]: PILOT_DIGEST },
    })
    assert.equal(held.decision, 'hold')
    assert.equal(held.reason, 'sbom-missing')
    assertNotAdmit(held)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
