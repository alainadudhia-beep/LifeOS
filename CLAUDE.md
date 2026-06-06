# LifeTracker — Claude Instructions

## Bug triage (always follow this before making changes)

When the user reports a bug, do NOT immediately read code or make changes. First gather enough information to form a clear hypothesis.

**Ask for the following if not already provided:**
1. Where it happens — desktop web / mobile web / mobile app / all three
2. A screenshot or screen recording if it's visual or layout-related
3. Steps to reproduce
4. What they expected vs what they saw
5. Whether it's consistent or intermittent

**State a hypothesis** in one sentence before touching any files. If you can't form one from what you've been told, ask a targeted follow-up rather than guessing.

**For CSS/layout/mobile bugs specifically:**
- Always ask for a screenshot first — it's faster than reading code
- Suggest the user test a quick devtools tweak before writing a fix, when practical
- Never revert working code without confirming the revert will actually fix the problem
- If two approaches might work, say so and pick one rather than trying both sequentially

**If in doubt, invoke `/debug`** to run the structured triage checklist.

## Parsing rule (always follow when adding features)

**Any time a new UI field is added, an existing field's options change, or a field is renamed, `src/utils/checkinPrompt.js` MUST be updated in the same session.**

The prompt is the single source of truth for what Claude can parse during voice check-ins. It is shared by both the in-app check-in (`parseTranscript.js`) and the iOS Shortcut endpoint (`api/voice-checkin.js`). If you add a field to LifeModules.jsx without updating the prompt, voice check-ins will silently ignore it.

**Checklist when adding a new data field:**
1. Add the field to `src/components/LifeModules.jsx` (and `MobileTodayModules.jsx` if applicable)
2. Update `src/utils/checkinPrompt.js` — add the field's allowed values and a mapping example
3. If it's an array field, add it to `PHASE_UNION` in both `applyCheckin.js` and `api/voice-checkin.js`
4. If it's an ordered category (Low/Med/High), add it to `ADDITIVE_MAPS` and `ADDITIVE_REVERSE` in both merge files
5. Update the context files (memory) to reflect the new field
