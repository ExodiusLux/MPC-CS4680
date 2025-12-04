const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { OpenAI } = require('openai');
const chrono = require('chrono-node');
const { randomUUID } = require('crypto');

dotenv.config();

const { OPENAI_API_KEY } = process.env;

if (!OPENAI_API_KEY) {
  console.warn('OPENAI_API_KEY is not set. Agent requests will fail.');
}

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
const PORT = process.env.PORT || 4000;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const app = express();
app.use(cors());
app.use(express.json());

const store = {
  tasks: [],
  notes: [],
  reminders: [],
  emailDrafts: [],
};

const reminderTimers = new Map();
const sseClients = new Set();

const broadcast = (event, data) => {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((client) => client.write(payload));
};

const cancelReminderTimer = (id) => {
  const timer = reminderTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    reminderTimers.delete(id);
  }
};

const scheduleReminder = (reminder) => {
  cancelReminderTimer(reminder.id);
  const delay = reminder.dueTime - Date.now();
  if (delay <= 0) {
    reminder.status = 'due';
    broadcast('reminder_due', reminder);
    return;
  }
  const timer = setTimeout(() => {
    reminder.status = 'due';
    broadcast('reminder_due', reminder);
    reminderTimers.delete(reminder.id);
  }, delay);

  reminderTimers.set(reminder.id, timer);
};

const systemPrompt = `
You are an AI productivity orchestrator. Always respond with strict JSON using this schema:
{
  "actions": [
    {
      "action": "add_task" | "add_note" | "schedule_reminder" | "update_reminder" | "cancel_reminder" | "draft_email",
      "payload": {}
    }
  ]
}

You can return multiple actions if the user's request naturally maps to multiple operations.
For example, "task for taking out trash and remind me tomorrow" returns TWO actions.

Rules:
- If user wants to remember something without a schedule, produce add_note with "body".
- For todos, use add_task with "description" and optional "dueDate" (for tasks scheduled on future days, use natural language like "December 25" or "next Monday", or ISO 8601 date format YYYY-MM-DD).
- For new reminders, use schedule_reminder with "message" and "dueTime".
- For dueTime: Use natural language relative time descriptions (e.g., "in 1 minute", "in 2 hours", "tomorrow at 8am", "next Monday at 9:00") OR ISO 8601 format (YYYY-MM-DDTHH:MM:SS). The system will parse these automatically.
- To change an existing reminder, use update_reminder with "reminderId" and optional "message" and/or "dueTime".
- To remove, use cancel_reminder with "reminderId".
- Never make up reminder IDs. Only reference IDs from the provided reminder list.
- For relative times like "in a minute" or "in 5 minutes", use the exact relative description.
- If unsure, capture info as add_note.
- When the user wants an email drafted (they'll usually mention "email", "write to", "send a message", etc.), use draft_email with payload { "instructions": "<their request>" }. Keep all other actions focused on tasks/notes/reminders.
`.trim();

const emailDraftPrompt = `
You are an expert email copywriter. Draft polished, professional emails based on the user's instructions.
Always respond with strict JSON using this schema:
{
  "subject": "Subject line here",
  "body": "Full email body here with paragraphs separated by blank lines"
}

Rules:
- Keep the tone aligned with the user's instructions (formal, casual, urgent, etc.).
- Include greetings and sign-offs when appropriate unless the user says otherwise.
- Never include markdown or HTML. Plain text only.
`.trim();

const extractJsonObject = (raw) => {
  if (!raw) throw new Error('OpenAI returned empty response.');
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error('Agent response missing JSON payload.');
  }
  return JSON.parse(raw.slice(firstBrace, lastBrace + 1));
};

const parseAiResponse = (raw) => {
  const data = extractJsonObject(raw);
  if (data.actions && Array.isArray(data.actions)) {
    if (data.actions.length === 0) {
      throw new Error('Agent response contains no actions.');
    }
    return data.actions;
  } else if (data.action && typeof data.payload === 'object') {
    return [data];
  } else {
    throw new Error('Agent response missing actions or action/payload.');
  }
};

const parseEmailDraft = (raw) => {
  const data = extractJsonObject(raw);
  if (!data.subject || !data.body) {
    throw new Error('Email draft is missing subject or body.');
  }
  return { subject: data.subject.trim(), body: data.body.trim() };
};

const interpretCommand = async (text) => {
  if (!openai) {
    throw new Error('OpenAI client is unavailable. Set OPENAI_API_KEY.');
  }

  const reminderContext = store.reminders.map((reminder) => ({
    id: reminder.id,
    message: reminder.message,
    dueTime: new Date(reminder.dueTime).toISOString(),
    status: reminder.status,
  }));

  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `
        Current reminders:
        ${JSON.stringify(reminderContext, null, 2)}

        User request: """${text}"""
        Respond with JSON only.`,
    },
  ];

  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages,
  });

  return completion.choices[0].message?.content;
};

const createTask = (description, dueDate = null) => {
  const task = {
    id: randomUUID(),
    description,
    createdAt: Date.now(),
    dueDate: dueDate ? parseTaskDate(dueDate) : null,
  };
  store.tasks.push(task);
  return task;
};

const createNote = (body) => {
  const note = { id: randomUUID(), body, createdAt: Date.now() };
  store.notes.push(note);
  return note;
};

const draftEmail = async (instructions, { persist = true } = {}) => {
  if (!openai) {
    throw new Error('OpenAI client is unavailable. Set OPENAI_API_KEY.');
  }

  const trimmed = instructions?.trim();
  if (!trimmed) {
    throw new Error('Email drafting instructions are required.');
  }

  const messages = [
    { role: 'system', content: emailDraftPrompt },
    { role: 'user', content: trimmed },
  ];

  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages,
  });

  const raw = completion.choices[0].message?.content;
  const { subject, body } = parseEmailDraft(raw);
  const draft = {
    id: randomUUID(),
    instructions: trimmed,
    subject,
    body,
    createdAt: Date.now(),
  };

  if (persist) {
    store.emailDrafts.unshift(draft);
    if (store.emailDrafts.length > 10) {
      store.emailDrafts.length = 10;
    }
  }

  return draft;
};

const parseTaskDate = (dueDate) => {
  let parsed = null;
  
  // Try parsing with chrono for natural language dates like "December 25", "next Monday"
  parsed = chrono.parseDate(dueDate, new Date(), { forwardDate: true });
  
  // If chrono fails, try ISO date format (YYYY-MM-DD)
  if (!parsed || Number.isNaN(parsed.getTime())) {
    // Check if it's ISO date format and parse it as midnight local time
    if (/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      const [y, m, d] = dueDate.split('-').map(Number);
      parsed = new Date(y, m - 1, d, 0, 0, 0, 0);
    }
  }
  
  if (!parsed || Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid task date: ${dueDate}. Please use formats like "December 25" or "2025-12-25".`);
  }
  
  // Set to midnight for date-only tasks
  parsed.setHours(0, 0, 0, 0);
  return parsed.getTime();
};

const parseReminderTime = (dueTime) => {
  const now = new Date();
  let parsed = null;
  
  // First, try parsing with chrono (handles relative times like "in 1 minute", "tomorrow at 8am")
  // Use a fresh Date object to avoid timezone issues
  parsed = chrono.parseDate(dueTime, new Date(), { forwardDate: true });
  
  // If chrono fails or produces an invalid date, try parsing as ISO string
  if (!parsed || Number.isNaN(parsed.getTime())) {
    const isoParsed = new Date(dueTime);
    if (!Number.isNaN(isoParsed.getTime())) {
      parsed = isoParsed;
    }
  }
  
  // Final validation
  if (!parsed || Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid reminder time: ${dueTime}. Please use formats like "in 5 minutes", "tomorrow at 8am", or ISO 8601.`);
  }
  
  // Ensure the date is in the future (allow 1 minute grace for "now" commands)
  if (parsed.getTime() < now.getTime() - 60000) {
    throw new Error(`Reminder time must be in the future: ${dueTime}`);
  }
  
  return parsed.getTime();
};

const createReminder = ({ message, dueTime }) => {
  const reminder = {
    id: randomUUID(),
    message,
    dueTime: parseReminderTime(dueTime),
    status: 'scheduled',
    createdAt: Date.now(),
  };

  store.reminders.push(reminder);
  scheduleReminder(reminder);
  broadcast('reminder_created', reminder);
  return reminder;
};

const updateReminder = ({ reminderId, message, dueTime }) => {
  const reminder = store.reminders.find((r) => r.id === reminderId);
  if (!reminder) {
    throw new Error(`Reminder ${reminderId} not found.`);
  }

  if (message) reminder.message = message;
  if (dueTime) {
    reminder.dueTime = parseReminderTime(dueTime);
    reminder.status = 'scheduled';
    scheduleReminder(reminder);
  }

  broadcast('reminder_updated', reminder);
  return reminder;
};

const deleteReminder = (reminderId) => {
  const index = store.reminders.findIndex((r) => r.id === reminderId);
  if (index === -1) {
    throw new Error(`Reminder ${reminderId} not found.`);
  }
  const [removed] = store.reminders.splice(index, 1);
  cancelReminderTimer(removed.id);
  broadcast('reminder_deleted', removed);
  return removed;
};

app.get('/state', (_, res) => {
  res.json(store);
});

app.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  sseClients.add(res);
  req.on('close', () => {
    sseClients.delete(res);
  });
});

app.post('/agent', async (req, res) => {
  const text = req.body?.text?.trim();
  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }

  try {
    const aiRaw = await interpretCommand(text);
    const actionsList = parseAiResponse(aiRaw);

    const results = [];
    for (const { action, payload } of actionsList) {
      if (!action || typeof payload !== 'object') {
        throw new Error('Agent response missing action or payload.');
      }

      let item;
      switch (action) {
        case 'add_task':
          item = createTask(payload.description || text, payload.dueDate || null);
          break;
        case 'add_note':
          item = createNote(payload.body || text);
          break;
        case 'schedule_reminder':
          if (!payload.message || !payload.dueTime) {
            throw new Error('schedule_reminder requires message and dueTime.');
          }
          item = createReminder(payload);
          break;
        case 'update_reminder':
          item = updateReminder(payload);
          break;
        case 'cancel_reminder':
          item = deleteReminder(payload.reminderId);
          break;
        case 'draft_email':
          item = await draftEmail(payload.instructions || text);
          break;
        default:
          throw new Error(`Unsupported action: ${action}`);
      }

      results.push({ action, item });
    }

    return res.json({ actions: results, state: store });
  } catch (error) {
    console.error('Agent error:', error);
    return res.status(400).json({ error: error.message });
  }
});

app.post('/draft-email', async (req, res) => {
  const instructions = req.body?.instructions?.trim();
  if (!instructions) {
    return res.status(400).json({ error: 'Instructions are required' });
  }

  try {
    const draft = await draftEmail(instructions, { persist: false });
    return res.json({ draft });
  } catch (error) {
    console.error('Email draft error:', error);
    return res.status(400).json({ error: error.message || 'Unable to draft email.' });
  }
});

app.listen(PORT, () => {
  console.log(`Productivity Agent server running on http://localhost:${PORT}`);
});

