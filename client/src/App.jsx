import { useEffect, useMemo, useState } from 'react';
import './App.css';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

const Section = ({ title, items, renderItem, emptyLabel }) => (
  <section className="panel">
    <header>
      <h2>{title}</h2>
      <span>{items.length} total</span>
    </header>
    {items.length === 0 ? (
      <p className="empty">{emptyLabel}</p>
    ) : (
      <ul>
        {items.map((item) => (
          <li key={item.id}>{renderItem(item)}</li>
        ))}
      </ul>
    )}
  </section>
);

const EmailDraftSection = ({ drafts, onCopy, copiedId, copyError }) => (
  <section className="panel email-draft">
    <header>
      <h2>Email Drafts</h2>
      <span>{drafts.length} total</span>
    </header>
    {copyError && <p className="status error">{copyError}</p>}
    {drafts.length === 0 ? (
      <p className="empty">
        Say “draft an email about …” in the main command box to create ready-to-copy drafts.
      </p>
    ) : (
      <ul className="email-draft-list">
        {drafts.map((draft) => (
          <li key={draft.id} className="email-draft-item">
            <div className="email-draft-meta">
              <span>{new Date(draft.createdAt).toLocaleString()}</span>
              <span className="email-draft-instructions">{draft.instructions}</span>
            </div>
            <div className="email-draft-content">
              <div>
                <span className="email-draft-label">Subject</span>
                <p className="email-draft-subject">{draft.subject}</p>
              </div>
              <div>
                <span className="email-draft-label">Body</span>
                <p className="email-draft-body">{draft.body}</p>
              </div>
            </div>
            <button
              type="button"
              className="email-draft-copy"
              onClick={() => onCopy(draft)}
            >
              {copiedId === draft.id ? 'Copied!' : 'Copy draft'}
            </button>
          </li>
        ))}
      </ul>
    )}
  </section>
);

const DaySummary = ({ reminders, tasks }) => {
  const todayItems = useMemo(() => {
    // Use the exact same grouping logic as ReminderSchedule
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const grouped = {};
    
    // Initialize today's date key (same as ReminderSchedule)
    const todayKey = today.toISOString().split('T')[0];
    grouped[todayKey] = { reminders: [], tasks: [] };
    
    // Also check adjacent days in case of timezone edge cases
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const yesterdayKey = yesterday.toISOString().split('T')[0];
    grouped[yesterdayKey] = { reminders: [], tasks: [] };
    
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const tomorrowKey = tomorrow.toISOString().split('T')[0];
    grouped[tomorrowKey] = { reminders: [], tasks: [] };
    
    // Filter out due reminders - they should only appear in notifications
    const activeReminders = reminders.filter((r) => r.status !== 'due');
    
    // Group reminders by due date (same logic as ReminderSchedule)
    activeReminders.forEach((reminder) => {
      const reminderDate = new Date(reminder.dueTime);
      const dateKey = reminderDate.toISOString().split('T')[0];
      if (grouped[dateKey]) {
        grouped[dateKey].reminders.push(reminder);
      }
    });
    
    // Group tasks by creation date (same logic as ReminderSchedule)
    tasks.forEach((task) => {
      const taskDate = new Date(task.createdAt);
      const dateKey = taskDate.toISOString().split('T')[0];
      if (grouped[dateKey]) {
        grouped[dateKey].tasks.push(task);
      }
    });
    
    // Find which dateKey would be labeled as "Today" using formatDayLabel logic
    const todayDateString = today.toDateString();
    let todayDateKey = null;
    
    for (const dateKey of [todayKey, yesterdayKey, tomorrowKey]) {
      const dayDate = new Date(dateKey);
      if (dayDate.toDateString() === todayDateString) {
        todayDateKey = dateKey;
        break;
      }
    }
    
    // Extract items for the day that's labeled "Today"
    const todayData = todayDateKey ? grouped[todayDateKey] : { reminders: [], tasks: [] };
    
    // Convert to summary format
    const todayReminders = todayData.reminders.map((r) => ({ 
      type: 'reminder', 
      text: r.message, 
      time: r.dueTime 
    }));
    
    const todayTasks = todayData.tasks.map((t) => ({ 
      type: 'task', 
      text: t.description, 
      time: t.createdAt 
    }));
    
    // Sort reminders by time, tasks by creation time (newest first) - same as ReminderSchedule
    todayReminders.sort((a, b) => a.time - b.time);
    todayTasks.sort((a, b) => b.time - a.time);
    
    return [...todayReminders, ...todayTasks];
  }, [reminders, tasks]);

  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  };

  const generateSummary = () => {
    if (todayItems.length === 0) {
      return "No scheduled items for today. Add reminders or tasks to see a summary here.";
    }

    const reminders = todayItems.filter(item => item.type === 'reminder');
    const tasks = todayItems.filter(item => item.type === 'task');
    
    const parts = [];
    
    if (reminders.length > 0) {
      parts.push(`${reminders.length} reminder${reminders.length > 1 ? 's' : ''}: ${reminders.map(r => r.text).join(', ')}`);
    }
    
    if (tasks.length > 0) {
      parts.push(`${tasks.length} task${tasks.length > 1 ? 's' : ''}: ${tasks.map(t => t.text).join(', ')}`);
    }
    
    return parts.join('. ');
  };

  return (
    <section className="panel">
      <header>
        <h2>Today's Summary</h2>
        <span>{todayItems.length} items</span>
      </header>
      <div className="day-summary-content">
        <p className="day-summary-text">{generateSummary()}</p>
        {todayItems.length > 0 && (
          <ul className="day-summary-list">
            {todayItems.map((item, index) => (
              <li key={index} className={`day-summary-item day-summary-${item.type}`}>
                <span className="day-summary-time">{formatTime(item.time)}</span>
                <span className="day-summary-text-item">{item.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};

const ReminderSchedule = ({ reminders, tasks }) => {
  const daysToShow = 7;

  // Filter out due reminders - they should only appear in notifications
  const activeReminders = useMemo(() => {
    return reminders.filter((r) => r.status !== 'due');
  }, [reminders]);

  // Group reminders and tasks by day
  const itemsByDay = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const grouped = {};
    
    // Initialize all days
    for (let i = 0; i < daysToShow; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      const dateKey = date.toISOString().split('T')[0];
      grouped[dateKey] = { reminders: [], tasks: [] };
    }

    // Group reminders by due date (only active ones)
    activeReminders.forEach((reminder) => {
      const reminderDate = new Date(reminder.dueTime);
      const dateKey = reminderDate.toISOString().split('T')[0];
      if (grouped[dateKey]) {
        grouped[dateKey].reminders.push(reminder);
      }
    });

    // Group tasks by creation date
    tasks.forEach((task) => {
      const taskDate = new Date(task.createdAt);
      const dateKey = taskDate.toISOString().split('T')[0];
      if (grouped[dateKey]) {
        grouped[dateKey].tasks.push(task);
      }
    });

    // Sort reminders within each day by time
    Object.keys(grouped).forEach((key) => {
      grouped[key].reminders.sort((a, b) => a.dueTime - b.dueTime);
      grouped[key].tasks.sort((a, b) => b.createdAt - a.createdAt); // Newest first
    });

    return grouped;
  }, [activeReminders, tasks]);

  const formatDayLabel = (date) => {
    const dayDate = new Date(date);
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    const tomorrowDate = new Date(todayDate);
    tomorrowDate.setDate(todayDate.getDate() + 1);

    if (dayDate.toDateString() === todayDate.toDateString()) {
      return 'Today';
    } else if (dayDate.toDateString() === tomorrowDate.toDateString()) {
      return 'Tomorrow';
    } else {
      return dayDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }
  };

  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  };

  const dayKeys = Object.keys(itemsByDay).sort();
  const totalItems = activeReminders.length + tasks.length;

  return (
    <section className="schedule-panel">
      <header>
        <h2>Schedule & Tasks</h2>
        <span>{activeReminders.length} reminders, {tasks.length} tasks</span>
      </header>
      {totalItems === 0 ? (
        <p className="empty">Say "remind me in 10 minutes" or "add a task" to get started.</p>
      ) : (
        <div className="schedule-grid">
          {dayKeys.map((dateKey) => {
            const dayData = itemsByDay[dateKey];
            const hasItems = dayData.reminders.length > 0 || dayData.tasks.length > 0;
            if (!hasItems) return null;
            
            return (
              <div key={dateKey} className="schedule-day">
                <div className="schedule-day-header">
                  <h3>{formatDayLabel(dateKey)}</h3>
                  <span className="schedule-day-count">
                    {dayData.reminders.length + dayData.tasks.length}
                  </span>
                </div>
                <ul className="schedule-day-items">
                  {/* Show reminders first */}
                  {dayData.reminders.map((reminder) => (
                    <li 
                      key={reminder.id} 
                      className="schedule-item schedule-reminder"
                    >
                      <div className="schedule-item-time">{formatTime(reminder.dueTime)}</div>
                      <div className="schedule-item-content">
                        <span className="schedule-item-label">Reminder</span>
                        <span className="schedule-item-message">{reminder.message}</span>
                        <span className="schedule-item-id">ID: {reminder.id.slice(0, 8)}</span>
                      </div>
                    </li>
                  ))}
                  {/* Then show tasks */}
                  {dayData.tasks.map((task) => (
                    <li 
                      key={task.id} 
                      className="schedule-item schedule-task"
                    >
                      <div className="schedule-item-time">
                        {new Date(task.createdAt).toLocaleTimeString('en-US', { 
                          hour: 'numeric', 
                          minute: '2-digit',
                          hour12: true 
                        })}
                      </div>
                      <div className="schedule-item-content">
                        <span className="schedule-item-label">Task</span>
                        <span className="schedule-item-message">{task.description}</span>
                        <span className="schedule-item-id">ID: {task.id.slice(0, 8)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

function App() {
  const [input, setInput] = useState('');
  const [state, setState] = useState({ tasks: [], notes: [], reminders: [], emailDrafts: [] });
  const [notifications, setNotifications] = useState([]);
  const [status, setStatus] = useState({ loading: false, error: '', message: '' });
  const [emailCopyState, setEmailCopyState] = useState({ copiedId: '', error: '' });

  const loadState = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/state`);
      if (!res.ok) throw new Error('Unable to load agent state.');
      const data = await res.json();
      setState({
        ...data,
        emailDrafts: data.emailDrafts ?? [],
      });
    } catch (error) {
      setStatus((prev) => ({ ...prev, error: error.message }));
    }
  };

  useEffect(() => {
    loadState();
  }, []);

  useEffect(() => {
    // Request notification permission on mount
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    const events = new EventSource(`${API_BASE_URL}/events`);

    const mergeReminder = (updated) =>
      setState((prev) => ({
        ...prev,
        reminders: prev.reminders.some((r) => r.id === updated.id)
          ? prev.reminders.map((r) => (r.id === updated.id ? updated : r))
          : [updated, ...prev.reminders],
      }));

    events.addEventListener('reminder_created', (event) => {
      mergeReminder(JSON.parse(event.data));
    });

    events.addEventListener('reminder_updated', (event) => {
      mergeReminder(JSON.parse(event.data));
    });

    events.addEventListener('reminder_deleted', (event) => {
      const removed = JSON.parse(event.data);
      setState((prev) => ({
        ...prev,
        reminders: prev.reminders.filter((r) => r.id !== removed.id),
      }));
    });

    events.addEventListener('reminder_due', (event) => {
      const reminder = JSON.parse(event.data);
      // Add to notifications (persists even after removal from schedule)
      setNotifications((prev) => [reminder, ...prev].slice(0, 10));
      
      // Remove from reminders list - it will only appear in notifications now
      setState((prev) => ({
        ...prev,
        reminders: prev.reminders.filter((r) => r.id !== reminder.id),
      }));
      
      // Show browser notification
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Reminder', {
          body: reminder.message,
          icon: '/vite.svg',
          tag: reminder.id,
          requireInteraction: false,
        });
      }
    });

    events.onerror = () => {
      events.close();
      setTimeout(() => loadState(), 2000);
    };

    return () => events.close();
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!input.trim()) return;

    setStatus({ loading: true, error: '', message: '' });
    try {
      const res = await fetch(`${API_BASE_URL}/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: input }),
      });

      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        throw new Error(errorBody.error || 'Agent request failed.');
      }

      const data = await res.json();
      setState({
        ...data.state,
        emailDrafts: data.state.emailDrafts ?? [],
      });
      setStatus({
        loading: false,
        error: '',
        message: `Action ${data.action} succeeded.`,
      });
      setInput('');
    } catch (error) {
      setStatus({ loading: false, error: error.message, message: '' });
    }
  };

  const reminderStats = useMemo(() => {
    // Due reminders are removed from the list, so all reminders here are pending
    return { pending: state.reminders.length, due: notifications.length };
  }, [state.reminders.length, notifications.length]);

  const handleCopyEmail = async (draft) => {
    if (!draft) return;
    if (!navigator?.clipboard) {
      setEmailCopyState({ copiedId: '', error: 'Clipboard access is unavailable. Copy manually instead.' });
      return;
    }

    const content = `Subject: ${draft.subject}\n\n${draft.body}`;
    try {
      await navigator.clipboard.writeText(content);
      setEmailCopyState({ copiedId: draft.id, error: '' });
      setTimeout(() => {
        setEmailCopyState((prev) => ({
          ...prev,
          copiedId: prev.copiedId === draft.id ? '' : prev.copiedId,
        }));
      }, 2000);
    } catch (error) {
      setEmailCopyState({ copiedId: '', error: 'Unable to copy to clipboard. Please copy manually.' });
    }
  };

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Natural language agent</p>
          <h1>Productivity Center</h1>
          <p>
            Type natural language like &ldquo;add a task to finish the report&rdquo;,
            &ldquo;remember this idea&rdquo;, &ldquo;remind me in 3 hours to stretch&rdquo;, or
            &ldquo;draft an email detailing today&rsquo;s tasks&rdquo;.
          </p>
        </div>
        <div className="stats">
          <span>{state.tasks.length} tasks</span>
          <span>{state.notes.length} notes</span>
          <span>{reminderStats.pending} pending reminders</span>
        </div>
      </header>

      <form className="agent-form" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="e.g. remind me tomorrow at 8 to review notes"
          title="Add tasks, notes, reminders, or say “draft an email about …” to get a ready-to-copy message."
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <button type="submit" disabled={status.loading}>
          {status.loading ? 'Thinking…' : 'Send'}
        </button>
      </form>

      {status.error && <p className="status error">{status.error}</p>}
      {status.message && <p className="status success">{status.message}</p>}
      <p className="hint">
        Tip: reference reminder IDs (shown in the schedule below) for updates, or ask “draft an email about our Q1 roadmap” to auto-generate copy.
      </p>

      <div className="grid">
        <DaySummary reminders={state.reminders} tasks={state.tasks} />
        <Section
          title="Notes"
          items={state.notes}
          emptyLabel="Use triggers like remember this or write a note."
          renderItem={(note) => (
            <>
              <span>{note.body}</span>
              <small>{new Date(note.createdAt).toLocaleString()}</small>
            </>
          )}
        />
        <EmailDraftSection
          drafts={state.emailDrafts ?? []}
          onCopy={handleCopyEmail}
          copiedId={emailCopyState.copiedId}
          copyError={emailCopyState.error}
        />
      </div>

      <ReminderSchedule reminders={state.reminders} tasks={state.tasks} />

      {notifications.length > 0 && (
        <section className="panel notifications active">
          <header>
            <h2>🔔 Active Reminders</h2>
            <button 
              className="clear-notifications" 
              onClick={() => setNotifications([])}
              title="Clear notifications"
            >
              Clear
            </button>
          </header>
          <ul>
            {notifications.map((item) => (
              <li key={item.id} className="notification-item">
                <div className="notification-content">
                  <strong>{item.message}</strong>
                  <small>Triggered {new Date(item.dueTime).toLocaleTimeString()}</small>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default App;
