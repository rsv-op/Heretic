package ai.heretic.app

import android.app.Application
import ai.heretic.app.core.DecisionLogger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Application entry point. No services, receivers or periodic background work.
 *
 * The only work done here is a one-off write of the baseline ADRs into the
 * append-only decision log. It runs on Dispatchers.IO so the startup path never
 * performs disk I/O, and [DecisionLogger.seedBaseline] is idempotent, so this is
 * a no-op after the first launch.
 */
class HereticApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        CoroutineScope(Dispatchers.IO).launch {
            runCatching { DecisionLogger(this@HereticApplication).seedBaseline() }
        }
    }
}
