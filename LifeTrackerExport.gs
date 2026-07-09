// LifeTracker → Google Doc + Google Sheet export
// Setup:
//   1. In Apps Script editor: Project Settings > Script Properties, add:
//        EXPORT_API_URL  = https://life-os-chi-opal.vercel.app/api/export-data
//        EXPORT_SECRET   = <the EXPORT_SECRET value added to Vercel>
//        DOC_ID          = 1dcm9O7lLJWN5_jQClpHVh6BlafyA4KAeNOICZP_tpvI
//        SHEET_ID        = 1CgfcgDQMdJ7qqEPaRnpydtzDGt1jCuewHm098XLB2jc
//   2. Run syncToDoc / syncToSheet manually whenever you want a refresh

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

// ── Sheet sync ────────────────────────────────────────────────────────────────

function syncToSheet() {
  var data    = fetchData()
  var logs    = data.logs    || {}
  var weather = data.weather || {}
  var fitbit  = data.fitbit  || {}

  // Dates oldest-first
  var dates = Object.keys(logs)
    .filter(function(k) { return /^\d{4}-\d{2}-\d{2}$/.test(k) })
    .sort()

  // ── Encoding helpers ────────────────────────────────────────────────────────

  // "None"→0 "Low"→1 "Med"→2 "Bad"/"High"→3, null→''
  function sev(v) {
    if (v == null) return ''
    var m = { 'None':0, 'Low':1, 'Med':2, 'Bad':3, 'High':3 }
    return m[v] != null ? m[v] : ''
  }

  // Strip trailing "+" or prefix "<", return number or ''
  function num(v) {
    if (v == null) return ''
    var s = String(v).replace('+','').replace('<','')
    var n = parseFloat(s)
    return isNaN(n) ? '' : n
  }

  // Binary membership in array
  function has(arr, val) {
    return (arr && arr.indexOf(val) !== -1) ? 1 : 0
  }

  // Pollen label → 0-4
  function pollen(v) {
    if (v == null) return ''
    var m = { 'None':0, 'Low':1, 'Medium':2, 'High':3, 'Very High':4 }
    return m[v] != null ? m[v] : ''
  }

  // Illness → 0-3
  function illness(v) {
    var m = { 'None':0, 'Cold':1, 'Flu':2, 'Sick':3 }
    return (v != null && m[v] != null) ? m[v] : ''
  }

  // Attentin mg string → number
  function mgNum(v) {
    if (!v || v === 'None') return 0
    return parseFloat(v) || ''
  }

  // Stool array → average (Bristol 1-7)
  function stoolAvg(arr) {
    if (!arr || !arr.length) return ''
    var nums = arr.map(function(s) { return parseInt(s) }).filter(function(n) { return !isNaN(n) })
    if (!nums.length) return ''
    var sum = nums.reduce(function(a, b) { return a + b }, 0)
    return Math.round((sum / nums.length) * 10) / 10
  }

  // Sleep hours label → numeric hours (midpoints)
  function sleepHrs(v) {
    if (v == null) return ''
    if (v === '<5') return 4.5
    var n = parseFloat(v)
    return isNaN(n) ? '' : n
  }

  // ── Row definitions ─────────────────────────────────────────────────────────
  // Each entry: [section label ('' = data row), row label, fn(log, w, fb) → value]
  // Section label rows are written as bold grey headers with no data.

  var ROWS = [
    // ENVIRONMENT
    ['ENVIRONMENT', '', null],
    ['', 'Temp max (°C)',          function(l,w)   { return w.temp_max    != null ? w.temp_max    : '' }],
    ['', 'Temp min (°C)',          function(l,w)   { return w.temp_min    != null ? w.temp_min    : '' }],
    ['', 'Rain (mm)',              function(l,w)   { return w.precipitation_mm != null ? w.precipitation_mm : '' }],
    ['', 'Wind max (km/h)',        function(l,w)   { return w.wind_speed_max  != null ? w.wind_speed_max  : '' }],
    ['', 'UV index',               function(l,w)   { return w.uv_index    != null ? w.uv_index    : '' }],
    ['', 'Humidity (%)',           function(l,w)   { return w.humidity_pct != null ? w.humidity_pct : '' }],
    ['', 'Grass pollen (0-4)',     function(l,w)   { return pollen(w.grass_pollen_label) }],
    ['', 'Grass pollen score',     function(l,w)   { return w.grass_pollen_score != null ? w.grass_pollen_score : '' }],
    ['', 'Tree pollen (0-4)',      function(l,w)   { return pollen(w.tree_pollen_label) }],
    ['', 'Tree pollen score',      function(l,w)   { return w.tree_pollen_score != null ? w.tree_pollen_score : '' }],
    ['', 'Weed pollen (0-4)',      function(l,w)   { return pollen(w.weed_pollen_label) }],
    ['', 'AQI',                    function(l,w)   { return w.aqi     != null ? w.aqi     : '' }],
    ['', 'PM10',                   function(l,w)   { return w.pm10    != null ? w.pm10    : '' }],
    ['', 'PM2.5',                  function(l,w)   { return w.pm2_5   != null ? w.pm2_5   : '' }],

    // SLEEP
    ['SLEEP', '', null],
    ['', 'Sleep hours',            function(l,w,fb) { return sleepHrs(l.sleep && l.sleep.hours) }],
    ['', 'Sleep efficiency (%)',   function(l,w,fb) {
      var s = l.sleep || {}
      if (s.efficiency_pct != null) return s.efficiency_pct
      var sm = fb.sleep_minutes, ib = fb.in_bed_minutes
      return (sm && ib) ? Math.round(sm / ib * 100) : ''
    }],
    ['', 'Sleep score (0-100)',    function(l,w,fb) { var s = l.sleep || {}; return s.score != null ? s.score : (fb.sleep_score != null ? fb.sleep_score : '') }],
    ['', 'Deep sleep (min)',       function(l,w,fb) { var s = l.sleep || {}; return s.deep_minutes  != null ? s.deep_minutes  : (fb.deep_minutes  != null ? fb.deep_minutes  : '') }],
    ['', 'REM sleep (min)',        function(l,w,fb) { var s = l.sleep || {}; return s.rem_minutes   != null ? s.rem_minutes   : (fb.rem_minutes   != null ? fb.rem_minutes   : '') }],
    ['', 'Light sleep (min)',      function(l,w,fb) { var s = l.sleep || {}; return s.light_minutes != null ? s.light_minutes : (fb.light_minutes != null ? fb.light_minutes : '') }],
    ['', 'Awake (min)',            function(l,w,fb) { var s = l.sleep || {}; return s.awake_minutes != null ? s.awake_minutes : (fb.awake_minutes != null ? fb.awake_minutes : '') }],
    ['', 'Resting HR (bpm)',       function(l,w,fb) { return fb.resting_hr  != null ? fb.resting_hr  : '' }],
    ['', 'HRV (ms)',               function(l,w,fb) { return fb.hrv         != null ? fb.hrv         : '' }],
    ['', 'SpO2 (%)',               function(l,w,fb) { return fb.spo2        != null ? fb.spo2        : '' }],
    ['', 'Respiratory rate',       function(l,w,fb) { return fb.respiratory_rate != null ? fb.respiratory_rate : '' }],
    ['', 'Skin temp deviation (°C)',function(l,w,fb){ return fb.skin_temp_deviation != null ? fb.skin_temp_deviation : '' }],

    // ACTIVITY
    ['ACTIVITY', '', null],
    ['', 'Steps',                  function(l,w,fb) { var ex = l.exercise || {}; return ex.steps != null ? ex.steps : (fb.steps != null ? fb.steps : '') }],
    ['', 'Active energy (kcal)',   function(l,w,fb) { return fb.active_energy_kcal   != null ? fb.active_energy_kcal   : '' }],
    ['', 'Total calories (kcal)',  function(l,w,fb) { return fb.total_calories_kcal  != null ? fb.total_calories_kcal  : '' }],
    ['', 'Weight (kg)',            function(l,w,fb) { return fb.weight_kg != null ? fb.weight_kg : (l.body && l.body._weight_kg != null ? l.body._weight_kg : '') }],

    // MIND
    ['MIND', '', null],
    ['', 'Work mood (1-5)',        function(l) { var m = l.mood || {}; return m.work   != null ? m.work   : '' }],
    ['', 'Life mood (1-5)',        function(l) { var m = l.mood || {}; return m.life   != null ? m.life   : '' }],
    ['', 'Focus (1-5)',            function(l) { var m = l.mood || {}; return m.focus  != null ? m.focus  : '' }],
    ['', 'Energy (1-5)',           function(l) { var m = l.mood || {}; return m.energy != null ? m.energy : '' }],
    ['', 'Attentin (mg)',          function(l) { return mgNum((l.mood || {}).attentin) }],
    ['', 'Ritalin (mg)',           function(l) { return mgNum((l.mood || {}).ritalin)  }],
    ['', 'Melatonin',              function(l) { var m = l.mood || {}; return m.melatonin ? 1 : (m.melatonin === false ? 0 : '') }],
    ['', 'Symptom: Fatigue',       function(l) { return has((l.mood || {}).symptoms, 'Fatigue')    }, '2026-05-06'],
    ['', 'Symptom: Brain fog',     function(l) { return has((l.mood || {}).symptoms, 'Brain fog')  }, '2026-05-06'],
    ['', 'Symptom: Anxious',       function(l) { return has((l.mood || {}).symptoms, 'Anxious')    }, '2026-05-06'],
    ['', 'Symptom: Headache',      function(l) { return has((l.mood || {}).symptoms, 'Headache')   }, '2026-05-06'],
    ['', 'Symptom: Crying',        function(l) { return has((l.mood || {}).symptoms, 'Crying')     }, '2026-05-20'],

    // ALLERGIES
    ['ALLERGIES', '', null],
    ['', 'Hayfever (0-3)',         function(l) { return sev((l.health || {}).hayfever)     }],
    ['', 'Eczema (0-3)',           function(l) { return sev((l.health || {}).eczema)       }],
    ['', 'Episcleritis (0-3)',     function(l) { return sev((l.health || {}).episcleritis) }],
    ['', 'HF: Runny nose',         function(l) { return has((l.health || {}).hayfever_symptoms, 'Runny nose')      }, '2026-05-13'],
    ['', 'HF: Blocked nose',       function(l) { return has((l.health || {}).hayfever_symptoms, 'Blocked nose')    }, '2026-05-21'],
    ['', 'HF: Blocked sinuses',    function(l) { return has((l.health || {}).hayfever_symptoms, 'Blocked sinuses') }, '2026-05-21'],
    ['', 'HF: Puffy eyes',         function(l) { return has((l.health || {}).hayfever_symptoms, 'Puffy eyes')      }, '2026-05-10'],
    ['', 'HF: Puffy face',         function(l) { return has((l.health || {}).hayfever_symptoms, 'Puffy face')      }, '2026-06-24'],
    ['', 'HF: Sneezing',           function(l) { return has((l.health || {}).hayfever_symptoms, 'Sneezing')        }, '2026-05-13'],
    ['', 'Eczema loc: Eyes',           function(l) { return has((l.health || {}).eczema_location, 'Eyes')          }, '2026-05-02'],
    ['', 'Eczema loc: Under mouth',    function(l) { return has((l.health || {}).eczema_location, 'Under mouth')   }, '2026-05-02'],
    ['', 'Eczema loc: Neck',           function(l) { return has((l.health || {}).eczema_location, 'Neck')          }, '2026-05-02'],
    ['', 'Eczema loc: Back of neck',   function(l) { return has((l.health || {}).eczema_location, 'Back of neck')  }, '2026-05-02'],
    ['', 'Eczema loc: Scalp',          function(l) { return has((l.health || {}).eczema_location, 'Scalp')         }, '2026-05-02'],
    ['', 'Eczema loc: Forehead',       function(l) { return has((l.health || {}).eczema_location, 'Forehead')      }, '2026-05-02'],
    ['', 'Eczema loc: Chin',           function(l) { return has((l.health || {}).eczema_location, 'Chin')          }, '2026-05-02'],
    ['', 'Itchy: Nose',            function(l) { return has((l.health || {}).itchy, 'Nose')           }, '2026-05-13'],
    ['', 'Itchy: Eyes',            function(l) { return has((l.health || {}).itchy, 'Eyes')           }, '2026-05-13'],
    ['', 'Itchy: Throat',          function(l) { return has((l.health || {}).itchy, 'Throat')         }, '2026-05-13'],
    ['', 'Itchy: Throat (night)',  function(l) { return has((l.health || {}).itchy, 'Throat (night)') }, '2026-05-13'],
    ['', 'Itchy: Sinuses',         function(l) { return has((l.health || {}).itchy, 'Sinuses')        }, '2026-05-13'],
    ['', 'Itchy: Ears',            function(l) { return has((l.health || {}).itchy, 'Ears')           }, '2026-05-13'],
    ['', 'Itchy: Head',            function(l) { return has((l.health || {}).itchy, 'Head')           }, '2026-05-29'],
    ['', 'Itchy: Neck',            function(l) { return has((l.health || {}).itchy, 'Neck')           }, '2026-05-29'],
    ['', 'Itchy: Body',            function(l) { return has((l.health || {}).itchy, 'Body')           }, '2026-05-13'],
    ['', 'Itchy: In shower',       function(l) { return has((l.health || {}).itchy, 'In shower')      }, '2026-05-13'],
    ['', 'Dryness: Eyes',          function(l) { return has((l.health || {}).dryness, 'Eyes')         }, '2026-05-06'],
    ['', 'Dryness: Skin',          function(l) { return has((l.health || {}).dryness, 'Skin')         }, '2026-05-06'],
    ['', 'Dryness: Lips',          function(l) { return has((l.health || {}).dryness, 'Lips')         }, '2026-05-06'],
    ['', 'Dryness: Throat',        function(l) { return has((l.health || {}).dryness, 'Throat')       }, '2026-06-26'],
    ['', 'Antihistamines (0-3)',    function(l) { var v = (l.health || {}).antihistamines; return (v == null || v === 'None') ? '' : parseInt(v) }],
    ['', 'Steroid cream',          function(l) { var h = l.health || {}; return h.steroid_cream ? 1 : (h.steroid_cream === false ? 0 : '') }],

    // WATER
    ['WATER', '', null],
    ['', 'Water (glasses)',        function(l) { return num((l.water || {}).glasses) }],

    // ALCOHOL
    ['ALCOHOL', '', null],
    ['', 'Alcohol (0-5)',          function(l) { var v = (l.alcohol || {}).level; return (v == null) ? '' : (v === 'None' ? 0 : num(v)) }],
    ['', 'Alc: White wine',        function(l) { return has((l.alcohol || {}).type, 'White wine')    }],
    ['', 'Alc: Red wine',          function(l) { return has((l.alcohol || {}).type, 'Red wine')      }],
    ['', 'Alc: Sparkling',         function(l) { return has((l.alcohol || {}).type, 'Sparkling')     }],
    ['', 'Alc: Beer',              function(l) { return has((l.alcohol || {}).type, 'Beer')          }],
    ['', 'Alc: Gin',               function(l) { return has((l.alcohol || {}).type, 'Gin')           }],
    ['', 'Alc: Other spirits',     function(l) { return has((l.alcohol || {}).type, 'Other spirits') }],

    // DIET
    ['DIET', '', null],
    ['', 'Caffeine (0-4)',         function(l) { return num((l.diet || {}).caffeine)  }],
    ['', 'Sugar (0-3)',            function(l) { return sev((l.diet || {}).sugar)     }],
    ['', 'Protein (0-3)',          function(l) { return sev((l.diet || {}).protein)   }],
    ['', 'Fruit/veg (1-6)',        function(l) { return num((l.diet || {}).fruit_veg) }],
    ['', 'Carbs (0-3)',            function(l) { return sev((l.diet || {}).carbs)     }],
    ['', 'Fats (0-3)',             function(l) { return sev((l.diet || {}).fats)      }, '2026-06-05'],
    ['', 'Snacking (0-3)',         function(l) { return sev((l.diet || {}).snacking)  }],
    ['', 'Allergen: Dairy',        function(l) { return has((l.diet || {}).allergens, 'Dairy')             }],
    ['', 'Allergen: Gluten',       function(l) { return has((l.diet || {}).allergens, 'Gluten')            }],
    ['', 'Allergen: Soy',          function(l) { return has((l.diet || {}).allergens, 'Soy')               }],
    ['', 'Allergen: Wheat',        function(l) { return has((l.diet || {}).allergens, 'Wheat')             }],
    ['', 'Allergen: Yeast',        function(l) { return has((l.diet || {}).allergens, 'Yeast')             }],
    ['', 'Allergen: Raw Tomato',   function(l) { return has((l.diet || {}).allergens, 'Raw Tomato')        }, '2026-05-13'],
    ['', 'Allergen: Avocado',      function(l) { return has((l.diet || {}).allergens, 'Avocado')           }, '2026-05-13'],
    ['', 'Allergen: Spinach',      function(l) { return has((l.diet || {}).allergens, 'Spinach')           }, '2026-05-13'],
    ['', 'Allergen: Strawberry',   function(l) { return has((l.diet || {}).allergens, 'Strawberry')        }, '2026-05-19'],
    ['', 'Allergen: Banana',       function(l) { return has((l.diet || {}).allergens, 'Banana')            }, '2026-05-19'],
    ['', 'Allergen: Citrus',       function(l) { return has((l.diet || {}).allergens, 'Citrus')            }, '2026-05-19'],
    ['', 'Allergen: Fermented',    function(l) { return has((l.diet || {}).allergens, 'Fermented/pickled') }, '2026-05-19'],
    ['', 'Allergen: Aged cheese',  function(l) { return has((l.diet || {}).allergens, 'Aged cheese')       }, '2026-05-19'],
    ['', 'Allergen: Leftovers',    function(l) { return has((l.diet || {}).allergens, 'Leftovers')         }, '2026-05-19'],
    ['', 'Allergen: Processed',    function(l) { return has((l.diet || {}).allergens, 'Processed')         }, '2026-05-19'],

    // EXERCISE
    ['EXERCISE', '', null],
    ['', 'Exercise energy (1-5)',  function(l) { var ex = l.exercise || {}; return ex.energy != null ? ex.energy : '' }],
    ['', 'Activity: Yoga',         function(l) { return has((l.exercise || {}).activities, 'Yoga')      }],
    ['', 'Activity: Pilates',      function(l) { return has((l.exercise || {}).activities, 'Pilates')   }],
    ['', 'Activity: Dog walk',     function(l) { return has((l.exercise || {}).activities, 'Dog walk')  }],
    ['', 'Activity: Gym',          function(l) { return has((l.exercise || {}).activities, 'Gym')       }],

    // BODY
    ['BODY', '', null],
    ['', 'Knee pain (0-3)',        function(l) { return sev((l.body || {}).knee_pain)        }],
    ['', 'Wrist/nerve pain (0-3)', function(l) { return sev((l.body || {}).wrist_nerve_pain) }],
    ['', 'Gut (0-3)',              function(l) { return sev((l.body || {}).gut)               }],
    ['', 'Gut: Bloating',          function(l) { return has((l.body || {}).gut_symptoms, 'Bloating')          }, '2026-05-13'],
    ['', 'Gut: Cramps',            function(l) { return has((l.body || {}).gut_symptoms, 'Cramps')            }, '2026-05-13'],
    ['', 'Gut: Diarrhoea',         function(l) { return has((l.body || {}).gut_symptoms, 'Diarrhoea')         }, '2026-05-13'],
    ['', 'Gut: Constipated',       function(l) { return has((l.body || {}).gut_symptoms, 'Constipated')       }, '2026-06-12'],
    ['', 'Gut: Bleeding',          function(l) { return has((l.body || {}).gut_symptoms, 'Bleeding')          }, '2026-05-20'],
    ['', 'Gut: Mucus',             function(l) { return has((l.body || {}).gut_symptoms, 'Mucus')             }, '2026-06-03'],
    ['', 'Gut: Smelly flatulence',  function(l) { return has((l.body || {}).gut_symptoms, 'Smelly flatulence')  }, '2026-05-20'],
    ['', 'Stool (Bristol avg)',     function(l) { return stoolAvg((l.body || {}).stool) },                        '2026-05-25'],
    ['', 'Illness (0-3)',          function(l) { return illness((l.body || {}).illness)        }],
    ['', 'Painkillers (tablets)',  function(l) { var v = (l.body || {}).painkillers; return (v == null) ? '' : parseInt(v) }],
    ['', 'Period',                 function(l) { var b = l.body || {}; return b.period ? 1 : (b.period === false ? 0 : '') }],
    ['', 'Pill',                   function(l) { var b = l.body || {}; return b.pill === true ? 1 : (b.pill === false ? 0 : '') }],

    // SOCIAL
    ['SOCIAL', '', null],
    ['', 'Social: Friends',          function(l) { return has((l.social || {}).activities, 'Friends')          }],
    ['', 'Social: Family',           function(l) { return has((l.social || {}).activities, 'Family')           }, '2026-05-06'],
    ['', 'Social: Date',             function(l) { return has((l.social || {}).activities, 'Date')             }],
    ['', 'Social: Party',            function(l) { return has((l.social || {}).activities, 'Party')            }, '2026-05-06'],
    ['', 'Social: Work drinks',      function(l) { return has((l.social || {}).activities, 'Work drinks')      }, '2026-05-06'],
    ['', 'Social: Work from office', function(l) { return has((l.social || {}).activities, 'Work from office') }, '2026-05-06'],
    ['', 'Social: Dating apps',      function(l) { return has((l.social || {}).activities, 'Used dating apps') }, '2026-05-06'],
    ['', 'Social: Networking',       function(l) { return has((l.social || {}).activities, 'Networking')       }, '2026-05-06'],
  ]

  // ── Build sheet ─────────────────────────────────────────────────────────────

  var props   = PropertiesService.getScriptProperties()
  var sheetId = props.getProperty('SHEET_ID')
  var ss      = SpreadsheetApp.openById(sheetId)

  var sheet = ss.getSheets()[0]
  sheet.clearContents()
  sheet.clearFormats()

  // Header row: blank + dates
  var headerRow = ['Metric'].concat(dates)
  sheet.getRange(1, 1, 1, headerRow.length).setValues([headerRow])

  // Style header row
  var headerRange = sheet.getRange(1, 1, 1, headerRow.length)
  headerRange.setBackground('#1e293b').setFontColor('#ffffff').setFontWeight('bold').setFontSize(10)

  // Write rows
  var rowData    = []
  var sectionRows = [] // 1-indexed row numbers of section headers

  for (var ri = 0; ri < ROWS.length; ri++) {
    var def     = ROWS[ri]
    var section = def[0]
    var label   = def[1]
    var fn      = def[2]

    if (section !== '') {
      // Section header row
      var sRow = [section].concat(new Array(dates.length).fill(''))
      rowData.push(sRow)
      sectionRows.push(rowData.length) // 1-based offset from row 2
    } else {
      // Data row
      var validFrom = def[3] || null
      var vals = [label]
      for (var di = 0; di < dates.length; di++) {
        var d   = dates[di]
        if (validFrom && d < validFrom) {
          vals.push('')
          continue
        }
        var log = logs[d]    || {}
        var w   = weather[d] || {}
        var fb  = fitbit[d]  || {}
        try {
          vals.push(fn(log, w, fb))
        } catch(e) {
          vals.push('')
        }
      }
      rowData.push(vals)
    }
  }

  // Write all data at once (much faster than row-by-row)
  if (rowData.length > 0) {
    sheet.getRange(2, 1, rowData.length, headerRow.length).setValues(rowData)
  }

  // Style section header rows (dark slate, bold)
  for (var si = 0; si < sectionRows.length; si++) {
    var sheetRow = sectionRows[si] + 1 // +1 for header row
    var r = sheet.getRange(sheetRow, 1, 1, headerRow.length)
    r.setBackground('#334155').setFontColor('#e2e8f0').setFontWeight('bold').setFontSize(9)
  }

  // Style metric label column (col A)
  sheet.getRange(2, 1, rowData.length, 1).setFontWeight('bold').setBackground('#f8fafc')

  // Freeze first row and first column
  sheet.setFrozenRows(1)
  sheet.setFrozenColumns(1)

  // Auto-resize metric label column
  sheet.autoResizeColumn(1)

  Logger.log('Sheet sync complete. ' + dates.length + ' dates, ' + rowData.length + ' rows written.')
}

// ── Trigger setup (optional) ──────────────────────────────────────────────────

function setupHourlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'syncToDoc') ScriptApp.deleteTrigger(t)
  })
  ScriptApp.newTrigger('syncToDoc')
    .timeBased()
    .everyHours(1)
    .create()
  Logger.log('Hourly trigger created.')
}
