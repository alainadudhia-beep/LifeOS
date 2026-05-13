#!/usr/bin/env node
// Run: node --env-file=.env.local scripts/test-trends.js
// Reads real data from Supabase and prints all findings to stdout.

import { createClient } from '@supabase/supabase-js'
import { computeTrends } from '../api/compute-trends.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const USER_ID = process.env.HEALTH_IMPORT_USER_ID

async function main() {
  console.log('Fetching data from Supabase...\n')

  const [logsRow, weatherRow, fitbitRow] = await Promise.all([
    supabase.from('user_data').select('value').eq('key', 'lifetracker-life-logs').eq('user_id', USER_ID).single(),
    supabase.from('user_data').select('value').eq('key', 'lifetracker-weather').eq('user_id', USER_ID).single(),
    supabase.from('user_data').select('value').eq('key', 'lifetracker-fitbit-raw').eq('user_id', USER_ID).single(),
  ])

  const logs         = logsRow.data?.value    ?? {}
  const weatherStore = weatherRow.data?.value ?? {}
  const fitbitRaw    = fitbitRow.data?.value  ?? {}

  const nDays = Object.keys(logs).length
  console.log(`Loaded ${nDays} days of life logs, ${Object.keys(weatherStore).length} weather days, ${Object.keys(fitbitRaw).length} fitbit days\n`)

  const result = computeTrends(logs, weatherStore, fitbitRaw)
  const { findings } = result

  console.log(`Total findings computed: ${findings.length}`)
  console.log(`Days analysed: ${result.n_days}\n`)
  console.log('─'.repeat(80))

  if (!findings.length) {
    console.log('No findings met the minimum data threshold (n≥3 per bucket).')
    return
  }

  // Group by cause for readability
  const byGroup = {}
  for (const f of findings) {
    const g = f.cause_group
    if (!byGroup[g]) byGroup[g] = []
    byGroup[g].push(f)
  }

  for (const [group, groupFindings] of Object.entries(byGroup)) {
    console.log(`\n▶ ${group.toUpperCase()}`)
    for (const f of groupFindings) {
      const lagStr = `lag ${f.lag}d`
      if (f.type === 'binary') {
        const arrow = f.direction === 'higher_with' ? '▲' : '▼'
        console.log(
          `  ${arrow} [${f.effect_size.toFixed(2)}] ${f.cause_label} → ${f.effect_label} (${lagStr})` +
          `  with: ${f.mean_with}  without: ${f.mean_without}  diff: ${f.diff > 0 ? '+' : ''}${f.diff}` +
          `  n=${f.n_with}/${f.n_without}`
        )
      } else {
        const arrow = f.direction === 'positive' ? '▲' : '▼'
        console.log(
          `  ${arrow} [${f.effect_size.toFixed(2)}] ${f.cause_label} → ${f.effect_label} (${lagStr})` +
          `  r=${f.pearson_r}  slope=${f.slope}/unit  n=${f.n}`
        )
      }
    }
  }

  console.log('\n' + '─'.repeat(80))
  console.log('\nTop 20 findings by effect size:\n')
  for (const f of findings.slice(0, 20)) {
    if (f.type === 'binary') {
      console.log(
        `  [${f.effect_size.toFixed(2)}] ${f.cause_label} → ${f.effect_label} at lag ${f.lag}d` +
        `  (${f.direction === 'higher_with' ? '+' : ''}${f.diff}, n=${f.n_with}+${f.n_without})`
      )
    } else {
      console.log(
        `  [${f.effect_size.toFixed(2)}] ${f.cause_label} → ${f.effect_label} at lag ${f.lag}d` +
        `  (r=${f.pearson_r}, n=${f.n})`
      )
    }
  }
}

main().catch(err => { console.error(err); process.exit(1) })
