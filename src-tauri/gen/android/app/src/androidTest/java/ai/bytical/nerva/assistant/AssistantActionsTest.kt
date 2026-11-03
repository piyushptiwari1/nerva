package ai.bytical.nerva.assistant

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Assume
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/** Exercises the assistant operations the App Functions service delegates to, on any API level. */
@RunWith(AndroidJUnit4::class)
class AssistantActionsTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Test
    fun timerLifecycleByVoice() {
        val label = "Voice ${UUID.randomUUID().toString().take(6)}"
        val started = AssistantActions.startTimer(context, 25, label, startNow = true)
        assertEquals("running", started.status)
        assertEquals(25, started.minutes)
        assertTrue(started.remainingSeconds in 1..(25 * 60L))

        val paused = AssistantActions.controlTimer(context, "pause", null)
        assertEquals(started.id, paused.id)
        assertEquals("paused", paused.status)

        val resumed = AssistantActions.controlTimer(context, "resume", label)
        assertEquals("running", resumed.status)
        AssistantActions.controlTimer(context, "pause", label)

        assertThrows(AssistantArgumentException::class.java) { AssistantActions.startTimer(context, 0, null, true) }
        assertThrows(AssistantArgumentException::class.java) { AssistantActions.controlTimer(context, "explode", null) }
        assertThrows(AssistantNotFoundException::class.java) { AssistantActions.controlTimer(context, "pause", "no such timer ${UUID.randomUUID()}") }
    }

    @Test
    fun tasksAndHabitsResolveByFuzzyTitle() {
        val title = "Email the landlord ${UUID.randomUUID().toString().take(4)}"
        val task = AssistantActions.addTask(context, "  $title  ")
        assertEquals(title, task.title)
        assertFalse(task.done)
        assertTrue(AssistantActions.listTasks(context, includeDone = false).any { it.id == task.id })

        val done = AssistantActions.completeTask(context, "email the LANDLORD")
        assertEquals(task.id, done.id)
        assertTrue(done.done)
        assertFalse(AssistantActions.listTasks(context, includeDone = false).any { it.id == task.id })
        assertTrue(AssistantActions.listTasks(context, includeDone = true).any { it.id == task.id })
        assertThrows(AssistantNotFoundException::class.java) { AssistantActions.completeTask(context, "zzz-${UUID.randomUUID()}") }

        val habitId = context.getSharedPreferences("nerva.widget.tests", android.content.Context.MODE_PRIVATE).getString("fixtureHabit", null)
        Assume.assumeNotNull("Habit fixture is seeded by WidgetScreenTest.seedHabitThroughAppCommand", habitId)
        val before = AssistantActions.listHabits(context).first { it.id == habitId }
        assertEquals("count", before.kind)
        val once = AssistantActions.logHabit(context, "reading", null)
        assertEquals(habitId, once.id)
        assertEquals(before.today + 1.0, once.today, 0.0)
        val more = AssistantActions.logHabit(context, before.name, 2.0)
        assertEquals(before.today + 3.0, more.today, 0.0)
        assertTrue(AssistantActions.listHabits(context).any { it.id == more.id })
        assertThrows(AssistantArgumentException::class.java) { AssistantActions.logHabit(context, before.name, -1.0) }
        assertThrows(AssistantNotFoundException::class.java) { AssistantActions.logHabit(context, "zzz-${UUID.randomUUID()}", null) }
    }

    @Test
    fun remindersAppearInUpcomingAndOverview() {
        val title = "Call Sam ${UUID.randomUUID().toString().take(4)}"
        val inOneHour = AssistantActions.iso(System.currentTimeMillis() + 3_600_000L)
        val reminder = AssistantActions.createReminder(context, title, inOneHour, "daily")
        assertEquals(title, reminder.title)
        assertEquals("reminder", reminder.kind)
        assertTrue(AssistantActions.upcoming(context, 2).any { it.id == reminder.id })

        val overview = AssistantActions.overview(context)
        assertTrue(overview.next24h.any { it.id == reminder.id })
        assertTrue(overview.summary.endsWith("."))

        assertThrows(AssistantArgumentException::class.java) { AssistantActions.createReminder(context, title, "yesterday", null) }
        assertThrows(AssistantArgumentException::class.java) {
            AssistantActions.createReminder(context, title, AssistantActions.iso(System.currentTimeMillis() - 60_000L), null)
        }
        assertThrows(AssistantArgumentException::class.java) { AssistantActions.createReminder(context, title, inOneHour, "fortnightly") }
    }

    @Test
    fun whenParsingAcceptsLocalForms() {
        val now = 1_800_000_000_000L // 2027-01-15
        assertTrue(AssistantActions.parseWhen("07:30", now) > now)
        assertTrue(AssistantActions.parseWhen("2028-01-02", now) > now)
        assertTrue(AssistantActions.parseWhen("2028-01-02T08:15", now) > now)
        assertTrue(AssistantActions.parseWhen("2028-01-02T08:15:00+05:30", now) > now)
        assertTrue(AssistantActions.parseWhen("2026-01-02T08:15", now) < now)
        assertThrows(AssistantArgumentException::class.java) { AssistantActions.parseWhen("next tuesday", now) }
    }
}
