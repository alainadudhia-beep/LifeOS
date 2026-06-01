import { CHECKIN_SYSTEM_PROMPT } from './checkinPrompt.js'

const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY

export async function parseTranscript(transcript, trackNames = [], recentContext = '') {
  if (!API_KEY) throw new Error('VITE_ANTHROPIC_API_KEY not set')

  const trackContext = trackNames.length
    ? `\n\nKnown career tracks: ${trackNames.join(', ')}`
    : ''

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: CHECKIN_SYSTEM_PROMPT + trackContext + recentContext,
      messages: [{ role: 'user', content: transcript }],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Claude API error ${res.status}: ${err}`)
  }

  const data = await res.json()
  let text = data.content[0].text.trim()

  // Strip markdown code fences if present
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

  // Robustly extract outermost JSON object — handles trailing text Claude sometimes appends
  const firstBrace = text.indexOf('{')
  if (firstBrace !== -1) {
    let depth = 0, end = -1
    for (let i = firstBrace; i < text.length; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    if (end !== -1) text = text.slice(firstBrace, end + 1)
  }

  try {
    const parsed = JSON.parse(text)
    console.log('[parseTranscript] result:', parsed)
    return parsed
  } catch {
    const stopReason = data.stop_reason
    const outTokens  = data.usage?.output_tokens
    throw new Error(`Claude returned invalid JSON (stop=${stopReason} out=${outTokens}): TAIL: ${text.slice(-300)}`)
  }
}
