import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { emptyBase } from '../src/mock/seed'
import { toBackup, fromBackup } from '../src/core/backup'

// Run with node_modules/.bin/vite-node --mode test scripts/prepare-pitch-fixture.ts.
// This creates an importable Demo file only; it never writes browser or cloud data.
const state = emptyBase()
state.provider = { name: 'ครูพลอย', particle: 'ค่ะ', promptpayId: '08x-xxx-xxxx' }
state.style = 'per_unit'
state.scenarioId = 'per-unit'
const names = ['น้องแพรว', 'น้องภูมิ', 'น้องมิว', 'น้องต้น', 'น้องฟ้า']
state.clients = names.map((name, i) => ({ id: `pitch-c${i + 1}`, name: `ผู้ปกครอง${name}` }))
state.subjects = names.map((name, i) => ({ id: `pitch-s${i + 1}`, clientId: `pitch-c${i + 1}`,
  name, active: true, createdAt: state.today, label: 'คณิตศาสตร์', billing: { mode: 'per_unit', rate: 400 } }))
state.units = state.subjects.map((subject, i) => ({ id: `pitch-u${i + 1}`, subjectId: subject.id,
  scheduledAt: state.today, time: `${14 + i}:00`, durationMin: 60, label: 'คณิตศาสตร์' }))
const backup = toBackup(state, new Date().toISOString())
const restored = fromBackup(backup, 5)
if (!restored.ok || restored.state.subjects.length !== 5 || restored.state.mode !== 'demo') throw new Error('Invalid pitch fixture')
const destination = resolve(process.env.SOLO_PITCH_DIR ?? '.omx/pitch-kit')
mkdirSync(destination, { recursive: true })
writeFileSync(resolve(destination, 'solo-demo-kru-ploy-5.json'), backup)
console.log('Created validated Demo backup: ครูพลอย, 5 students; no real payment destination.')
