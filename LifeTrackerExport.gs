// LifeTracker → Google Doc export
// Setup:
//   1. In Apps Script editor: Project Settings > Script Properties, add:
//        EXPORT_API_URL  = https://life-os-chi-opal.vercel.app/api/export-data
//        EXPORT_SECRET   = <the EXPORT_SECRET value added to Vercel>
//        DOC_ID          = 1dcm9O7lLJWN5_jQClpHVh6BlafyA4KAeNOICZP_tpvI
//   2. Run syncToDoc once to grant permissions and do the initial sync
//   3. Run setupHourlyTrigger once to enable live updates

// ── Config ────────────────────────────────────────────────────────────────────

function getConfig() {
  const p = PropertiesService.getScriptProperties()
  return {
    apiUrl: p.getProperty('EXPORT_API_URL'),
    secret: p.getProperty('EXPORT_SECRET'),
    docId:  p.getProperty('DOC_ID'),
  }
}

// ── Data fetch ────────────────────────────────────────────────────────────────

function fetchData() {
  const { apiUrl, secret } = getConfig()
  const res = UrlFetchApp.fetch(apiUrl, {
    headers: { 'x-export-secret': secret },
    muteHttpExceptions: true,
  })
  if (res.getResponseCode() !== 200) {
    throw new Error('Export API error ' + res.getResponseCode() + ': ' + res.getContentText())
  }
  return JSON.parse(res.getContentText())
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function h2(body, text) {
  return body.appendParagraph(text).setHeading(DocumentApp.ParagraphHeading.HEADING2)
}

function h3(body, text) {
  return body.appendParagraph(text).setHeading(DocumentApp.ParagraphHeading.HEADING3)
}

function line(body, text) {
  return body.appendParagraph(text)
    .setHeading(DocumentApp.ParagraphHeading.NORMAL)
    .setIndentStart(18)
}

function formatDateHeading(dateStr) {
  // dateStr = "2026-06-14" → "14 June 2026 — Sunday"
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  const day  = date.toLocaleDateString('en-GB', { weekday: 'long',   timeZone: 'UTC' })
  const fmt  = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  return fmt + ' — ' + day
}

function join(parts, sep) {
  return parts.filter(function(p) { return p != null && p !== '' }).join(sep || ' | ')
}

// ── Main sync ─────────────────────────────────────────────────────────────────

function syncToDoc() {
  var data = fetchData()
  var logs    = data.logs    || {}
  var weather = data.weather || {}
  var fitbit  = data.fitbit  || {}

  var doc  = DocumentApp.openById(getConfig().docId)
  var body = doc.getBody()
  body.clear()

  // Document title
  body.appendParagraph('LifeTracker Health Journal')
    .setHeading(DocumentApp.ParagraphHeading.HEADING1)
  body.appendParagraph('Last synced: ' + new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' }))
    .setFontSize(10).setForegroundColor('#666666')
  body.appendParagraph('')

  // Sort dates newest-first, skip non-date keys
  var dates = Object.keys(logs)
    .filter(function(k) { return /^\d{4}-\d{2}-\d{2}$/.test(k) })
    .sort()
    .reverse()

  for (var di = 0; di < dates.length; di++) {
    var date    = dates[di]
    var log     = logs[date]    || {}
    var w       = weather[date] || {}
    var fb      = fitbit[date]  || {}

    // ── Date heading (H2 → shows in document outline / ToC) ──────────────────
    h2(body, formatDateHeading(date))

    // ── Environment ──────────────────────────────────────────────────────────
    var envParts    = []
    var pollenParts = []

    if (w.temp_max     != null) envParts.push((w.temp_min != null ? w.temp_min + '–' : '') + w.temp_max + '°C')
    if (w.precipitation_mm)     envParts.push('Rain: ' + w.precipitation_mm + 'mm')
    if (w.wind_speed_max)       envParts.push('Wind: ' + w.wind_speed_max + 'km/h')
    if (w.uv_index     != null) envParts.push('UV: '  + w.uv_index)
    if (w.humidity_pct != null) envParts.push('Humidity: ' + w.humidity_pct + '%')

    if (w.grass_pollen_label) pollenParts.push('Grass: ' + w.grass_pollen_label + (w.grass_pollen_score != null ? ' (' + w.grass_pollen_score + ')' : ''))
    if (w.tree_pollen_label)  pollenParts.push('Tree: '  + w.tree_pollen_label  + (w.tree_pollen_score  != null ? ' (' + w.tree_pollen_score  + ')' : ''))
    if (w.weed_pollen_label)  pollenParts.push('Weed: '  + w.weed_pollen_label)
    if (w.aqi_label)          pollenParts.push('AQI: '   + w.aqi_label + (w.aqi != null ? ' (' + w.aqi + ')' : ''))
    if (w.pm10  != null)      pollenParts.push('PM10: '  + w.pm10)
    if (w.pm2_5 != null)      pollenParts.push('PM2.5: ' + w.pm2_5)

    if (envParts.length || pollenParts.length) {
      h3(body, 'Environment')
      if (envParts.length)    line(body, join(envParts))
      if (pollenParts.length) line(body, 'Pollen — ' + join(pollenParts))
    }

    // ── Sleep ─────────────────────────────────────────────────────────────────
    var sleep = log.sleep || {}
    // Prefer fitbit-raw for detail if available
    var sleepMinutes = fb.sleep_minutes || fb._fitbit_minutes || sleep._fitbit_minutes
    var sleepHrs     = sleep.hours  // label like "7", "8", "9+"

    if (sleepHrs || sleepMinutes) {
      h3(body, 'Sleep')
      var sleepParts = []
      if (sleepMinutes) {
        var h = Math.floor(sleepMinutes / 60)
        var m = sleepMinutes % 60
        sleepParts.push(h + 'h ' + (m > 0 ? m + 'min' : ''))
      } else if (sleepHrs) {
        sleepParts.push(sleepHrs + 'h')
      }
      if (sleep.efficiency_pct != null || fb.in_bed_minutes != null) {
        var effPct = sleep.efficiency_pct || (sleepMinutes && fb.in_bed_minutes ? Math.round(sleepMinutes / fb.in_bed_minutes * 100) : null)
        if (effPct != null) sleepParts.push('Efficiency: ' + effPct + '%')
      }
      if (sleep.score     != null) sleepParts.push('Score: ' + sleep.score + '/100')
      if (fb.resting_hr   != null) sleepParts.push('Resting HR: ' + fb.resting_hr + 'bpm')
      if (fb.hrv          != null) sleepParts.push('HRV: ' + fb.hrv + 'ms')
      if (fb.spo2         != null) sleepParts.push('SpO₂: ' + fb.spo2 + '%')
      if (fb.respiratory_rate != null) sleepParts.push('Resp: ' + fb.respiratory_rate + '/min')
      line(body, join(sleepParts))

      var stageParts = []
      var deepM  = fb.deep_minutes  || sleep.deep_minutes
      var remM   = fb.rem_minutes   || sleep.rem_minutes
      var lightM = fb.light_minutes || sleep.light_minutes
      var awakeM = fb.awake_minutes || sleep.awake_minutes
      if (deepM  != null) stageParts.push('Deep: '  + deepM  + 'min')
      if (remM   != null) stageParts.push('REM: '   + remM   + 'min')
      if (lightM != null) stageParts.push('Light: ' + lightM + 'min')
      if (awakeM != null) stageParts.push('Awake: ' + awakeM + 'min')
      if (stageParts.length) line(body, join(stageParts))
      if (fb.skin_temp_deviation != null) line(body, 'Skin temp deviation: ' + (fb.skin_temp_deviation > 0 ? '+' : '') + fb.skin_temp_deviation + '°C')
    }

    // ── Activity & Health Sync ────────────────────────────────────────────────
    var exercise = log.exercise || {}
    var actParts = []
    var steps    = exercise.steps || fb.steps
    if (steps       != null) actParts.push('Steps: ' + Number(steps).toLocaleString('en-GB'))
    if (fb.active_energy_kcal  != null) actParts.push('Active energy: ' + fb.active_energy_kcal + ' kcal')
    if (fb.total_calories_kcal != null) actParts.push('Total calories: ' + fb.total_calories_kcal + ' kcal')
    var weightKg = fb.weight_kg != null ? fb.weight_kg : (log.body && log.body._weight_kg != null ? log.body._weight_kg : null)
    if (weightKg != null) actParts.push('Weight: ' + weightKg + ' kg')
    if (actParts.length) {
      h3(body, 'Activity & Health Sync')
      line(body, join(actParts))
    }

    // ── Exercise ──────────────────────────────────────────────────────────────
    var exLines = []
    if (exercise.activities && exercise.activities.length) exLines.push('Activities: ' + exercise.activities.join(', '))
    if (exercise.energy != null) exLines.push('Energy: ' + exercise.energy + '/5')
    if (exLines.length) {
      h3(body, 'Exercise')
      exLines.forEach(function(l) { line(body, l) })
    }

    // ── Mind ──────────────────────────────────────────────────────────────────
    var mood      = log.mood || {}
    var moodLines = []
    var scores    = []
    if (mood.work   != null) scores.push('Work: '   + mood.work   + '/5')
    if (mood.life   != null) scores.push('Life: '   + mood.life   + '/5')
    if (mood.focus  != null) scores.push('Focus: '  + mood.focus  + '/5')
    if (mood.energy != null) scores.push('Energy: ' + mood.energy + '/5')
    if (scores.length) moodLines.push(scores.join(' · '))
    var meds = []
    if (mood.attentin && mood.attentin !== 'None') meds.push('Attentin: ' + mood.attentin)
    if (mood.ritalin  && mood.ritalin  !== 'None') meds.push('Ritalin: '  + mood.ritalin)
    if (mood.melatonin) meds.push('Melatonin ✓')
    if (meds.length) moodLines.push(join(meds))
    if (mood.symptoms && mood.symptoms.length) moodLines.push('Symptoms: ' + mood.symptoms.join(', '))
    if (mood.note) moodLines.push('Note: ' + mood.note)
    if (moodLines.length) {
      h3(body, 'Mind')
      moodLines.forEach(function(l) { line(body, l) })
    }

    // ── Allergies ─────────────────────────────────────────────────────────────
    // Always show main severity trio — None on a high-pollen day is meaningful
    var health     = log.health || {}
    var allergyRows = []

    var hay = 'Hayfever: ' + (health.hayfever || 'None')
    if (health.hayfever && health.hayfever !== 'None' && health.hayfever_symptoms && health.hayfever_symptoms.length) {
      hay += ' [' + health.hayfever_symptoms.join(', ') + ']'
    }
    var ecz = 'Eczema: ' + (health.eczema || 'None')
    if (health.eczema && health.eczema !== 'None' && health.eczema_location && health.eczema_location.length) {
      ecz += ' [' + health.eczema_location.join(', ') + ']'
    }
    var epi = 'Episcleritis: ' + (health.episcleritis || 'None')
    allergyRows.push(join([hay, ecz, epi]))

    if (health.itchy   && health.itchy.length)   allergyRows.push('Itchy: '   + health.itchy.join(', '))
    if (health.dryness && health.dryness.length) allergyRows.push('Dryness: ' + health.dryness.join(', '))
    var rx = []
    if (health.antihistamines && health.antihistamines !== 'None' && health.antihistamines !== '0') rx.push('Antihistamines: ' + health.antihistamines)
    if (health.steroid_cream) rx.push('Steroid cream ✓')
    if (rx.length) allergyRows.push(join(rx))
    if (health.note) allergyRows.push('Note: ' + health.note)

    h3(body, 'Allergies')
    allergyRows.forEach(function(r) { line(body, r) })

    // ── Water ─────────────────────────────────────────────────────────────────
    var water = log.water || {}
    if (water.glasses != null) {
      h3(body, 'Water')
      line(body, water.glasses + ' glasses')
    }

    // ── Alcohol ───────────────────────────────────────────────────────────────
    var alcohol = log.alcohol || {}
    if (alcohol.level != null) {
      h3(body, 'Alcohol')
      var aLine = alcohol.level === 'None' ? 'None'
        : alcohol.level + (alcohol.type && alcohol.type.length ? ' [' + alcohol.type.join(', ') + ']' : '')
      line(body, aLine)
    }

    // ── Diet ──────────────────────────────────────────────────────────────────
    var diet      = log.diet || {}
    var dietLines = []
    var dietMap   = [
      ['sugar', 'Sugar'], ['protein', 'Protein'], ['fruit_veg', 'Fruit/veg'],
      ['carbs', 'Carbs'], ['fats', 'Fats'], ['snacking', 'Snacking'], ['caffeine', 'Caffeine'],
    ]
    var dietParts = dietMap
      .filter(function(e) { return diet[e[0]] != null })
      .map(function(e) { return e[1] + ': ' + diet[e[0]] })
    if (dietParts.length) dietLines.push(dietParts.join(' · '))
    if (diet.allergens   && diet.allergens.length)   dietLines.push('Allergens: '   + diet.allergens.join(', '))
    if (diet.supplements && diet.supplements.length) dietLines.push('Supplements: ' + diet.supplements.join(', '))
    if (diet.note) dietLines.push('Note: ' + diet.note)
    if (dietLines.length) {
      h3(body, 'Diet')
      dietLines.forEach(function(l) { line(body, l) })
    }

    // ── Body ──────────────────────────────────────────────────────────────────
    // Always show the three pain/severity fields — None is informative
    var bd        = log.body || {}
    var bodyLines = []
    var pain = [
      'Knee: '       + (bd.knee_pain        || 'None'),
      'Wrist/nerve: ' + (bd.wrist_nerve_pain || 'None'),
      'Gut: '        + (bd.gut              || 'None'),
    ]
    bodyLines.push(join(pain))
    if (bd.gut_symptoms && bd.gut_symptoms.length) bodyLines.push('Gut symptoms: ' + bd.gut_symptoms.join(', '))
    if (bd.stool && bd.stool.length) bodyLines.push('Stool: Type ' + bd.stool.join(', '))
    if (bd.illness && bd.illness !== 'None') bodyLines.push('Illness: ' + bd.illness)
    if (bd.painkillers && bd.painkillers !== '0') bodyLines.push('Painkillers: ' + bd.painkillers + ' tablets')
    var flags = []
    if (bd.period) flags.push('Period')
    if (bd.pill === true)  flags.push('Pill ✓')
    if (bd.pill === false) flags.push('Pill ✗')
    if (flags.length) bodyLines.push(join(flags))
    if (bd.note) bodyLines.push('Note: ' + bd.note)

    h3(body, 'Body')
    bodyLines.forEach(function(l) { line(body, l) })

    // ── Social ────────────────────────────────────────────────────────────────
    var social = log.social || {}
    if (social.activities && social.activities.length) {
      h3(body, 'Social')
      line(body, social.activities.join(', '))
    }

    // ── Journal ───────────────────────────────────────────────────────────────
    var transcripts = log.transcripts || []
    if (transcripts.length) {
      h3(body, 'Journal')
      for (var ti = 0; ti < transcripts.length; ti++) {
        var t = transcripts[ti]
        if (t.timestamp) {
          var ts   = new Date(t.timestamp)
          var time = ts.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
          body.appendParagraph('[' + time + ']')
            .setHeading(DocumentApp.ParagraphHeading.NORMAL)
            .setIndentStart(18)
            .setItalic(true)
        }
        if (t.text) {
          body.appendParagraph(t.text)
            .setHeading(DocumentApp.ParagraphHeading.NORMAL)
            .setIndentStart(18)
        }
        if (ti < transcripts.length - 1) {
          body.appendParagraph('')
            .setHeading(DocumentApp.ParagraphHeading.NORMAL)
            .setIndentStart(18)
        }
      }
    }

    // Divider between dates
    body.appendHorizontalRule()
  }

  doc.saveAndClose()
  Logger.log('Sync complete. ' + dates.length + ' dates written.')
}

// ── Trigger setup ─────────────────────────────────────────────────────────────

function setupHourlyTrigger() {
  // Remove any existing syncToDoc triggers first
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'syncToDoc') ScriptApp.deleteTrigger(t)
  })
  ScriptApp.newTrigger('syncToDoc')
    .timeBased()
    .everyHours(1)
    .create()
  Logger.log('Hourly trigger created.')
}
