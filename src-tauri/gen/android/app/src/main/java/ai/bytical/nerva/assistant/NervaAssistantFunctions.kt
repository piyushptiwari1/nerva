package ai.bytical.nerva.assistant

import androidx.annotation.RequiresApi
import androidx.appfunctions.AppFunctionDeclaration
import androidx.appfunctions.AppFunctionElementNotFoundException
import androidx.appfunctions.AppFunctionInvalidArgumentException
import androidx.appfunctions.AppFunctionService
import androidx.appfunctions.AppFunctionServiceEntryPoint
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Nerva's App Functions: lets the on-device assistant (Gemini on Android 16+)
 * run timers, tasks, habits and reminders by voice or text. The generated
 * concrete class is `NervaAppFunctionService`, declared in the manifest.
 */
@RequiresApi(36)
@AppFunctionServiceEntryPoint(
    serviceName = "NervaAppFunctionService",
    appFunctionXmlFileName = "nerva_app_functions",
)
abstract class NervaAssistantFunctions : AppFunctionService() {

    /**
     * Starts a focus timer (Pomodoro-style, with automatic breaks for long sessions).
     * Use this when the user asks to focus, start a timer, start a session or work on something for N minutes.
     *
     * @param minutes Length of the session in minutes, 1 to 720. Use 25 when the user does not say.
     * @param name Optional short label for what the user is working on, e.g. "Write report".
     * @param startNow True to start immediately (default). False only creates the timer so the user can start it later.
     * @return The created timer.
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    suspend fun startFocusTimer(minutes: Int, name: String? = null, startNow: Boolean = true): AssistantTimer =
        perform { AssistantActions.startTimer(applicationContext, minutes, name, startNow) }

    /**
     * Pauses, resumes, starts or restarts an existing timer.
     * Without a name it picks the obvious one: the running timer for pause, the paused timer for resume,
     * the newest idle timer for start, the last finished timer for restart.
     *
     * @param operation One of "pause", "resume", "start", "restart".
     * @param name Optional timer name when the user names one.
     * @return The updated timer.
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    suspend fun controlTimer(operation: String, name: String? = null): AssistantTimer =
        perform { AssistantActions.controlTimer(applicationContext, operation, name) }

    /**
     * Adds a task to the user's list.
     *
     * @param title What needs doing, e.g. "Email the landlord".
     * @return The new task.
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    suspend fun addTask(title: String): AssistantTask =
        perform { AssistantActions.addTask(applicationContext, title) }

    /**
     * Marks an open task as done, matching by title (case-insensitive, partial match allowed).
     *
     * @param title The task title or a distinctive part of it.
     * @return The completed task.
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    suspend fun completeTask(title: String): AssistantTask =
        perform { AssistantActions.completeTask(applicationContext, title) }

    /**
     * Lists the user's tasks.
     *
     * @param includeDone Include completed tasks too (default false: only open tasks).
     * @return Tasks, open ones first.
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    suspend fun listTasks(includeDone: Boolean = false): List<AssistantTask> =
        perform { AssistantActions.listTasks(applicationContext, includeDone) }

    /**
     * Logs a habit for today. Use when the user says they did a habit, e.g. "I read today", "log 2 glasses of water".
     *
     * @param name The habit name or a distinctive part of it.
     * @param amount Optional quantity for count/amount habits (e.g. 2). Omit to log one unit or mark done.
     * @return The habit with today's progress and streak.
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    suspend fun logHabit(name: String, amount: Double? = null): AssistantHabit =
        perform { AssistantActions.logHabit(applicationContext, name, amount) }

    /**
     * Lists the user's habits with today's progress and streaks. Useful for "how am I doing on my habits".
     *
     * @return All active habits.
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    suspend fun listHabits(): List<AssistantHabit> =
        perform { AssistantActions.listHabits(applicationContext) }

    /**
     * Creates a reminder that notifies the user at a given time.
     *
     * @param title What to remind about, e.g. "Call the dentist".
     * @param whenIso When to remind, as ISO-8601 local date-time like "2026-05-01T17:30" (a bare time like "17:30" means the next occurrence).
     * @param repeat Optional repeat: "daily", "weekdays" or "weekly". Omit for a one-off reminder.
     * @return The created reminder.
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    suspend fun createReminder(title: String, whenIso: String, repeat: String? = null): AssistantReminder =
        perform { AssistantActions.createReminder(applicationContext, title, whenIso, repeat) }

    /**
     * Returns upcoming reminders and task deadlines, soonest first.
     *
     * @param hours How far ahead to look, in hours (default 24, max 2160).
     * @return Upcoming items.
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    suspend fun getUpcoming(hours: Int = 24): List<AssistantReminder> =
        perform { AssistantActions.upcoming(applicationContext, hours) }

    /**
     * Summarises the user's day: active timer, open tasks, habit progress and what is coming up in the next 24 hours.
     * Use for "what's my day look like", "what am I working on", "what's next".
     *
     * @return The overview with a one-sentence summary.
     */
    @AppFunctionDeclaration(isDescribedByKDoc = true)
    suspend fun getOverview(): AssistantOverview =
        perform { AssistantActions.overview(applicationContext) }

    private suspend fun <T> perform(block: () -> T): T = withContext(Dispatchers.IO) {
        try {
            block()
        } catch (error: AssistantArgumentException) {
            throw AppFunctionInvalidArgumentException(error.message ?: "invalid argument")
        } catch (error: AssistantNotFoundException) {
            throw AppFunctionElementNotFoundException(error.message ?: "not found")
        } catch (error: IllegalArgumentException) {
            throw AppFunctionInvalidArgumentException(error.message ?: "invalid argument")
        } catch (error: IllegalStateException) {
            throw AppFunctionInvalidArgumentException(error.message ?: "could not complete")
        }
    }
}
