export const STATUSES = {
  in_progress:     { label: 'In Progress',     bg: '#dbeafe', bar: '#3b82f6', text: '#1d4ed8' },
  waiting:         { label: 'Waiting',         bg: '#fef9c3', bar: '#eab308', text: '#854d0e' },
  action_required: { label: 'Action Required', bg: '#ffedd5', bar: '#f97316', text: '#9a3412' },
  on_hold:         { label: 'On Hold',         bg: '#ede9fe', bar: '#a78bfa', text: '#4c1d95' },
  secured:         { label: 'Secured',         bg: '#dcfce7', bar: '#22c55e', text: '#15803d' },
  closed:          { label: 'Closed',          bg: '#f3f4f6', bar: '#9ca3af', text: '#4b5563' },
}

export const STATUS_MIGRATION = {
  on_track:        'in_progress',
  paused_external: 'waiting',
  paused_internal: 'action_required',
}

export const TIMELINE_START = new Date('2026-04-01')
export const TIMELINE_END   = new Date('2026-09-30')
export const DAY_WIDTH = 38

// Each track has status_history: array of { id, status, start_date, end_date }
// end_date: null means the segment is current (still open).
// Current status is always the last entry with end_date === null.

function sh(id, status, start, end = null) {
  return { id, status, start_date: start, end_date: end }
}

export const INITIAL_TRACKS = [
  {
    id: 'dvs',
    name: 'DVS (David Whitcombe)',
    status_history: [ sh('sh-dvs-1', 'in_progress', '2026-04-28') ],
    start_date: '2026-04-28',
    end_date: '2026-08-31',
    group: null, priority: null,
    milestones: [ { id: 'm-dvs-1', date: '2026-04-28', label: 'Meeting with DVS' } ],
    notes_log: [ { id: 'n1', text: 'Discovery started. £800/day. Confirm flexibility and case study rights.', timestamp: new Date().toISOString() } ],
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
  {
    id: 'sentinel',
    name: 'Sentinel / OC&C',
    status_history: [ sh('sh-sentinel-1', 'waiting', '2026-05-01') ],
    start_date: '2026-05-01',
    end_date: '2026-09-30',
    group: null, priority: null,
    milestones: [ { id: 'm-sentinel-1', date: '2026-05-28', label: 'Fred Ward meeting' } ],
    notes_log: [ { id: 'n2', text: 'Fred Ward meeting end of May. Optional: build knowledge layer prototype before then.', timestamp: new Date().toISOString() } ],
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
  {
    id: 'cvc',
    name: 'CVC contract',
    status_history: [ sh('sh-cvc-1', 'waiting', '2026-04-28') ],
    start_date: '2026-04-28', end_date: '2026-06-30',
    group: null, priority: null, milestones: [],
    notes_log: [ { id: 'n3', text: 'Waiting on recruiter. Chase if no update by Thursday.', timestamp: new Date().toISOString() } ],
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
  {
    id: 'hg',
    name: 'Hg contract',
    status_history: [ sh('sh-hg-1', 'waiting', '2026-04-28') ],
    start_date: '2026-04-28', end_date: '2026-06-30',
    group: null, priority: null, milestones: [],
    notes_log: [ { id: 'n4', text: 'Waiting on recruiter. Chase if no update by Thursday.', timestamp: new Date().toISOString() } ],
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
  {
    id: 'cos',
    name: 'Chief of Staff search',
    status_history: [ sh('sh-cos-1', 'in_progress', '2026-04-28') ],
    start_date: '2026-04-28', end_date: '2026-09-30',
    group: null, priority: null, milestones: [],
    notes_log: [ { id: 'n5', text: 'Running in background. Target £90-110k base plus equity.', timestamp: new Date().toISOString() } ],
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
  {
    id: 'cil',
    name: 'CIL staffing tool conversation',
    status_history: [ sh('sh-cil-1', 'in_progress', '2026-04-28') ],
    start_date: '2026-04-28', end_date: '2026-07-31',
    group: null, priority: null, milestones: [],
    notes_log: [ { id: 'n6', text: 'Mentor intro requested. Discovery only, not a job conversation.', timestamp: new Date().toISOString() } ],
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
  {
    id: 'australia',
    name: 'Australia',
    status_history: [ sh('sh-aus-1', 'on_hold', '2026-07-01') ],
    start_date: '2026-07-01', end_date: '2026-09-30',
    group: null, priority: null, milestones: [],
    notes_log: [ { id: 'n7', text: 'Working holiday visa available. Contingent on other tracks resolving. Decision point August.', timestamp: new Date().toISOString() } ],
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
]

export const INITIAL_COMMITMENTS = [
  { id: 'c1',  name: 'Copenhagen trip',   start_date: '2026-05-07', end_date: '2026-05-11' },
  { id: 'c2',  name: "Laura's hen",       start_date: '2026-05-15', end_date: '2026-05-17' },
  { id: 'c3',  name: "Mum's surgery",     start_date: '2026-05-26', end_date: '2026-05-26' },
  { id: 'c4',  name: 'Kamla hen',         start_date: '2026-05-29', end_date: '2026-06-01' },
  { id: 'c5',  name: 'Portugal hold',     start_date: '2026-06-02', end_date: '2026-06-05' },
  { id: 'c6',  name: "Dad's 60th",        start_date: '2026-06-05', end_date: '2026-06-05' },
  { id: 'c7',  name: "Laura's wedding",   start_date: '2026-06-19', end_date: '2026-06-20' },
  { id: 'c8',  name: 'Emi leaving party', start_date: '2026-06-20', end_date: '2026-06-20' },
  { id: 'c9',  name: "Alex's wedding",    start_date: '2026-06-21', end_date: '2026-06-23' },
  { id: 'c10', name: "Kamla's wedding",   start_date: '2026-07-10', end_date: '2026-07-12' },
  { id: 'c11', name: 'New York hold',     start_date: '2026-07-29', end_date: '2026-08-03' },
  { id: 'c12', name: "Amaara's 30th",     start_date: '2026-08-01', end_date: '2026-08-01' },
]

export const INITIAL_THIS_WEEK = [
  { id: 'w1', text: 'DVS - update status and notes after discovery starts',                             order: 0, source: 'manual', last_claude_update: null },
  { id: 'w2', text: 'Chase CVC and Hg recruiter if no update by Thursday',                             order: 1, source: 'manual', last_claude_update: null },
  { id: 'w3', text: 'CIL staffing conversation - wait for mentor intro',                                order: 2, source: 'manual', last_claude_update: null },
  { id: 'w4', text: 'Sentinel - optional: start knowledge layer prototype before Fred Ward end of May', order: 3, source: 'manual', last_claude_update: null },
  { id: 'w5', text: 'Yin yoga before bed - daily',                                                     order: 4, source: 'manual', last_claude_update: null },
]
