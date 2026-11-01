package ai.bytical.nerva.assistant

import androidx.appfunctions.AppFunctionSerializable

/** A focus timer. */
@AppFunctionSerializable(isDescribedByKDoc = true)
data class AssistantTimer(
    /** Stable id of the timer. */
    val id: String,
    /** Display name, e.g. "Write intro". */
    val name: String,
    /** One of idle, running, paused, completed, cancelled. */
    val status: String,
    /** Total planned length in minutes. */
    val minutes: Int,
    /** Seconds left in the current phase (0 when not running). */
    val remainingSeconds: Long,
    /** "focus" or "break" for the current phase. */
    val phase: String,
)

/** A to-do item. */
@AppFunctionSerializable(isDescribedByKDoc = true)
data class AssistantTask(
    /** Stable id of the task. */
    val id: String,
    /** Task title. */
    val title: String,
    /** True once the task is completed. */
    val done: Boolean,
    /** Due date as ISO-8601 local date-time, or null when the task has no deadline. */
    val dueAt: String?,
)

/** A daily habit and its progress today. */
@AppFunctionSerializable(isDescribedByKDoc = true)
data class AssistantHabit(
    /** Stable id of the habit. */
    val id: String,
    /** Habit name, e.g. "Read". */
    val name: String,
    /** "bool" (done or not), "count" (times per day) or "amount" (a quantity with a target). */
    val kind: String,
    /** Value logged today (1 for a done boolean habit, 0 when nothing logged). */
    val today: Double,
    /** Daily target for count/amount habits, null for boolean habits. */
    val target: Double?,
    /** Whether today's target is met. */
    val doneToday: Boolean,
    /** Consecutive days completed up to today. */
    val streak: Int,
    /** Consecutive missed days up to yesterday; the user tries never to miss twice. */
    val missesInARow: Int,
)

/** Something coming up: a reminder or a task deadline. */
@AppFunctionSerializable(isDescribedByKDoc = true)
data class AssistantReminder(
    /** Stable id. */
    val id: String,
    /** Title of the reminder or task. */
    val title: String,
    /** When it is due, ISO-8601 local date-time. */
    val dueAt: String,
    /** "reminder" or "task". */
    val kind: String,
)

/** A compact picture of the user's day. */
@AppFunctionSerializable(isDescribedByKDoc = true)
data class AssistantOverview(
    /** The running or paused timer, if any. */
    val activeTimer: AssistantTimer?,
    /** Number of open (not done) tasks. */
    val openTasks: Int,
    /** Habits completed today. */
    val habitsDoneToday: Int,
    /** Habits tracked in total. */
    val habitsTotal: Int,
    /** Reminders and deadlines in the next 24 hours, soonest first. */
    val next24h: List<AssistantReminder>,
    /** One-sentence human summary suitable for reading aloud. */
    val summary: String,
)
