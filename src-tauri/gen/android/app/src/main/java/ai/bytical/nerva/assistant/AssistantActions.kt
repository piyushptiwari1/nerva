package ai.bytical.nerva.assistant

import android.content.Context
import ai.bytical.nerva.widgets.NervaWidgets
import ai.bytical.nerva.widgets.WidgetBridge
import ai.bytical.nerva.widgets.objects
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import kotlin.math.max

class AssistantArgumentException(message: String) : IllegalArgumentException(message)
class AssistantNotFoundException(message: String) : NoSuchElementException(message)

/**
 * Assistant-facing operations over the shared Rust core. Plain Kotlin so the
 * same code backs the Android 16 App Functions service and instrumentation
 * tests on older emulators. Every mutation refreshes widgets and alarms so a
 * timer started by voice still rings when it ends.
 */
object AssistantActions {
    private const val DAY_MS = 86_400_000L

    fun startTimer(context: Context, minutes: Int, name: String?, startNow: Boolean): AssistantTimer {
        if (minutes !in 1..720) throw AssistantArgumentException("minutes must be between 1 and 720")
        val request = JSONObject().put("action", "timer_create").put("minutes", minutes).put("start", startNow)
        if (!name.isNullOrBlank()) request.put("name", name.trim())
        val timer = WidgetBridge.execute(context, request) as JSONObject
        afterChange(context)
        return timer.toTimer()
    }

    fun controlTimer(context: Context, operation: String, name: String?): AssistantTimer {
        val op = operation.trim().lowercase()
        if (op !in setOf("start", "pause", "resume", "restart")) {
            throw AssistantArgumentException("operation must be start, pause, resume or restart")
        }
        val timers = WidgetBridge.snapshot(context).getJSONArray("timers").objects()
        val target = if (!name.isNullOrBlank()) {
            bestMatch(timers, name) { it.getString("name") }
                ?: throw AssistantNotFoundException("No timer called \"$name\"")
        } else {
            val wanted = when (op) {
                "start" -> listOf("idle")
                "pause" -> listOf("running")
                "resume" -> listOf("paused")
                else -> listOf("completed", "cancelled")
            }
            timers.filter { it.getString("status") in wanted }.maxByOrNull { it.optLong("created_ms") }
                ?: throw AssistantNotFoundException(
                    when (op) {
                        "pause" -> "No timer is running"
                        "resume" -> "No timer is paused"
                        "start" -> "No timer is waiting to start"
                        else -> "No finished timer to restart"
                    }
                )
        }
        val updated = WidgetBridge.execute(
            context,
            JSONObject().put("action", "timer").put("id", target.getString("id")).put("operation", op),
        ) as JSONObject
        afterChange(context)
        return updated.toTimer()
    }

    fun addTask(context: Context, title: String): AssistantTask {
        val clean = title.trim()
        if (clean.isEmpty()) throw AssistantArgumentException("task title is required")
        val task = WidgetBridge.execute(context, JSONObject().put("action", "task_create").put("title", clean)) as JSONObject
        afterChange(context)
        return task.toTask()
    }

    fun completeTask(context: Context, title: String): AssistantTask {
        val open = WidgetBridge.snapshot(context).getJSONArray("tasks").objects().filter { it.getString("status") == "todo" }
        val task = bestMatch(open, title) { it.getString("title") }
            ?: throw AssistantNotFoundException("No open task matches \"$title\"")
        val updated = WidgetBridge.execute(
            context,
            JSONObject().put("action", "task_set").put("id", task.getString("id")).put("done", true),
        ) as JSONObject
        afterChange(context)
        return updated.toTask()
    }

    fun listTasks(context: Context, includeDone: Boolean): List<AssistantTask> =
        WidgetBridge.snapshot(context).getJSONArray("tasks").objects()
            .filter { includeDone || it.getString("status") == "todo" }
            .map { it.toTask() }

    fun logHabit(context: Context, name: String, amount: Double?): AssistantHabit {
        if (amount != null && (amount.isNaN() || amount <= 0.0)) throw AssistantArgumentException("amount must be a positive number")
        val snapshot = WidgetBridge.snapshot(context)
        val rows = snapshot.getJSONArray("habits").objects()
        val row = bestMatch(rows, name) { it.getJSONObject("habit").getString("name") }
            ?: throw AssistantNotFoundException("No habit called \"$name\"")
        val habit = row.getJSONObject("habit")
        val entry = row.optJSONObject("entry")
        val current = entry?.optDouble("value", 0.0) ?: 0.0
        val target = habit.optDouble("target", Double.NaN).takeUnless { it.isNaN() }
        val value = when (habit.getString("kind")) {
            "bool" -> 1.0
            "count" -> current + (amount ?: 1.0)
            else -> current + (amount ?: max((target ?: 4.0) / 4.0, 1.0))
        }
        val request = JSONObject().put("action", "habit_set").put("id", habit.getString("id"))
            .put("day", snapshot.getString("day")).put("value", value)
        if (entry != null) request.put("expected_updated_ms", entry.getLong("updated_ms"))
        WidgetBridge.execute(context, request)
        afterChange(context)
        val refreshed = WidgetBridge.snapshot(context).getJSONArray("habits").objects()
            .first { it.getJSONObject("habit").getString("id") == habit.getString("id") }
        return refreshed.toHabit()
    }

    fun listHabits(context: Context): List<AssistantHabit> =
        WidgetBridge.snapshot(context).getJSONArray("habits").objects().map { it.toHabit() }

    fun createReminder(context: Context, title: String, whenIso: String, repeat: String?): AssistantReminder {
        val clean = title.trim()
        if (clean.isEmpty()) throw AssistantArgumentException("reminder title is required")
        val due = parseWhen(whenIso)
        if (due <= System.currentTimeMillis()) throw AssistantArgumentException("reminder time must be in the future")
        val rep = repeat?.trim()?.lowercase()?.takeIf { it.isNotEmpty() && it != "none" }
        if (rep != null && rep !in setOf("daily", "weekdays", "weekly")) {
            throw AssistantArgumentException("repeat must be daily, weekdays, weekly or omitted")
        }
        val request = JSONObject().put("action", "reminder_create").put("title", clean).put("due_ms", due)
            .put("tz_offset_min", java.util.TimeZone.getDefault().getOffset(due) / 60_000)
        if (rep != null) request.put("repeat", rep)
        val reminder = WidgetBridge.execute(context, request) as JSONObject
        ReminderAlarms.schedule(context, reminder.getString("id"), clean, due)
        afterChange(context)
        return AssistantReminder(reminder.getString("id"), clean, iso(due), "reminder")
    }

    fun upcoming(context: Context, hours: Int): List<AssistantReminder> {
        val horizon = hours.coerceIn(1, 24 * 90) * 3_600_000L
        val items = WidgetBridge.execute(context, JSONObject().put("action", "upcoming").put("horizon_ms", horizon)) as JSONArray
        return items.objects().map { AssistantReminder(it.getString("id"), it.getString("title"), iso(it.getLong("due_ms")), it.getString("kind")) }
    }

    fun overview(context: Context): AssistantOverview {
        val snapshot = WidgetBridge.snapshot(context)
        val timers = snapshot.getJSONArray("timers").objects()
        val active = timers.firstOrNull { it.getString("status") == "running" }
            ?: timers.firstOrNull { it.getString("status") == "paused" }
        val openTasks = snapshot.getJSONArray("tasks").objects().count { it.getString("status") == "todo" }
        val habits = snapshot.getJSONArray("habits").objects().map { it.toHabit() }
        val next = upcoming(context, 24)
        val parts = mutableListOf<String>()
        active?.toTimer()?.let {
            parts += if (it.status == "running") "${it.name} is running with ${it.remainingSeconds / 60} minutes left"
            else "${it.name} is paused"
        }
        parts += when (openTasks) { 0 -> "no open tasks"; 1 -> "1 open task"; else -> "$openTasks open tasks" }
        if (habits.isNotEmpty()) parts += "${habits.count { it.doneToday }} of ${habits.size} habits done today"
        if (next.isNotEmpty()) parts += "next up: ${next.first().title} at ${next.first().dueAt.substringAfter('T')}"
        return AssistantOverview(
            activeTimer = active?.toTimer(),
            openTasks = openTasks,
            habitsDoneToday = habits.count { it.doneToday },
            habitsTotal = habits.size,
            next24h = next,
            summary = parts.joinToString(", ").replaceFirstChar { it.uppercase() } + ".",
        )
    }

    // ----- helpers -----

    private fun afterChange(context: Context) {
        runCatching { NervaWidgets.refreshAll(context) }
    }

    /** Case-insensitive match: exact, then prefix/contains, then word overlap. */
    private fun <T> bestMatch(items: List<T>, query: String, label: (T) -> String): T? {
        val q = query.trim().lowercase()
        if (q.isEmpty()) return null
        items.firstOrNull { label(it).trim().lowercase() == q }?.let { return it }
        items.firstOrNull { label(it).lowercase().contains(q) || q.contains(label(it).trim().lowercase()) }?.let { return it }
        val words = q.split(Regex("\\W+")).filter { it.length > 2 }.toSet()
        if (words.isEmpty()) return null
        return items.map { it to label(it).lowercase().split(Regex("\\W+")).count { w -> w in words } }
            .filter { it.second > 0 }.maxByOrNull { it.second }?.first
    }

    private val zone: ZoneId get() = ZoneId.systemDefault()

    fun iso(ms: Long): String =
        Instant.ofEpochMilli(ms).atZone(zone).toLocalDateTime().format(DateTimeFormatter.ISO_LOCAL_DATE_TIME).substringBefore('.')

    /** Accepts ISO date-time with or without offset, a bare date (09:00), or a bare time (today/tomorrow). */
    fun parseWhen(text: String, now: Long = System.currentTimeMillis()): Long {
        val t = text.trim()
        runCatching { return OffsetDateTime.parse(t).toInstant().toEpochMilli() }
        runCatching { return LocalDateTime.parse(t).atZone(zone).toInstant().toEpochMilli() }
        runCatching { return LocalDate.parse(t).atTime(9, 0).atZone(zone).toInstant().toEpochMilli() }
        try {
            val time = LocalTime.parse(t)
            val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
            var candidate = today.atTime(time).atZone(zone).toInstant().toEpochMilli()
            if (candidate <= now) candidate += DAY_MS
            return candidate
        } catch (_: DateTimeParseException) {
            throw AssistantArgumentException("whenIso must be an ISO-8601 date-time such as 2026-05-01T17:30")
        }
    }

    private fun JSONObject.toTimer(): AssistantTimer {
        val running = getString("status") == "running"
        return AssistantTimer(
            id = getString("id"),
            name = getString("name"),
            status = getString("status"),
            minutes = (getLong("duration_ms") / 60_000L).toInt(),
            remainingSeconds = if (running) max(optLong("phase_remaining_ms"), 0L) / 1000 else 0L,
            phase = optString("phase_kind", "focus"),
        )
    }

    private fun JSONObject.toTask(): AssistantTask = AssistantTask(
        id = getString("id"),
        title = getString("title"),
        done = getString("status") == "done",
        dueAt = if (isNull("due_ms")) null else iso(getLong("due_ms")),
    )

    private fun JSONObject.toHabit(): AssistantHabit {
        val habit = getJSONObject("habit")
        val entry = optJSONObject("entry")
        val stats = getJSONObject("stats")
        val target = habit.optDouble("target", Double.NaN).takeUnless { it.isNaN() }
        val today = entry?.optDouble("value", 0.0) ?: 0.0
        val done = when (habit.getString("kind")) {
            "bool" -> today >= 1.0
            else -> target?.let { today >= it } ?: (today > 0.0)
        }
        return AssistantHabit(
            id = habit.getString("id"),
            name = habit.getString("name"),
            kind = habit.getString("kind"),
            today = today,
            target = target,
            doneToday = done,
            streak = stats.optInt("current_streak"),
            missesInARow = stats.optInt("misses_in_a_row"),
        )
    }
}
